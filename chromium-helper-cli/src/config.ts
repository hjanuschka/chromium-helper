import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface Config {
  apiKey?: string;
  outputFormat?: 'json' | 'table' | 'plain';
  defaultLimit?: number;
}

const CONFIG_FILE_NAME = '.chromium-helper.json';

async function getConfigPath(): Promise<string> {
  // Check for config file in the following order:
  // 1. Current working directory
  // 2. User home directory
  const cwd = process.cwd();
  const home = os.homedir();
  
  const cwdConfig = path.join(cwd, CONFIG_FILE_NAME);
  const homeConfig = path.join(home, CONFIG_FILE_NAME);
  
  // Return the first one that exists, or default to home directory
  try {
    await fs.access(cwdConfig);
    return cwdConfig;
  } catch {
    // File doesn't exist in cwd, use home directory
    return homeConfig;
  }
}

export async function loadConfig(): Promise<Config> {
  const defaultConfig: Config = {
    apiKey: process.env.CHROMIUM_SEARCH_API_KEY || 'AIzaSyCqPSptx9mClE5NU4cpfzr6cgdO_phV1lM',
    outputFormat: 'plain',
    defaultLimit: 20
  };

  try {
    const configPath = await getConfigPath();
    const configData = await fs.readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(configData);
    
    return {
      ...defaultConfig,
      ...fileConfig
    };
  } catch (error) {
    // Config file doesn't exist or is invalid, use defaults
    return defaultConfig;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  try {
    const configPath = await getConfigPath();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const currentConfig = await loadConfig();
  const newConfig = { ...currentConfig, ...updates };
  await saveConfig(newConfig);
  return newConfig;
}

export async function getConfigFilePath(): Promise<string> {
  return await getConfigPath();
}