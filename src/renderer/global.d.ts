import type {
  AppSettings,
  BootstrapState,
  ExtractionResult,
  SaveApiKeyResult,
  SessionRecord,
  TestConnectionResult,
} from "../shared/contracts.js";

declare global {
  interface Window {
    eleanor: {
      bootstrap: () => Promise<BootstrapState>;
      saveApiKey: (apiKey: string) => Promise<SaveApiKeyResult>;
      deleteApiKey: () => Promise<{ ok: boolean }>;
      testConnection: () => Promise<TestConnectionResult>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      createSession: (input: { title: string; familyId: string }) => Promise<SessionRecord>;
      getSession: (sessionId: string) => Promise<SessionRecord | null>;
      updateSession: (input: unknown) => Promise<SessionRecord>;
      runExtraction: (input: unknown) => Promise<ExtractionResult>;
      createRealtimeSession: (offerSdp: string) => Promise<string>;
      exportLocalData: () => Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
      deleteLocalData: () => Promise<{ ok: boolean }>;
    };
  }
}

export {};
