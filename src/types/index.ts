export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'blocked';

export type InterventionMode = 'autonomous' | 'review' | 'hybrid';

export type AIProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama';

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
}

