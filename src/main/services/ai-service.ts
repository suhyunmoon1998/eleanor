import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { buildExtractionInstructions, ELEANOR_VOICE_INSTRUCTIONS } from "../../shared/prompting.js";
import type { AppSettings } from "../../shared/contracts.js";
import type { AppStore } from "./app-store.js";
import type { ApiKeyStore } from "./secret-store.js";
import type { SourceRepository } from "./source-repository.js";

const extractionSchema = z.object({
  spokenReply: z.string(),
  nextQuestion: z.string(),
  priorityReason: z.string(),
  capturePatch: z.record(z.string(), z.unknown()).default({}),
  missingCriticalFields: z.array(z.string()).default([]),
  atomicTriggerIds: z.array(z.string()).default([]),
  caseDevelopmentLeads: z.array(z.string()).default([]),
  clientManagementLeads: z.array(z.string()).default([]),
  clientDevelopmentLeads: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  parkedItems: z.array(z.string()).default([]),
});

type ExtractionPayload = {
  familyId: string;
  transcript: string;
  currentQuestion?: string;
  priorCapture?: Record<string, unknown>;
  openLoops?: string[];
  parkedItems?: string[];
};

type TestConnectionResult = {
  ok: boolean;
  models: string[];
  checkedModels: string[];
  missingModels: string[];
  message: string;
};

const ANTHROPIC_VERSION = "2023-06-01";

export class AIService {
  constructor(
    private readonly secretStore: ApiKeyStore,
    private readonly appStore: AppStore,
    private readonly sources: SourceRepository,
  ) {}

  async validateAndSaveApiKey(apiKey: string) {
    await this.secretStore.saveApiKey(apiKey);
    try {
      const result = await this.testConnection();
      return {
        ok: true,
        message: result.message,
        checkedModels: result.checkedModels,
      };
    } catch (error) {
      await this.secretStore.deleteApiKey();
      throw error;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const settings = await this.appStore.getSettings();
    if (settings.provider === "anthropic") {
      return this.testAnthropicConnection(settings);
    }
    return this.testOpenAIConnection(settings);
  }

  async createRealtimeSession(offerSdp: string) {
    const apiKey = await this.secretStore.getApiKey();
    const settings = await this.appStore.getSettings();
    if (settings.provider !== "openai") {
      throw new Error("Live voice is only available with the OpenAI provider in the current Eleanor build.");
    }
    if (!offerSdp.includes("v=0")) {
      throw new Error("Expected a valid WebRTC SDP offer.");
    }

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: this.buildRealtimeFormData({
        offerSdp,
        realtimeModel: settings.realtimeModel,
        voice: settings.voice,
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(body || `Realtime session creation failed with ${response.status}.`);
    }
    return body;
  }

  async runExtraction(input: unknown) {
    const settings = await this.appStore.getSettings();
    if (settings.provider === "anthropic") {
      return this.runAnthropicExtraction(input as ExtractionPayload, settings);
    }
    return this.runOpenAIExtraction(input as ExtractionPayload, settings);
  }

  private async testOpenAIConnection(settings: AppSettings): Promise<TestConnectionResult> {
    const client = await this.getOpenAIClient();
    const checkedModels = [settings.realtimeModel, settings.fallbackRealtimeModel, settings.extractionModel, settings.fallbackExtractionModel];
    const checks = await Promise.allSettled(checkedModels.map((model) => client.models.retrieve(model)));
    const availableModels: string[] = [];
    const missingModels: string[] = [];

    checks.forEach((result, index) => {
      const model = checkedModels[index];
      if (result.status === "fulfilled") {
        availableModels.push(model);
      } else {
        missingModels.push(model);
      }
    });

    if (missingModels.length > 0) {
      throw new Error(`The API key was accepted, but these configured models were not available: ${missingModels.join(", ")}.`);
    }

    return {
      ok: true,
      models: availableModels,
      checkedModels,
      missingModels,
      message: `Connection verified for OpenAI live voice and extraction. Primary voice model: ${settings.realtimeModel}. Primary extraction model: ${settings.extractionModel}.`,
    };
  }

  private async testAnthropicConnection(settings: AppSettings): Promise<TestConnectionResult> {
    const checkedModels = [settings.extractionModel, settings.fallbackExtractionModel];
    const checks = await Promise.allSettled(checkedModels.map((model) => this.pingAnthropicModel(model)));
    const availableModels: string[] = [];
    const missingModels: string[] = [];

    checks.forEach((result, index) => {
      const model = checkedModels[index];
      if (result.status === "fulfilled") {
        availableModels.push(model);
      } else {
        missingModels.push(model);
      }
    });

    if (missingModels.length > 0) {
      throw new Error(`The API key was accepted, but these configured Claude models were not available: ${missingModels.join(", ")}.`);
    }

    return {
      ok: true,
      models: availableModels,
      checkedModels,
      missingModels,
      message: `Connection verified for Claude structured extraction. Primary extraction model: ${settings.extractionModel}. Live browser voice remains OpenAI-only in this build.`,
    };
  }

  private async runOpenAIExtraction(input: ExtractionPayload, settings: AppSettings) {
    const client = await this.getOpenAIClient();
    const { family, familyAtlas } = await this.getExtractionContext(input.familyId);

    const response = await client.responses.parse({
      model: settings.extractionModel,
      instructions: buildExtractionInstructions(),
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Voice instructions:\n${ELEANOR_VOICE_INSTRUCTIONS}`,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  family,
                  familyAtlas,
                  currentQuestion: input.currentQuestion ?? "",
                  transcript: input.transcript,
                  priorCapture: input.priorCapture ?? {},
                  openLoops: input.openLoops ?? [],
                  parkedItems: input.parkedItems ?? [],
                },
                null,
                2,
              ),
            },
          ],
        },
      ],
      text: {
        format: zodTextFormat(extractionSchema, "eleanor_interview_result"),
      },
    });

    return response.output_parsed;
  }

  private async runAnthropicExtraction(input: ExtractionPayload, settings: AppSettings) {
    const { family, familyAtlas } = await this.getExtractionContext(input.familyId);
    const requestPayload = {
      family,
      familyAtlas,
      currentQuestion: input.currentQuestion ?? "",
      transcript: input.transcript,
      priorCapture: input.priorCapture ?? {},
      openLoops: input.openLoops ?? [],
      parkedItems: input.parkedItems ?? [],
    };

    const system = [
      buildExtractionInstructions(),
      "Return only valid JSON with no markdown fence and no commentary.",
      "The JSON object must include exactly these keys:",
      "spokenReply, nextQuestion, priorityReason, capturePatch, missingCriticalFields, atomicTriggerIds, caseDevelopmentLeads, clientManagementLeads, clientDevelopmentLeads, contradictions, parkedItems.",
      "spokenReply and nextQuestion should sound like Eleanor interviewing the user to capture operational knowledge for later K-Sync / CaseSync mapping.",
      `Voice instructions:\n${ELEANOR_VOICE_INSTRUCTIONS}`,
    ].join("\n\n");

    const body = await this.createAnthropicMessage(settings.extractionModel, {
      system,
      messages: [
        {
          role: "user",
          content: JSON.stringify(requestPayload, null, 2),
        },
      ],
      max_tokens: 2400,
    }, settings.fallbackExtractionModel);

    return extractionSchema.parse(JSON.parse(this.extractJsonText(body)));
  }

  private async getExtractionContext(familyId: string) {
    const atlas = await this.sources.getAtlas();
    const familySummaries = await this.sources.getFamilies();
    const family = familySummaries.find((item) => item.familyId === familyId);
    const familyAtlas = atlas.families.find((item) => item.family_id === familyId);

    return { family, familyAtlas };
  }

  private async getOpenAIClient() {
    const apiKey = await this.secretStore.getApiKey();
    return new OpenAI({ apiKey });
  }

  private async pingAnthropicModel(model: string) {
    await this.createAnthropicMessage(model, {
      system: "Reply with OK.",
      messages: [{ role: "user", content: "OK" }],
      max_tokens: 8,
    });
  }

  private async createAnthropicMessage(
    model: string,
    payload: {
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      max_tokens: number;
    },
    fallbackModel?: string,
  ) {
    try {
      return await this.postAnthropicMessage(model, payload);
    } catch (error) {
      if (!fallbackModel || fallbackModel === model) {
        throw error;
      }
      return this.postAnthropicMessage(fallbackModel, payload);
    }
  }

  private async postAnthropicMessage(
    model: string,
    payload: {
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      max_tokens: number;
    },
  ) {
    const apiKey = await this.secretStore.getApiKey();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        system: payload.system,
        messages: payload.messages,
        max_tokens: payload.max_tokens,
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(body || `Anthropic request failed with ${response.status}.`);
    }

    return body;
  }

  private extractJsonText(body: string) {
    const parsed = JSON.parse(body) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (parsed.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Claude returned an empty response.");
    }

    return text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  private buildRealtimeFormData(input: { offerSdp: string; realtimeModel: string; voice: string }) {
    const form = new FormData();
    form.set("sdp", input.offerSdp);
    form.set(
      "session",
      JSON.stringify({
        type: "realtime",
        model: input.realtimeModel,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: "gpt-realtime-whisper",
            },
            turn_detection: {
              type: "semantic_vad",
              create_response: false,
              interrupt_response: false,
            },
          },
          output: {
            voice: input.voice,
          },
        },
        instructions: ELEANOR_VOICE_INSTRUCTIONS,
      }),
    );
    return form;
  }
}
