import { describe, expect, it } from "vitest";
import { appSettingsSchema, sessionSchema } from "./contracts.js";

describe("contracts", () => {
  it("fills default settings", () => {
    const parsed = appSettingsSchema.parse({});
    expect(parsed.provider).toBe("local");
    expect(parsed.realtimeModel).toBe("local-archive");
    expect(parsed.extractionModel).toBe("local-archive");
    expect(parsed.voice).toBe("coral");
  });

  it("accepts a minimal session", () => {
    const parsed = sessionSchema.parse({
      id: "1",
      title: "Test",
      familyId: "F01",
      updatedAt: "2026-06-20T00:00:00.000Z",
      createdAt: "2026-06-20T00:00:00.000Z",
    });
    expect(parsed.transcript).toEqual([]);
    expect(parsed.capture).toEqual({});
  });
});
