import type { Buffer } from "node:buffer";
import { z } from "zod";
import {
  finalReportInputSchema,
  finalReportResultSchema,
  type ExtractionResult,
  type FinalReportResult,
} from "../../shared/contracts.js";
import type { AppStore } from "./app-store.js";
import type { ApiKeyStore } from "./secret-store.js";
import type { SourceRepository } from "./source-repository.js";

type TestConnectionResult = {
  ok: boolean;
  models: string[];
  checkedModels: string[];
  missingModels: string[];
  message: string;
};

type SpeechResult = {
  audio: Buffer;
  contentType: string;
} | null;

const extractionPayloadSchema = z.object({
  familyId: z.string(),
  transcript: z.string(),
  currentQuestion: z.string().optional(),
});

function shortText(text: string, maxLength = 220) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function nextLocalQuestion(currentQuestion?: string) {
  if (currentQuestion?.trim()) {
    return "What else should Eleanor keep with that note for the future Eleanor 2.0 build?";
  }
  return "What should Eleanor remember next about this workflow?";
}

function buildLocalProblemAnswerPairs(input: z.infer<typeof finalReportInputSchema>): FinalReportResult["problemAnswerPairs"] {
  const userTurns = input.session.transcript.filter((entry) => entry.role === "user");
  const pairs = userTurns.slice(-12).map((entry, index) => ({
    problem: `Conversation detail ${index + 1}`,
    answer: shortText(entry.text, 500) || "No saved answer text.",
    evidence: `Saved ${entry.createdAt}`,
  }));

  if (input.unsavedDraft?.trim()) {
    pairs.push({
      problem: "Unsaved draft",
      answer: shortText(input.unsavedDraft, 500),
      evidence: "Draft text present when the interview ended.",
    });
  }

  return pairs.length > 0
    ? pairs
    : [{ problem: "Conversation archive", answer: "No user conversation turns were saved yet.", evidence: null }];
}

export class AIService {
  constructor(
    private readonly secretStore: ApiKeyStore,
    private readonly appStore: AppStore,
    private readonly sources: SourceRepository,
  ) {}

  async validateAndSaveApiKey(_apiKey: string) {
    await this.secretStore.deleteApiKey();
    const result = await this.testConnection();
    return {
      ok: true,
      message: result.message,
      checkedModels: result.checkedModels,
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    return {
      ok: true,
      models: ["local-archive"],
      checkedModels: ["local-archive"],
      missingModels: [],
      message: "OpenAI API has been removed. Eleanor is running in local archive mode for the Eleanor 2.0 rebuild.",
    };
  }

  async createRealtimeSession(_offerSdp: string) {
    throw new Error("OpenAI realtime voice has been removed. Use local notes/export mode while Eleanor 2.0 is being rebuilt.");
  }

  async runExtraction(input: unknown): Promise<ExtractionResult> {
    const parsed = extractionPayloadSchema.parse(input);
    const now = new Date().toISOString();
    const transcript = parsed.transcript.trim();
    return {
      spokenReply: "Saved locally.",
      nextQuestion: nextLocalQuestion(parsed.currentQuestion),
      priorityReason: "Local archive mode keeps the conversation without sending it to an external AI API.",
      capturePatch: {
        [`localArchive.${now}`]: {
          operation: "add",
          entity: "source",
          entityId: parsed.familyId,
          field: "conversationDetail",
          value: transcript,
          status: "Confirmed by Jack",
        },
      },
      missingCriticalFields: [],
      atomicTriggerIds: [],
      caseDevelopmentLeads: [],
      clientManagementLeads: [],
      clientDevelopmentLeads: [],
      contradictions: [],
      parkedItems: transcript ? [transcript] : [],
    };
  }

  async finalizeReport(input: unknown): Promise<FinalReportResult> {
    const parsed = finalReportInputSchema.parse(input);
    const userTurns = parsed.session.transcript.filter((entry) => entry.role === "user");
    const latestUserTurns = userTurns.slice(-6).map((entry) => shortText(entry.text, 240));
    return finalReportResultSchema.parse({
      title: `${parsed.session.title} archive`,
      summary:
        userTurns.length > 0
          ? `Saved ${userTurns.length} user turn${userTurns.length === 1 ? "" : "s"} locally for the Eleanor 2.0 rebuild.`
          : "No user turns were saved yet.",
      problemAnswerPairs: buildLocalProblemAnswerPairs(parsed),
      keyPoints: latestUserTurns.length > 0 ? latestUserTurns : ["No finalized user answers yet."],
      openQuestions: [parsed.session.currentQuestion || "Continue gathering workflow details for Eleanor 2.0."],
    });
  }

  async synthesizeSpeech(_input: unknown): Promise<SpeechResult> {
    return null;
  }
}
