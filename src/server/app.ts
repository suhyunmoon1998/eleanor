import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createSessionInputSchema,
  saveApiKeyInputSchema,
  saveSettingsInputSchema,
  updateSessionInputSchema,
} from "../shared/contracts.js";
import { AIService } from "../main/services/ai-service.js";
import { AppStore } from "../main/services/app-store.js";
import { SourceRepository } from "../main/services/source-repository.js";
import { FileSecretStore } from "./file-secret-store.js";

type ServerAppOptions = {
  serveStatic?: boolean;
};

function getDataRoot(appRoot: string) {
  if (process.env.ELEANOR_WEB_DATA_ROOT) {
    return process.env.ELEANOR_WEB_DATA_ROOT;
  }
  if (process.env.VERCEL) {
    return "/tmp/eleanor-app-data";
  }
  return resolve(appRoot, "app-data-web");
}

export async function buildServerApp(options: ServerAppOptions = {}) {
  const appRoot = process.cwd();
  const distRoot = resolve(appRoot, "dist");
  const generatedDataRoot = resolve(appRoot, "generated-data");
  const dataRoot = getDataRoot(appRoot);

  await mkdir(dataRoot, { recursive: true });

  const appStore = new AppStore(join(dataRoot, "app-state.json"));
  const secretStore = new FileSecretStore(join(dataRoot, "server-api-key.txt"));
  const sources = new SourceRepository(generatedDataRoot);
  const ai = new AIService(secretStore, appStore, sources);

  const app = fastify({
    logger: false,
    bodyLimit: 12_000_000,
  });

  app.addContentTypeParser("application/sdp", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.get("/api/health", async () => {
    const settings = await appStore.getSettings();
    return {
      ok: true,
      apiConfigured: await secretStore.hasApiKey(),
      provider: settings.provider,
      realtimeModel: settings.realtimeModel,
      extractionModel: settings.extractionModel,
    };
  });

  app.get("/api/bootstrap", async () => {
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

  app.post("/api/save-api-key", async (request) => {
    const { apiKey } = saveApiKeyInputSchema.parse(request.body);
    return ai.validateAndSaveApiKey(apiKey);
  });

  app.post("/api/delete-api-key", async () => {
    await secretStore.deleteApiKey();
    return { ok: true };
  });

  app.post("/api/test-connection", async () => ai.testConnection());

  app.post("/api/save-settings", async (request) => {
    const settings = saveSettingsInputSchema.parse(request.body);
    await appStore.saveSettings(settings);
    return settings;
  });

  app.post("/api/create-session", async (request) => {
    const parsed = createSessionInputSchema.parse(request.body);
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

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await appStore.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found." };
    }
    return session;
  });

  app.post("/api/update-session", async (request) => {
    const parsed = updateSessionInputSchema.parse(request.body);
    return appStore.updateSession(parsed);
  });

  app.post("/api/run-extraction", async (request) => ai.runExtraction(request.body));

  app.post("/api/finalize-report", async (request) => ai.finalizeReport(request.body));

  app.post("/api/realtime/session", async (request, reply) => {
    const offerSdp = typeof request.body === "string" ? request.body : "";
    const answerSdp = await ai.createRealtimeSession(offerSdp);
    reply.header("content-type", "application/sdp");
    return answerSdp;
  });

  app.get("/api/export-local-data", async (_request, reply) => {
    const exportData = await appStore.exportState();
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="eleanor-v3-export.json"');
    return {
      exportedAt: new Date().toISOString(),
      storagePath: dataRoot,
      data: exportData,
    };
  });

  app.post("/api/delete-local-data", async () => {
    await appStore.resetState();
    await secretStore.deleteApiKey();
    return { ok: true };
  });

  if (options.serveStatic && existsSync(distRoot)) {
    await app.register(fastifyStatic, {
      root: resolve(distRoot, "assets"),
      prefix: "/assets/",
    });

    app.get("/", async (_request, reply) => {
      return reply.sendFile("index.html", distRoot);
    });

    app.get("/*", async (_request, reply) => {
      return reply.sendFile("index.html", distRoot);
    });
  }

  return app;
}
