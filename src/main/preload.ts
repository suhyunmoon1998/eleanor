import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "../shared/contracts.js";

const api = {
  bootstrap: () => ipcRenderer.invoke("eleanor:bootstrap"),
  saveApiKey: (apiKey: string) => ipcRenderer.invoke("eleanor:save-api-key", { apiKey }),
  deleteApiKey: () => ipcRenderer.invoke("eleanor:delete-api-key"),
  testConnection: () => ipcRenderer.invoke("eleanor:test-connection"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("eleanor:save-settings", settings),
  createSession: (input: { title: string; familyId: string }) => ipcRenderer.invoke("eleanor:create-session", input),
  getSession: (sessionId: string) => ipcRenderer.invoke("eleanor:get-session", sessionId),
  updateSession: (input: unknown) => ipcRenderer.invoke("eleanor:update-session", input),
  runExtraction: (input: unknown) => ipcRenderer.invoke("eleanor:run-extraction", input),
  finalizeReport: (input: unknown) => ipcRenderer.invoke("eleanor:finalize-report", input),
  createRealtimeSession: (offerSdp: string) => ipcRenderer.invoke("eleanor:create-realtime-session", offerSdp),
  exportLocalData: () => ipcRenderer.invoke("eleanor:export-local-data"),
  deleteLocalData: () => ipcRenderer.invoke("eleanor:delete-local-data"),
};

contextBridge.exposeInMainWorld("eleanor", api);

declare global {
  interface Window {
    eleanor: typeof api;
  }
}
