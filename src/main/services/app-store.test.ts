import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppStore } from "./app-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "eleanor-store-"));
  tempDirs.push(dir);
  return new AppStore(join(dir, "app-state.json"));
}

describe("AppStore", () => {
  it("exports saved state", async () => {
    const store = await createStore();
    await store.saveSession({
      id: "session-1",
      title: "F01",
      familyId: "F01",
      transcript: [],
      capture: {},
      leads: [],
      contradictions: [],
      progress: {},
      currentQuestion: "",
      lastAssistantReply: "",
      lastPriorityReason: "",
      missingCriticalFields: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    const exported = await store.exportState();
    expect(exported.sessions).toHaveLength(1);
    expect(exported.sessions[0]?.familyId).toBe("F01");
    expect(exported.settings.provider).toBe("openai");
    expect(exported.settings.realtimeModel).toBe("gpt-realtime");
  });

  it("resets persisted state", async () => {
    const store = await createStore();
    await store.saveSession({
      id: "session-1",
      title: "F01",
      familyId: "F01",
      transcript: [],
      capture: {},
      leads: [],
      contradictions: [],
      progress: {},
      currentQuestion: "",
      lastAssistantReply: "",
      lastPriorityReason: "",
      missingCriticalFields: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    await store.resetState();
    const sessions = await store.listSessions();
    expect(sessions).toEqual([]);
  });
});
