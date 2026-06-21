import type { AppSettings, SessionRecord } from "./contracts.js";

export type EleanorExportState = {
  settings: AppSettings;
  sessions: SessionRecord[];
};

type KnowledgePackInput = {
  exportedAt: string;
  storagePath?: string;
  data: EleanorExportState;
};

function cleanMarkdownText(value: unknown) {
  if (typeof value !== "string") {
    return JSON.stringify(value, null, 2);
  }
  return value.replace(/\r\n/g, "\n").trim();
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function roleLabel(role: SessionRecord["transcript"][number]["role"]) {
  if (role === "assistant") return "Eleanor";
  if (role === "user") return "Jack";
  return "System";
}

function transcriptToMarkdown(session: SessionRecord) {
  if (session.transcript.length === 0) {
    return "No saved transcript turns yet.";
  }

  return session.transcript
    .map((entry, index) => {
      const speaker = roleLabel(entry.role);
      const text = cleanMarkdownText(entry.text) || "(empty)";
      return `### ${index + 1}. ${speaker} · ${formatDateTime(entry.createdAt)}\n\n${text}`;
    })
    .join("\n\n");
}

function listToMarkdown(items: string[]) {
  if (items.length === 0) return "None recorded.";
  return items.map((item) => `- ${item}`).join("\n");
}

function leadsToMarkdown(session: SessionRecord) {
  if (session.leads.length === 0) return "None recorded.";
  return session.leads.map((lead) => `- [${lead.kind}] ${lead.text}`).join("\n");
}

function progressToMarkdown(session: SessionRecord) {
  const entries = Object.entries(session.progress);
  if (entries.length === 0) return "No trigger progress recorded.";
  return entries.map(([familyId, triggerIds]) => `- ${familyId}: ${triggerIds.length} confirmed`).join("\n");
}

function sessionToMarkdown(session: SessionRecord, index: number) {
  const capture = Object.keys(session.capture).length > 0 ? formatJson(session.capture) : "{}";

  return [
    `# Session ${index + 1}: ${session.title}`,
    "",
    `- Session ID: ${session.id}`,
    `- Family: ${session.familyId}`,
    `- Created: ${formatDateTime(session.createdAt)}`,
    `- Updated: ${formatDateTime(session.updatedAt)}`,
    `- Saved turns: ${session.transcript.length}`,
    "",
    "## Current Interview State",
    "",
    `- Current question: ${session.currentQuestion || "None saved."}`,
    `- Last Eleanor reply: ${session.lastAssistantReply || "None saved."}`,
    `- Priority reason: ${session.lastPriorityReason || "None saved."}`,
    "",
    "## Trigger Progress",
    "",
    progressToMarkdown(session),
    "",
    "## Structured Capture",
    "",
    "```json",
    capture,
    "```",
    "",
    "## Leads, Parked Details, and Unmapped Context",
    "",
    leadsToMarkdown(session),
    "",
    "## Contradictions",
    "",
    listToMarkdown(session.contradictions),
    "",
    "## Missing Critical Fields",
    "",
    listToMarkdown(session.missingCriticalFields),
    "",
    "## Full Conversation Transcript",
    "",
    transcriptToMarkdown(session),
  ].join("\n");
}

export function buildKnowledgePackMarkdown(input: KnowledgePackInput) {
  const sessions = [...input.data.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const totalTurns = sessions.reduce((sum, session) => sum + session.transcript.length, 0);

  return [
    "# Eleanor Knowledge Pack",
    "",
    "This file preserves the full interview material captured by Eleanor, including details that may not map cleanly to a specific trigger, rule, procedure, or action yet.",
    "",
    "## How To Use This In ChatGPT",
    "",
    "Upload or paste this file and ask ChatGPT to analyze the firm workflow, identify missing rules, extract procedures, map details into CaseSync/K-Sync fields, or summarize operational knowledge.",
    "",
    "## Export Metadata",
    "",
    `- Exported at: ${input.exportedAt}`,
    `- Storage path: ${input.storagePath || "Not provided"}`,
    `- Sessions: ${sessions.length}`,
    `- Saved transcript turns: ${totalTurns}`,
    `- AI provider: ${input.data.settings.provider}`,
    `- Extraction model: ${input.data.settings.extractionModel}`,
    "",
    "## Important Privacy Note",
    "",
    "This export may include confidential firm process details, client-intake workflows, legal strategy, and internal operational notes. Review before sharing outside trusted tools.",
    "",
    sessions.length > 0 ? sessions.map(sessionToMarkdown).join("\n\n---\n\n") : "No sessions have been captured yet.",
    "",
  ].join("\n");
}
