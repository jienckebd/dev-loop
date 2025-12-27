export type TaskStatus = 'pending' | 'in-progress' | 'done';

export type InterventionMode = 'autonomous' | 'review' | 'hybrid';

export type AIProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export type TestRunnerName = 'playwright' | 'cypress';

export type TemplateSource = 'builtin' | 'ai-dev-tasks' | 'custom';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
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
    useAI: boolean;
  };
  intervention: {
    mode: InterventionMode;
    approvalRequired: string[];
  };
  taskMaster: {
    tasksPath: string;
  };
}

