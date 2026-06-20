import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(buffer: Buffer): string;
};

export interface ApiKeyStore {
  hasApiKey(): Promise<boolean>;
  saveApiKey(apiKey: string): Promise<void>;
  getApiKey(): Promise<string>;
  deleteApiKey(): Promise<void>;
}

export class SecretStore implements ApiKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  async hasApiKey() {
    return existsSync(this.filePath);
  }

  async saveApiKey(apiKey: string) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Electron safeStorage encryption is not available on this machine.");
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const encrypted = this.safeStorage.encryptString(apiKey);
    await writeFile(this.filePath, encrypted);
  }

  async getApiKey() {
    if (!existsSync(this.filePath)) {
      throw new Error("No AI provider API key is saved yet.");
    }
    const buffer = await readFile(this.filePath);
    return this.safeStorage.decryptString(buffer);
  }

  async deleteApiKey() {
    if (existsSync(this.filePath)) {
      await unlink(this.filePath);
    }
  }
}
