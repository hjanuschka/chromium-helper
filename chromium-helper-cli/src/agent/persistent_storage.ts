// For saving agent data persistently

import fs from 'node:fs/promises';
import path from 'node:path';

const STORAGE_DIR = path.join(process.cwd(), '.ch_agent_data'); // Or use OS-specific app data dir

export class PersistentStorage {
  private storagePath: string;

  constructor(agentName: string) {
    this.storagePath = path.join(STORAGE_DIR, `${agentName}.json`);
    this.ensureStorageDirExists();
  }

  private async ensureStorageDirExists(): Promise<void> {
    try {
      await fs.mkdir(STORAGE_DIR, { recursive: true });
    } catch (error) {
      console.error("Failed to create storage directory:", error);
    }
  }

  public async saveData(data: unknown): Promise<void> {
    try {
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
      console.log(`Data saved for agent to ${this.storagePath}`);
    } catch (error) {
      console.error(`Failed to save data to ${this.storagePath}:`, error);
    }
  }

  public async loadData<T>(): Promise<T | null> {
    try {
      const fileContent = await fs.readFile(this.storagePath, 'utf-8');
      return JSON.parse(fileContent) as T;
    } catch (error) {
      // If file doesn't exist or other error, return null
      // console.warn(`Could not load data from ${this.storagePath}:`, error.message);
      return null;
    }
  }
}
