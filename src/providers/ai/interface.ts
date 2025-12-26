import { CodeChanges, TaskContext, LogAnalysis } from '../../types';

export interface AIProvider {
  name: string;
  generateCode(prompt: string, context: TaskContext): Promise<CodeChanges>;
  analyzeError(error: string, context: TaskContext): Promise<LogAnalysis>;
}

export interface AIProviderConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

