import { describe, expect, it } from "vitest";
import { buildAssistantTurnText, isDuplicateQuestionCandidate } from "./assistant-turn.js";

describe("assistant turn text", () => {
  it("removes duplicated follow-up questions", () => {
    const spokenReply =
      "To start, when a prospective client first reaches out, what are the main ways that inquiry is received—phone, web form, email, referral, or something else?";
    const nextQuestion =
      "When a prospective client first reaches out, what are the main ways that inquiry is received—phone, web form, email, referral, or something else?";

    expect(isDuplicateQuestionCandidate(spokenReply, nextQuestion)).toBe(true);
    expect(buildAssistantTurnText(spokenReply, nextQuestion)).toBe(nextQuestion);
  });

  it("keeps a distinct acknowledgement before the question", () => {
    const spokenReply = "Got it. Let’s start with intake.";
    const nextQuestion = "How do prospective clients usually contact the firm?";

    expect(isDuplicateQuestionCandidate(spokenReply, nextQuestion)).toBe(false);
    expect(buildAssistantTurnText(spokenReply, nextQuestion)).toBe(`${spokenReply}\n\n${nextQuestion}`);
  });
});
