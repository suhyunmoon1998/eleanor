import atlas from "../../generated-data/trigger-atlas.json";
import type {
  AppSettings,
  BootstrapState,
  ExtractionResult,
  FinalReportResult,
  SaveApiKeyResult,
  SessionRecord,
  TestConnectionResult,
} from "../shared/contracts.js";

export type RendererBridge = {
  bootstrap: () => Promise<BootstrapState>;
  saveApiKey: (apiKey: string) => Promise<SaveApiKeyResult>;
  deleteApiKey: () => Promise<{ ok: boolean }>;
  testConnection: () => Promise<TestConnectionResult>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  createSession: (input: { title: string; familyId: string }) => Promise<SessionRecord>;
  getSession: (sessionId: string) => Promise<SessionRecord | null>;
  updateSession: (input: unknown) => Promise<SessionRecord>;
  runExtraction: (input: unknown) => Promise<ExtractionResult>;
  finalizeReport: (input: unknown) => Promise<FinalReportResult>;
  synthesizeSpeech: (input: { text: string }) => Promise<Blob | null>;
  createRealtimeSession: (offerSdp: string) => Promise<string>;
  exportLocalData: () => Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
  exportKnowledgePack: () => Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
  deleteLocalData: () => Promise<{ ok: boolean }>;
};

const settingsKey = "eleanor.mock.settings";
const sessionsKey = "eleanor.mock.sessions";
const apiKeyKey = "eleanor.mock.apiKey";

const defaultSettings: AppSettings = {
  provider: "local",
  realtimeModel: "local-archive",
  fallbackRealtimeModel: "local-archive",
  extractionModel: "local-archive",
  fallbackExtractionModel: "local-archive",
  voice: "coral",
};

function readSettings(): AppSettings {
  const raw = localStorage.getItem(settingsKey);
  return raw ? ({ ...defaultSettings, ...JSON.parse(raw) } as AppSettings) : defaultSettings;
}

function readSessions(): SessionRecord[] {
  const raw = localStorage.getItem(sessionsKey);
  return raw ? (JSON.parse(raw) as SessionRecord[]) : [];
}

function saveSessions(sessions: SessionRecord[]) {
  localStorage.setItem(sessionsKey, JSON.stringify(sessions));
}

function buildBootstrap(): BootstrapState {
  const typedAtlas = atlas as {
    sections: Array<{ title: string }>;
    families: Array<{
      family_id: string;
      title: string;
      interview_goal: string;
      expected_triggers?: Array<unknown>;
      section_titles?: string[];
      risk?: string;
    }>;
  };

  return {
    hasApiKey: true,
    settings: readSettings(),
    storagePath: "Browser preview mock store",
    sourceSummary: {
      familyCount: typedAtlas.families.length,
      sectionCount: typedAtlas.sections.length,
      nomenclatureCount: 573,
    },
    families: typedAtlas.families.map((family) => ({
      familyId: family.family_id,
      title: family.title,
      interviewGoal: family.interview_goal,
      triggerCount: family.expected_triggers?.length ?? 0,
      sectionTitles: family.section_titles ?? [],
      expectedTriggerNames: (family.expected_triggers ?? [])
        .map((trigger) =>
          typeof trigger === "object" && trigger && "name" in trigger && typeof trigger.name === "string" ? trigger.name : "",
        )
        .filter(Boolean),
      risk: family.risk,
    })),
    recentSessions: readSessions().slice(0, 10),
  };
}

export const mockBridge: RendererBridge = {
  async bootstrap() {
    return buildBootstrap();
  },
  async saveApiKey(apiKey: string): Promise<SaveApiKeyResult> {
    void apiKey;
    localStorage.removeItem(apiKeyKey);
    return {
      ok: true,
      message: "Preview mode: OpenAI API has been removed. Local archive mode is ready.",
      checkedModels: [defaultSettings.realtimeModel, defaultSettings.extractionModel],
    };
  },
  async deleteApiKey() {
    localStorage.removeItem(apiKeyKey);
    return { ok: true };
  },
  async testConnection(): Promise<TestConnectionResult> {
    return {
      ok: true,
      models: [defaultSettings.realtimeModel, defaultSettings.extractionModel],
      message: "Preview mode: local archive mode is ready. No API key is required.",
      checkedModels: [defaultSettings.realtimeModel, defaultSettings.fallbackRealtimeModel, defaultSettings.extractionModel, defaultSettings.fallbackExtractionModel],
      missingModels: [],
    };
  },
  async saveSettings(settings: AppSettings) {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    return settings;
  },
  async createSession(input: { title: string; familyId: string }) {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      title: input.title,
      familyId: input.familyId,
      transcript: [],
      capture: {},
      leads: [],
      contradictions: [],
      progress: {},
      currentQuestion: "",
      lastAssistantReply: "",
      lastPriorityReason: "",
      missingCriticalFields: [],
      createdAt: now,
      updatedAt: now,
    };
    const sessions = [session, ...readSessions()];
    saveSessions(sessions);
    return session;
  },
  async getSession(sessionId: string) {
    return readSessions().find((session) => session.id === sessionId) ?? null;
  },
  async updateSession(input: unknown) {
    const parsed = input as {
      sessionId: string;
      familyId?: string;
      transcriptEntry?: SessionRecord["transcript"][number];
      capturePatch?: Record<string, unknown>;
      contradictions?: string[];
      triggerIds?: string[];
      leads?: SessionRecord["leads"];
      currentQuestion?: string;
      lastAssistantReply?: string;
      lastPriorityReason?: string;
      missingCriticalFields?: string[];
    };
    const sessions = readSessions();
    const session = sessions.find((item) => item.id === parsed.sessionId);
    if (!session) throw new Error("Mock session not found.");

    if (parsed.familyId) session.familyId = parsed.familyId;
    if (parsed.transcriptEntry) session.transcript.push(parsed.transcriptEntry);
    if (parsed.capturePatch) session.capture = { ...session.capture, ...parsed.capturePatch };
    if (parsed.contradictions?.length) session.contradictions = [...session.contradictions, ...parsed.contradictions];
    if (parsed.leads?.length) session.leads = [...session.leads, ...parsed.leads];
    if (typeof parsed.currentQuestion === "string") session.currentQuestion = parsed.currentQuestion;
    if (typeof parsed.lastAssistantReply === "string") session.lastAssistantReply = parsed.lastAssistantReply;
    if (typeof parsed.lastPriorityReason === "string") session.lastPriorityReason = parsed.lastPriorityReason;
    if (parsed.missingCriticalFields) session.missingCriticalFields = [...parsed.missingCriticalFields];
    if (parsed.triggerIds?.length) session.progress[session.familyId] = parsed.triggerIds;
    session.updatedAt = new Date().toISOString();

    saveSessions(sessions);
    return session;
  },
  async runExtraction(input: unknown): Promise<ExtractionResult> {
    const parsed = input as { transcript: string; familyId: string };
    return {
      spokenReply: `Thanks. I’ve captured that for ${parsed.familyId} and I’m narrowing the next gap.`,
      nextQuestion: "What is the next concrete event, document, or decision that usually follows?",
      priorityReason: "Preview mode uses a deterministic placeholder instead of a live model call.",
      capturePatch: {
        latestTranscript: parsed.transcript,
      },
      missingCriticalFields: ["Next operative trigger"],
      atomicTriggerIds: [],
      caseDevelopmentLeads: [],
      clientManagementLeads: [],
      clientDevelopmentLeads: [],
      contradictions: [],
      parkedItems: [],
    };
  },
  async finalizeReport(input: unknown): Promise<FinalReportResult> {
    const parsed = input as { session: SessionRecord; unsavedDraft?: string };
    return buildMockFinalReport(parsed.session, parsed.unsavedDraft ?? "");
  },
  async synthesizeSpeech() {
    return null;
  },
  async createRealtimeSession() {
    return "Preview mode";
  },
  async exportLocalData() {
    return { ok: true, canceled: false, filePath: "Preview mode" };
  },
  async exportKnowledgePack() {
    return { ok: true, canceled: false, filePath: "Preview mode" };
  },
  async deleteLocalData() {
    localStorage.removeItem(settingsKey);
    localStorage.removeItem(sessionsKey);
    localStorage.removeItem(apiKeyKey);
    return { ok: true };
  },
};

const webBridge: RendererBridge = {
  async bootstrap(): Promise<BootstrapState> {
    return fetchJson("/api/bootstrap");
  },
  async saveApiKey(apiKey: string): Promise<SaveApiKeyResult> {
    return fetchJson("/api/save-api-key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
  },
  async deleteApiKey() {
    return fetchJson("/api/delete-api-key", { method: "POST" });
  },
  async testConnection(): Promise<TestConnectionResult> {
    return fetchJson("/api/test-connection", { method: "POST" });
  },
  async saveSettings(settings: AppSettings) {
    return fetchJson("/api/save-settings", {
      method: "POST",
      body: JSON.stringify(settings),
    });
  },
  async createSession(input: { title: string; familyId: string }) {
    return fetchJson("/api/create-session", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async getSession(sessionId: string) {
    return fetchJson(`/api/sessions/${sessionId}`);
  },
  async updateSession(input: unknown) {
    return fetchJson("/api/update-session", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async runExtraction(input: unknown) {
    return fetchJson("/api/run-extraction", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async finalizeReport(input: unknown) {
    return fetchJson("/api/finalize-report", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async synthesizeSpeech(input: { text: string }) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (response.status === 501) {
      return null;
    }
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.blob();
  },
  async createRealtimeSession(offerSdp: string) {
    const response = await fetch("/api/realtime/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
      },
      body: offerSdp,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.text();
  },
  async exportLocalData() {
    const response = await fetch("/api/export-local-data");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eleanor-v3-export.json";
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true, canceled: false, filePath: "eleanor-v3-export.json" };
  },
  async exportKnowledgePack() {
    const response = await fetch("/api/export-knowledge-pack");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eleanor-knowledge-pack.md";
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true, canceled: false, filePath: "eleanor-knowledge-pack.md" };
  },
  async deleteLocalData() {
    return fetchJson("/api/delete-local-data", { method: "POST" });
  },
};

let cachedBridge: RendererBridge | null = null;

export function getBridge(): RendererBridge {
  if (window.eleanor) return window.eleanor;
  if (cachedBridge) return cachedBridge;
  cachedBridge = window.location.protocol.startsWith("http") ? webBridge : mockBridge;
  return cachedBridge;
}

export function hasNativeBridge() {
  return typeof window.eleanor !== "undefined";
}

async function fetchJson(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function buildMockFinalReport(session: SessionRecord, unsavedDraft: string): FinalReportResult {
  const captureEntries = Object.entries(session.capture).slice(-8);
  const pairs = captureEntries.map(([key, value]) => ({
    problem: `What is confirmed for ${key}?`,
    answer: typeof value === "string" ? value : shortText(JSON.stringify(value), 240),
    evidence: "Preview mode generated this from structured capture.",
  }));

  if (unsavedDraft.trim()) {
    pairs.push({
      problem: "What still needs review from the final typed note?",
      answer: shortText(unsavedDraft, 240),
      evidence: "Typed draft at finish time.",
    });
  }

  return {
    title: `${session.title} final report`,
    summary: pairs.length > 0 ? `Prepared ${pairs.length} problem-answer item${pairs.length === 1 ? "" : "s"}.` : "No answered items were captured yet.",
    problemAnswerPairs: pairs.length > 0 ? pairs : [{ problem: "What operational issue was resolved?", answer: "No structured answer has been captured yet.", evidence: "No structured capture." }],
    keyPoints: pairs.slice(0, 5).map((pair) => pair.answer),
    openQuestions: session.currentQuestion ? [session.currentQuestion] : ["No saved open question."],
  };
}

function shortText(text: string, maxLength = 240) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}
