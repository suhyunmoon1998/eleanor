import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc.js";
import { AIService } from "./services/ai-service.js";
import { AppStore } from "./services/app-store.js";
import { SourceRepository } from "./services/source-repository.js";
import { SecretStore } from "./services/secret-store.js";

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 820,
    backgroundColor: "#f3eee4",
    webPreferences: {
      preload: join(app.getAppPath(), "dist-electron", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    await window.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }

  return window;
}

async function boot() {
  await app.whenReady();

  const userDataDir = app.getPath("userData");
  const dataRoot = process.env.ELEANOR_DATA_ROOT || userDataDir;
  await mkdir(dataRoot, { recursive: true });

  const appStore = new AppStore(join(dataRoot, "app-state.json"));
  const secretStore = new SecretStore(join(dataRoot, "secrets.bin"), safeStorage);
  const sources = new SourceRepository(join(app.getAppPath(), "generated-data"));
  const ai = new AIService(secretStore, appStore, sources);

  registerIpcHandlers({ appStore, ai, secretStore, sources, dataRoot });

  mainWindow = await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  ipcMain.removeHandler("eleanor:bootstrap");
  ipcMain.removeHandler("eleanor:save-api-key");
  ipcMain.removeHandler("eleanor:delete-api-key");
  ipcMain.removeHandler("eleanor:test-connection");
  ipcMain.removeHandler("eleanor:save-settings");
  ipcMain.removeHandler("eleanor:create-session");
  ipcMain.removeHandler("eleanor:update-session");
  ipcMain.removeHandler("eleanor:get-session");
  ipcMain.removeHandler("eleanor:run-extraction");
  ipcMain.removeHandler("eleanor:create-realtime-session");
  ipcMain.removeHandler("eleanor:export-local-data");
  ipcMain.removeHandler("eleanor:delete-local-data");
});

boot().catch((error) => {
  console.error("Failed to boot Eleanor:", error);
  app.exit(1);
});
