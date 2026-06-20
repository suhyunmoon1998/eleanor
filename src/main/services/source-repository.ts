import { readFile } from "node:fs/promises";
import { join } from "node:path";

type FamilySummary = {
  familyId: string;
  title: string;
  interviewGoal: string;
  triggerCount: number;
  sectionTitles: string[];
  risk?: string;
};

export class SourceRepository {
  constructor(private readonly dataDir: string) {}

  async getAtlas() {
    return this.readJson<{
      sections: Array<{ section_number: number; title: string }>;
      families: Array<{
        family_id: string;
        title: string;
        interview_goal: string;
        expected_triggers?: Array<unknown>;
        section_titles?: string[];
        risk?: string;
      }>;
    }>("trigger-atlas.json");
  }

  async getFamilies(): Promise<FamilySummary[]> {
    const atlas = await this.getAtlas();
    return atlas.families.map((family) => ({
      familyId: family.family_id,
      title: family.title,
      interviewGoal: family.interview_goal,
      triggerCount: family.expected_triggers?.length ?? 0,
      sectionTitles: family.section_titles ?? [],
      expectedTriggerNames: (family.expected_triggers ?? []).map((trigger) =>
        typeof trigger === "object" && trigger && "name" in trigger && typeof trigger.name === "string" ? trigger.name : "",
      ).filter(Boolean),
      risk: family.risk,
    }));
  }

  async getSummary() {
    const atlas = await this.getAtlas();
    const nomenclature = await this.readJson<{ terms: string[] }>("nomenclature.json");
    return {
      familyCount: atlas.families.length,
      sectionCount: atlas.sections.length,
      nomenclatureCount: nomenclature.terms.length,
    };
  }

  private async readJson<T>(name: string): Promise<T> {
    const raw = await readFile(join(this.dataDir, name), "utf8");
    return JSON.parse(raw) as T;
  }
}
