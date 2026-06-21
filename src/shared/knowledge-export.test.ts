import { describe, expect, it } from "vitest";
import { appSettingsSchema, type SessionRecord } from "./contracts.js";
import { buildKnowledgePackMarkdown } from "./knowledge-export.js";

describe("knowledge export", () => {
  it("includes the full transcript and unmapped context", () => {
    const session: SessionRecord = {
      id: "session-1",
      title: "F01 — Lead, screening, and consultation",
      familyId: "F01",
      transcript: [
        {
          id: "turn-1",
          role: "user",
          text: "The client may describe a lot of detail that does not map to a field yet.",
          createdAt: "2026-06-21T17:00:00.000Z",
        },
        {
          id: "turn-2",
          role: "assistant",
          text: "I will keep that in the archive and ask the next question.",
          createdAt: "2026-06-21T17:01:00.000Z",
        },
      ],
      capture: {
        intakeContext: "Preserve extra firm workflow details.",
      },
      leads: [{ kind: "parked", text: "Review later for K-Sync mapping." }],
      contradictions: ["Timing needs confirmation."],
      progress: { F01: ["trigger-1"] },
      currentQuestion: "What happens next?",
      lastAssistantReply: "Thanks, I captured that.",
      lastPriorityReason: "It may become a rule later.",
      missingCriticalFields: ["Responsible owner"],
      createdAt: "2026-06-21T17:00:00.000Z",
      updatedAt: "2026-06-21T17:02:00.000Z",
    };

    const markdown = buildKnowledgePackMarkdown({
      exportedAt: "2026-06-21T17:03:00.000Z",
      storagePath: "/tmp/eleanor",
      data: {
        settings: appSettingsSchema.parse({}),
        sessions: [session],
      },
    });

    expect(markdown).toContain("Eleanor Knowledge Pack");
    expect(markdown).toContain("The client may describe a lot of detail");
    expect(markdown).toContain("Preserve extra firm workflow details.");
    expect(markdown).toContain("[parked] Review later for K-Sync mapping.");
    expect(markdown).toContain("Responsible owner");
  });
});
