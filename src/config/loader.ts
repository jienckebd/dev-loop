import * as fs from 'fs-extra';
import * as path from 'path';
import { validateConfig, Config } from './schema';
import { defaultConfig } from './defaults';

export async function loadConfig(configPath?: string): Promise<Config> {
  const configFile = configPath || path.join(process.cwd(), 'devloop.config.js');

  if (!(await fs.pathExists(configFile))) {
    throw new Error(`Config file not found: ${configFile}`);
  }

  // Load the config file (supports both .js and .json)
  let configData: unknown;

  if (configFile.endsWith('.js')) {
    // For .js files, we need to require them
    delete require.cache[require.resolve(path.resolve(configFile))];
    configData = require(path.resolve(configFile));
  } else if (configFile.endsWith('.json')) {
    configData = await fs.readJson(configFile);
  } else {
    throw new Error(`Unsupported config file format: ${configFile}`);
  }

  // Merge with defaults
  const merged = { ...defaultConfig, ...(configData as any) };

  return validateConfig(merged);
}

export async function configExists(configPath?: string): Promise<boolean> {
  const configFile = configPath || path.join(process.cwd(), 'devloop.config.js');
  return fs.pathExists(configFile);
}

