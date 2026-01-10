export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'blocked';

export type InterventionMode = 'autonomous' | 'review' | 'hybrid';

export type AIProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'cursor';

export type TestRunnerName = 'playwright' | 'cypress';

export type TemplateSource = 'builtin' | 'ai-dev-tasks' | 'custom';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependencies?: string[];
  details?: string;
  subtasks?: Task[];
  parentId?: string;
}

export interface TaskContext {
  task: Task;
  projectFiles?: string[];
  codebaseContext?: string;
  // PRD/phase context for parallel execution
  prdId?: string;
  phaseId?: number | null;
  prdSetId?: string | null;
  // Target module for boundary enforcement - prevents modifying other modules
  targetModule?: string | null;
}

export interface CodePatch {
  search: string;
  replace: string;
}

export interface CodeChanges {
  files: Array<{
    path: string;
    content?: string;
    patches?: CodePatch[];
    operation: 'create' | 'update' | 'delete' | 'patch';
  }>;
  summary: string;
}

export interface TestResult {
  success: boolean;
  output: string;
  artifacts: Artifact[];
  duration: number;
}

export interface Artifact {
  type: 'screenshot' | 'video' | 'log' | 'other';
  path: string;
  name: string;
}

export interface LogSource {
  type: 'file' | 'command';
  path?: string;
  command?: string;
}

/**
 * Framework-specific configuration for AI prompts and task detection.
 * This allows dev-loop to be framework-agnostic while supporting
 * framework-specific behavior via project configuration.
 */
export interface FrameworkConfig {
  // Framework type (e.g., 'drupal', 'laravel', 'rails', 'nextjs')
  type?: string;
  // Custom rules to inject into AI prompts for this framework
  rules?: string[];
  // Patterns to detect framework-specific tasks (regex patterns)
  taskPatterns?: string[];
  // File path patterns for extracting paths from error messages
  errorPathPatterns?: string[];
  // Error message guidance - maps error substrings to helpful guidance
  errorGuidance?: Record<string, string>;
  // Identifier patterns for extracting function/class names
  identifierPatterns?: string[];
  // Custom template path for framework-specific task templates
  templatePath?: string;
}

export interface LogAnalysis {
  errors: string[];
  warnings: string[];
  summary: string;
  recommendations?: string[];
}

export interface WorkflowState {
  currentTask?: Task;
  status: 'idle' | 'fetching-task' | 'executing-ai' | 'applying-changes' | 'awaiting-approval' | 'running-post-apply-hooks' | 'running-pre-test-hooks' | 'running-tests' | 'analyzing-logs' | 'marking-done' | 'creating-fix-task';
  progress: number;
  totalTasks: number;
  completedTasks: number;
}

export interface Config {
  ai: {
    provider: AIProviderName;
    model: string;
    fallback?: string;
    apiKey?: string;
    maxTokens?: number;
    maxContextChars?: number;
  };
  templates: {
    source: TemplateSource;
    customPath?: string;
  };
  testing: {
    runner: TestRunnerName;
    command: string;
    timeout: number;
    artifactsDir: string;
  };
  logs: {
    sources: LogSource[];
    patterns: {
      error: RegExp | string;
      warning: RegExp | string;
    };
    ignorePatterns?: (RegExp | string)[];
    useAI: boolean;
  };
  intervention: {
    mode: InterventionMode;
    approvalRequired: string[];
  };
  taskMaster: {
    tasksPath: string;
  };
  codebase?: {
    extensions?: string[];
    searchDirs?: string[];
    excludeDirs?: string[];
    ignoreGlobs?: string[];
    identifierStopwords?: string[];
    filePathPatterns?: string[];
  };
  hooks?: {
    preTest?: string[];
    postApply?: string[];
  };
  rules?: {
    cursorRulesPath?: string;
  };
  validation?: {
    enabled: boolean;
    baseUrl: string;
    urls: string[];
    timeout?: number;
    authCommand?: string;
  };
  // Framework-specific configuration
  framework?: FrameworkConfig;

  // Enhanced context configuration
  context?: {
    // Include file skeleton in prompts (shows available helpers)
    includeSkeleton?: boolean;
    // Include import section explicitly
    includeImports?: boolean;
    // Max helper signatures to show
    maxHelperSignatures?: number;
  };

  // Pre-apply validation configuration
  preValidation?: {
    // Enable pre-apply validation
    enabled?: boolean;
    // Max validation retries before creating fix task
    maxRetries?: number;
    // Validate TypeScript syntax
    validateSyntax?: boolean;
    // Validate function references exist
    validateReferences?: boolean;
  };

  // Pattern learning configuration
  patternLearning?: {
    // Enable pattern learning
    enabled?: boolean;
    // Path to patterns file
    patternsPath?: string;
    // Include builtin patterns
    useBuiltinPatterns?: boolean;
  };
}

/**
 * Agent configuration for Cursor agent auto-generation
 */
export interface AgentConfig {
  name: string;
  model?: string;
  purpose: string;
  type?: string;
  question: string;
  mode: 'Ask' | 'Chat' | 'Compose';
  metadata?: {
    prdId?: string;
    phaseId?: number | null;
    prdSetId?: string | null;
    taskId?: string;
  };
}

/**
 * Chat request for creating visible chat sessions in Cursor IDE
 */
export interface ChatRequest {
  id: string;
  agentName: string;
  question: string;
  model: string;
  mode: 'Ask' | 'Chat' | 'Compose';
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
  context?: {
    prdId?: string;
    phaseId?: number | null;
    prdSetId?: string | null;
    taskId?: string;
    taskTitle?: string;
  };
}

/**
 * Chat instruction file for Cursor agent to process
 */
export interface ChatInstruction {
  action: 'create_chat';
  agentName: string;
  question: string;
  model: string;
  mode: 'Ask' | 'Chat' | 'Compose';
  requestId: string;
  createdAt: string;
  instructions: string;
  context?: {
    prdId?: string;
    phaseId?: number | null;
    prdSetId?: string | null;
    taskId?: string;
    taskTitle?: string;
  };
  /** CLI command for manual execution (e.g., "cursor agent '<question>'") */
  cliCommand?: string;
}