import { dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import {
  createSessionInputSchema,
  saveApiKeyInputSchema,
  saveSettingsInputSchema,
  updateSessionInputSchema,
} from "../shared/contracts.js";
import type { AIService } from "./services/ai-service.js";
import type { AppStore } from "./services/app-store.js";
import type { SecretStore } from "./services/secret-store.js";
import type { SourceRepository } from "./services/source-repository.js";

type Dependencies = {
  appStore: AppStore;
  ai: AIService;
  secretStore: SecretStore;
  sources: SourceRepository;
  dataRoot: string;
};

export function registerIpcHandlers({ appStore, ai, secretStore, sources, dataRoot }: Dependencies) {
  ipcMain.handle("eleanor:bootstrap", async () => {
    const settings = await appStore.getSettings();
    const recentSessions = await appStore.listSessions();
    const sourceSummary = await sources.getSummary();
    const families = await sources.getFamilies();

    return {
      hasApiKey: await secretStore.hasApiKey(),
      settings,
      storagePath: dataRoot,
      sourceSummary,
      families,
      recentSessions: recentSessions.slice(0, 10),
    };
  });

  ipcMain.handle("eleanor:save-api-key", async (_event, input) => {
    const { apiKey } = saveApiKeyInputSchema.parse(input);
    return ai.validateAndSaveApiKey(apiKey);
  });

  ipcMain.handle("eleanor:delete-api-key", async () => {
    await secretStore.deleteApiKey();
    return { ok: true };
  });

  ipcMain.handle("eleanor:test-connection", async () => ai.testConnection());

  ipcMain.handle("eleanor:save-settings", async (_event, input) => {
    const settings = saveSettingsInputSchema.parse(input);
    await appStore.saveSettings(settings);
    return settings;
  });

  ipcMain.handle("eleanor:create-session", async (_event, input) => {
    const parsed = createSessionInputSchema.parse(input);
    const now = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      title: parsed.title,
      familyId: parsed.familyId,
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
    await appStore.saveSession(session);
    return session;
  });

  ipcMain.handle("eleanor:get-session", async (_event, sessionId: string) => appStore.getSession(sessionId));

  ipcMain.handle("eleanor:update-session", async (_event, input) => {
    const parsed = updateSessionInputSchema.parse(input);
    return appStore.updateSession(parsed);
  });

  ipcMain.handle("eleanor:run-extraction", async (_event, input) => ai.runExtraction(input));
  ipcMain.handle("eleanor:create-realtime-session", async (_event, offerSdp: string) => ai.createRealtimeSession(offerSdp));
  ipcMain.handle("eleanor:export-local-data", async () => {
    const exportData = await appStore.exportState();
    const result = await dialog.showSaveDialog({
      title: "Export Eleanor local data",
      defaultPath: "eleanor-v3-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    await writeFile(
      result.filePath,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          storagePath: dataRoot,
          data: exportData,
        },
        null,
        2,
      ),
      "utf8",
    );

    return { ok: true, canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("eleanor:delete-local-data", async () => {
    await appStore.resetState();
    await secretStore.deleteApiKey();
    return { ok: true };
  });
}
