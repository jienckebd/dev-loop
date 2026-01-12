import { CodeChanges, TaskContext, LogAnalysis, FrameworkConfig } from '../../types';

export interface TextGenerationOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AIProvider {
  name: string;
  generateCode(prompt: string, context: TaskContext): Promise<CodeChanges>;
  analyzeError(error: string, context: TaskContext): Promise<LogAnalysis>;
  // Optional: text generation for PRD building (schemas, tests, etc.)
  generateText?(prompt: string, options?: TextGenerationOptions): Promise<string>;
}

export interface AIProviderConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  // Path to cursor rules file to inject into prompts
  cursorRulesPath?: string;
  // Framework-specific configuration for task detection and prompts
  frameworkConfig?: FrameworkConfig;
}
