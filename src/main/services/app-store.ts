import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appSettingsSchema, sessionSchema, type AppSettings, type SessionRecord } from "../../shared/contracts.js";

type AppState = {
  settings: AppSettings;
  sessions: SessionRecord[];
};

const defaultState: AppState = {
  settings: appSettingsSchema.parse({}),
  sessions: [],
};

function localArchiveSettings(settings: Partial<AppSettings> = {}): AppSettings {
  return {
    ...appSettingsSchema.parse(settings),
    provider: "local",
    realtimeModel: "local-archive",
    fallbackRealtimeModel: "local-archive",
    extractionModel: "local-archive",
    fallbackExtractionModel: "local-archive",
  };
}

export class AppStore {
  constructor(private readonly filePath: string) {}

  async getSettings(): Promise<AppSettings> {
    return (await this.readState()).settings;
  }

  async saveSettings(settings: AppSettings) {
    const state = await this.readState();
    state.settings = localArchiveSettings(settings);
    await this.writeState(state);
  }

  async listSessions(): Promise<SessionRecord[]> {
    const state = await this.readState();
    return [...state.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const state = await this.readState();
    return state.sessions.find((session) => session.id === id) ?? null;
  }

  async saveSession(session: SessionRecord) {
    const state = await this.readState();
    const parsed = sessionSchema.parse(session);
    state.sessions = state.sessions.filter((item) => item.id !== parsed.id).concat(parsed);
    await this.writeState(state);
  }

  async exportState(): Promise<AppState> {
    return this.readState();
  }

  async resetState() {
    if (existsSync(this.filePath)) {
      await rm(this.filePath, { force: true });
    }
  }

  async updateSession(input: {
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
  }) {
    const state = await this.readState();
    const session = state.sessions.find((item) => item.id === input.sessionId);
    if (!session) {
      throw new Error(`Session ${input.sessionId} was not found.`);
    }

    if (input.familyId) session.familyId = input.familyId;
    if (input.transcriptEntry) session.transcript.push(input.transcriptEntry);
    if (input.capturePatch) session.capture = { ...session.capture, ...input.capturePatch };
    if (input.contradictions?.length) session.contradictions = [...new Set([...session.contradictions, ...input.contradictions])];
    if (input.leads?.length) session.leads = [...session.leads, ...input.leads];
    if (typeof input.currentQuestion === "string") session.currentQuestion = input.currentQuestion;
    if (typeof input.lastAssistantReply === "string") session.lastAssistantReply = input.lastAssistantReply;
    if (typeof input.lastPriorityReason === "string") session.lastPriorityReason = input.lastPriorityReason;
    if (input.missingCriticalFields) session.missingCriticalFields = [...input.missingCriticalFields];
    if (input.triggerIds?.length) {
      const current = new Set(session.progress[session.familyId] ?? []);
      for (const triggerId of input.triggerIds) current.add(triggerId);
      session.progress[session.familyId] = [...current];
    }

    session.updatedAt = new Date().toISOString();
    await this.writeState(state);
    return session;
  }

  private async readState(): Promise<AppState> {
    if (!existsSync(this.filePath)) {
      return structuredClone(defaultState);
    }

    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      settings: localArchiveSettings(parsed.settings ?? {}),
      sessions: (parsed.sessions ?? []).map((session) => sessionSchema.parse(session)),
    };
  }

  private async writeState(state: AppState) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}
