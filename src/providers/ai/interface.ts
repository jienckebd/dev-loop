import { CodeChanges, TaskContext, LogAnalysis, FrameworkConfig } from '../../types';
import { Session, SessionContext } from './session-manager';

export interface TextGenerationOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /**
   * Override the default model for this call.
   * When set, uses this model instead of provider default.
   */
  model?: string;
}

/**
 * Token usage information from AI calls
 */
export interface TokenUsage {
  input?: number;
  output?: number;
}

/**
 * AI Provider interface
 * 
 * Core interface for all AI providers. All providers must implement:
 * - generateCode: Generate code changes from a prompt
 * - analyzeError: Analyze errors and provide recommendations
 * 
 * Optional methods for enhanced functionality:
 * - generateText: Text generation for PRD building
 * - getSession/getOrCreateSession/supportsSessions: Session management
 * - getLastTokens: Token usage tracking for metrics
 */
export interface AIProvider {
  name: string;
  
  // Required methods
  generateCode(prompt: string, context: TaskContext): Promise<CodeChanges>;
  analyzeError(error: string, context: TaskContext): Promise<LogAnalysis>;
  
  // Optional: text generation for PRD building (schemas, tests, etc.)
  generateText?(prompt: string, options?: TextGenerationOptions): Promise<string>;
  
  // Optional: session management for context continuity
  getSession?(sessionId: string): Session | null;
  getOrCreateSession?(context: SessionContext): Session | null;
  supportsSessions?(): boolean;
  
  // Optional: token tracking for build metrics
  getLastTokens?(): TokenUsage;
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
  // Session management configuration
  sessionManagement?: {
    enabled?: boolean;
    maxSessionAge?: number;
    maxHistoryItems?: number;
  };
}
