import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type AtlasFamily = {
  family_id: string;
  title: string;
  interview_goal: string;
  expected_triggers?: Array<{ atlas_id: string; number: number; name: string }>;
  prior_sources?: string[];
};

type Atlas = {
  version: string;
  sections: Array<{ section_number: number; title: string }>;
  families: AtlasFamily[];
  global_primitives?: string[];
  source_order?: string[];
};

const root = process.cwd();
const legacyDir = resolve(root, "legacy-live-app");
const outputDir = resolve(root, "generated-data");

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function extractNomenclature(values: string[]): string[] {
  const terms = new Set<string>();

  for (const value of values) {
    for (const match of value.matchAll(/\b[A-Z][A-Z0-9-]{1,}\b/g)) {
      const term = match[0].trim();
      if (term.length >= 2 && term.length <= 12) {
        terms.add(term);
      }
    }
  }

  return [...terms].sort((a, b) => a.localeCompare(b));
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const atlas = await readJson<Atlas>(resolve(legacyDir, "eleanor_v3_trigger_atlas.json"));
  const priorKnowledge = await readJson<unknown>(resolve(legacyDir, "jacklaw_prior_master_list.json"));
  const captureSchema = await readJson<unknown>(resolve(legacyDir, "eleanor_v3_capture_schema.json"));
  const familyCsvText = await readFile(resolve(legacyDir, "Eleanor_v3_Family_Index.csv"), "utf8");
  const round1Prompt = await readFile(resolve(legacyDir, "eleanor_v3_round1a_prompt.txt"), "utf8");
  const architectureText = await readFile(resolve(legacyDir, "Eleanor_v3_Master_Interview_Architecture.md"), "utf8");
  const familyIndex = parseCsv(familyCsvText);

  const sourceIndex = {
    importedAt: new Date().toISOString(),
    sources: [
      "legacy-live-app/eleanor_v3_trigger_atlas.json",
      "legacy-live-app/jacklaw_prior_master_list.json",
      "legacy-live-app/eleanor_v3_capture_schema.json",
      "legacy-live-app/Eleanor_v3_Family_Index.csv",
      "legacy-live-app/eleanor_v3_round1a_prompt.txt",
      "legacy-live-app/Eleanor_v3_Master_Interview_Architecture.md",
      "source-materials/Eleanor_v3_Codex_Master_Build_Prompt.txt",
    ],
    authorityOrder: atlas.source_order ?? [],
  };

  const interviewRounds = {
    importedAt: new Date().toISOString(),
    round1Prompt,
    architectureMarkdown: architectureText,
    sections: atlas.sections,
    captureSchema,
  };

  const nomenclature = {
    importedAt: new Date().toISOString(),
    terms: extractNomenclature([round1Prompt, architectureText, JSON.stringify(atlas)]),
  };

  await Promise.all([
    writeFile(resolve(outputDir, "trigger-atlas.json"), JSON.stringify(atlas, null, 2)),
    writeFile(resolve(outputDir, "family-index.json"), JSON.stringify(familyIndex, null, 2)),
    writeFile(resolve(outputDir, "prior-knowledge.json"), JSON.stringify(priorKnowledge, null, 2)),
    writeFile(resolve(outputDir, "nomenclature.json"), JSON.stringify(nomenclature, null, 2)),
    writeFile(resolve(outputDir, "source-index.json"), JSON.stringify(sourceIndex, null, 2)),
    writeFile(resolve(outputDir, "interview-rounds.json"), JSON.stringify(interviewRounds, null, 2)),
  ]);

  const summary = {
    families: atlas.families.length,
    triggers: atlas.families.reduce((sum, family) => sum + (family.expected_triggers?.length ?? 0), 0),
    nomenclatureTerms: nomenclature.terms.length,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
