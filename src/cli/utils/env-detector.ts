/**
 * Environment-based AI provider detection utility
 *
 * Detects available AI providers by scanning .env files and process environment.
 * Supports Anthropic, OpenAI, Gemini, Ollama, and Cursor providers.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProviderName } from '../../types';

/**
 * Detected AI provider with availability status
 */
export interface DetectedProvider {
  provider: AIProviderName;
  hasApiKey: boolean;
  envVar: string;
  source?: 'env-file' | 'process-env' | 'local-service';
}

/**
 * Provider detection configuration
 */
export interface ProviderDetectionConfig {
  /** Check .env file (default: true) */
  checkEnvFile?: boolean;
  /** Check process.env (default: true) */
  checkProcessEnv?: boolean;
  /** Check for local Ollama service (default: true) */
  checkOllama?: boolean;
  /** Timeout for Ollama check in ms (default: 1000) */
  ollamaTimeout?: number;
}

/**
 * Environment variable mappings for each provider
 */
const PROVIDER_ENV_VARS: Record<Exclude<AIProviderName, 'cursor'>, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY'],
  gemini: ['GOOGLE_AI_API_KEY', 'GEMINI_API_KEY'],
  ollama: ['OLLAMA_API_KEY', 'OLLAMA_HOST'],
};

/**
 * Parse a .env file content into key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Match KEY=value pattern
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Check if Ollama is running locally
 */
async function isOllamaAvailable(timeout: number = 1000): Promise<boolean> {
  try {
    const http = await import('http');
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const url = new URL('/api/tags', ollamaHost);

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: url.pathname,
          method: 'GET',
          timeout,
        },
        (res) => {
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  } catch {
    return false;
  }
}

/**
 * Load and parse .env file from project root
 */
async function loadEnvFile(projectRoot: string): Promise<Record<string, string>> {
  const envPaths = [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env.development'),
  ];

  let envVars: Record<string, string> = {};

  for (const envPath of envPaths) {
    if (await fs.pathExists(envPath)) {
      try {
        const content = await fs.readFile(envPath, 'utf-8');
        const parsed = parseEnvFile(content);
        // Merge, giving priority to earlier files
        envVars = { ...parsed, ...envVars };
      } catch {
        // Ignore read errors
      }
    }
  }

  return envVars;
}

/**
 * Detect available AI providers from environment
 *
 * @param projectRoot - Project root directory
 * @param config - Detection configuration options
 * @returns Array of detected providers with availability status
 *
 * @example
 * ```typescript
 * const providers = await detectAvailableProviders('/path/to/project');
 * const available = providers.filter(p => p.hasApiKey);
 * console.log('Available providers:', available.map(p => p.provider));
 * ```
 */
export async function detectAvailableProviders(
  projectRoot: string,
  config: ProviderDetectionConfig = {}
): Promise<DetectedProvider[]> {
  const {
    checkEnvFile = true,
    checkProcessEnv = true,
    checkOllama = true,
    ollamaTimeout = 1000,
  } = config;

  // Load .env file vars
  let envFileVars: Record<string, string> = {};
  if (checkEnvFile) {
    envFileVars = await loadEnvFile(projectRoot);
  }

  const detected: DetectedProvider[] = [];

  // Check each provider
  for (const [provider, envVarNames] of Object.entries(PROVIDER_ENV_VARS)) {
    let hasApiKey = false;
    let source: DetectedProvider['source'];
    let foundEnvVar = envVarNames[0];

    // Check .env file first
    if (checkEnvFile) {
      for (const envVar of envVarNames) {
        if (envFileVars[envVar]) {
          hasApiKey = true;
          source = 'env-file';
          foundEnvVar = envVar;
          break;
        }
      }
    }

    // Check process.env if not found in file
    if (!hasApiKey && checkProcessEnv) {
      for (const envVar of envVarNames) {
        if (process.env[envVar]) {
          hasApiKey = true;
          source = 'process-env';
          foundEnvVar = envVar;
          break;
        }
      }
    }

    detected.push({
      provider: provider as AIProviderName,
      hasApiKey,
      envVar: foundEnvVar,
      source: hasApiKey ? source : undefined,
    });
  }

  // Special handling for Ollama - check if local service is running
  if (checkOllama) {
    const ollamaProvider = detected.find(p => p.provider === 'ollama');
    if (ollamaProvider && !ollamaProvider.hasApiKey) {
      const ollamaRunning = await isOllamaAvailable(ollamaTimeout);
      if (ollamaRunning) {
        ollamaProvider.hasApiKey = true;
        ollamaProvider.source = 'local-service';
      }
    }
  }

  // Cursor is always available (uses Cursor's built-in AI)
  detected.push({
    provider: 'cursor',
    hasApiKey: true,
    envVar: 'CURSOR_AI',
    source: 'local-service',
  });

  return detected;
}

/**
 * Get the best available provider based on priority
 *
 * Priority order: anthropic > openai > cursor > gemini > ollama
 *
 * @param projectRoot - Project root directory
 * @returns The best available provider or 'cursor' as fallback
 */
export async function getBestAvailableProvider(
  projectRoot: string
): Promise<AIProviderName> {
  const detected = await detectAvailableProviders(projectRoot);
  const available = detected.filter(p => p.hasApiKey);

  // Priority order
  const priority: AIProviderName[] = ['anthropic', 'openai', 'cursor', 'gemini', 'ollama'];

  for (const provider of priority) {
    if (available.some(p => p.provider === provider)) {
      return provider;
    }
  }

  return 'cursor'; // Always available fallback
}

/**
 * Format detected providers for display
 *
 * @param providers - Array of detected providers
 * @returns Formatted string for CLI output
 */
export function formatDetectedProviders(providers: DetectedProvider[]): string {
  const available = providers.filter(p => p.hasApiKey);

  if (available.length === 0) {
    return 'No AI providers detected. Using Cursor as fallback.';
  }

  const lines = available.map(p => {
    const sourceLabel = p.source === 'env-file' ? '(.env file)'
      : p.source === 'process-env' ? '(environment)'
      : p.source === 'local-service' ? '(local service)'
      : '';
    return `  - ${p.provider} ${sourceLabel}`;
  });

  return `Detected AI providers:\n${lines.join('\n')}`;
}
