import { z } from "zod";

export const appSettingsSchema = z.object({
  provider: z.enum(["openai", "anthropic"]).default("openai"),
  realtimeModel: z.string().default("gpt-realtime"),
  fallbackRealtimeModel: z.string().default("gpt-realtime-mini"),
  extractionModel: z.string().default("gpt-5.2"),
  fallbackExtractionModel: z.string().default("gpt-5-mini"),
  voice: z.string().default("coral"),
  selectedInputDeviceId: z.string().optional(),
  selectedOutputDeviceId: z.string().optional(),
});

export const transcriptEntrySchema = z.object({
  id: z.string(),
  role: z.enum(["assistant", "user", "system"]),
  text: z.string(),
  createdAt: z.string(),
});

export const interviewLeadSchema = z.object({
  text: z.string(),
  kind: z.enum(["case-development", "client-management", "client-development", "parked"]),
});

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  familyId: z.string(),
  transcript: z.array(transcriptEntrySchema).default([]),
  capture: z.record(z.string(), z.unknown()).default({}),
  leads: z.array(interviewLeadSchema).default([]),
  contradictions: z.array(z.string()).default([]),
  progress: z.record(z.string(), z.array(z.string())).default({}),
  currentQuestion: z.string().default(""),
  lastAssistantReply: z.string().default(""),
  lastPriorityReason: z.string().default(""),
  missingCriticalFields: z.array(z.string()).default([]),
  updatedAt: z.string(),
  createdAt: z.string(),
});

export const bootstrapStateSchema = z.object({
  hasApiKey: z.boolean(),
  settings: appSettingsSchema,
  storagePath: z.string(),
  sourceSummary: z.object({
    familyCount: z.number(),
    sectionCount: z.number(),
    nomenclatureCount: z.number(),
  }),
  families: z.array(
    z.object({
      familyId: z.string(),
      title: z.string(),
      interviewGoal: z.string(),
      triggerCount: z.number(),
      sectionTitles: z.array(z.string()),
      expectedTriggerNames: z.array(z.string()).default([]),
      risk: z.string().optional(),
    }),
  ),
  recentSessions: z.array(sessionSchema),
});

export const testConnectionResultSchema = z.object({
  ok: z.boolean(),
  models: z.array(z.string()).default([]),
  message: z.string(),
  checkedModels: z.array(z.string()).default([]),
  missingModels: z.array(z.string()).default([]),
});

export const extractionResultSchema = z.object({
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

export const problemAnswerPairSchema = z.object({
  problem: z.string(),
  answer: z.string(),
  evidence: z.string().nullable(),
});

export const finalReportResultSchema = z.object({
  title: z.string(),
  summary: z.string(),
  problemAnswerPairs: z.array(problemAnswerPairSchema).default([]),
  keyPoints: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export const finalReportInputSchema = z.object({
  session: sessionSchema,
  lastExtraction: extractionResultSchema.nullish(),
  unsavedDraft: z.string().optional(),
});

export const saveApiKeyInputSchema = z.object({
  apiKey: z.string().min(10),
});

export const saveApiKeyResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  checkedModels: z.array(z.string()).default([]),
});

export const saveSettingsInputSchema = appSettingsSchema;

export const createSessionInputSchema = z.object({
  title: z.string().min(1),
  familyId: z.string().min(1),
});

export const updateSessionInputSchema = z.object({
  sessionId: z.string(),
  familyId: z.string().optional(),
  transcriptEntry: transcriptEntrySchema.optional(),
  capturePatch: z.record(z.string(), z.unknown()).optional(),
  contradictions: z.array(z.string()).optional(),
  triggerIds: z.array(z.string()).optional(),
  leads: z.array(interviewLeadSchema).optional(),
  currentQuestion: z.string().optional(),
  lastAssistantReply: z.string().optional(),
  lastPriorityReason: z.string().optional(),
  missingCriticalFields: z.array(z.string()).optional(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AiProvider = AppSettings["provider"];
export type BootstrapState = z.infer<typeof bootstrapStateSchema>;
export type SessionRecord = z.infer<typeof sessionSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type FinalReportResult = z.infer<typeof finalReportResultSchema>;
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;
export type SaveApiKeyResult = z.infer<typeof saveApiKeyResultSchema>;
