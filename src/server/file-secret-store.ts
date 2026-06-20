import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApiKeyStore } from "../main/services/secret-store.js";

export class FileSecretStore implements ApiKeyStore {
  constructor(private readonly filePath: string) {}

  async hasApiKey() {
    return Boolean(process.env.ELEANOR_API_KEY) || existsSync(this.filePath);
  }

  async saveApiKey(apiKey: string) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, apiKey, "utf8");
  }

  async getApiKey() {
    if (process.env.ELEANOR_API_KEY) {
      return process.env.ELEANOR_API_KEY;
    }
    if (!existsSync(this.filePath)) {
      throw new Error("No AI provider API key is saved on the web server yet.");
    }
    return readFile(this.filePath, "utf8");
  }

  async deleteApiKey() {
    if (process.env.ELEANOR_API_KEY) {
      return;
    }
    if (existsSync(this.filePath)) {
      await unlink(this.filePath);
    }
  }
}
