import inquirer from 'inquirer';
import { AIProviderName, TestRunnerName, TemplateSource } from '../types';
import { PROVIDER_MODELS, getDefaultModel } from './utils/model-list';
import { InteractivePromptSystem } from '../core/prd/builder/interactive-prompt-system';
import { FrameworkPlugin } from '../frameworks/index';
import type { CodebaseAnalysisResult } from '../core/analysis/codebase-analyzer';
import type { Config } from '../config/schema/core';

export interface InitAnswers {
  aiProvider: AIProviderName;
  aiModel: string;
  aiFallback?: string;
  templateSource: TemplateSource;
  customTemplatePath?: string;
  testRunner: TestRunnerName;
  testCommand: string;
  testTimeout: number;
  artifactsDir: string;
  logSources: Array<{ type: 'file' | 'command'; path?: string; command?: string }>;
  interventionMode: 'autonomous' | 'review' | 'hybrid';
  approvalRequired: string | string[];
  tasksPath: string;
  testing?: Config['testing'];
  logs?: Config['logs'];
}

export interface PromptInitConfigOptions {
  suggestions?: Partial<Config>;
  framework?: FrameworkPlugin;
  codebaseAnalysis?: CodebaseAnalysisResult;
  interactivePrompts?: InteractivePromptSystem;
}

/**
 * Prompt for init config using InteractivePromptSystem or fallback to inquirer
 */
export async function promptInitConfig(options: PromptInitConfigOptions = {}): Promise<InitAnswers> {
  const { suggestions, framework, interactivePrompts } = options;

  // Use InteractivePromptSystem if provided, otherwise fallback to inquirer
  if (interactivePrompts) {
    return await promptWithInteractiveSystem(interactivePrompts, suggestions, framework);
  } else {
    return await promptWithInquirer(suggestions, framework);
  }
}

/**
 * Prompt using InteractivePromptSystem
 */
async function promptWithInteractiveSystem(
  prompts: InteractivePromptSystem,
  suggestions?: Partial<Config>,
  framework?: FrameworkPlugin
): Promise<InitAnswers> {
  // 1. Select AI provider
  const aiProvider = (await prompts.askQuestion({
    id: 'ai-provider',
    type: 'multiple-choice',
    text: 'Select AI provider:',
    options: [
      'anthropic',
      'openai',
      'gemini',
      'ollama',
      'cursor',
    ],
    default: suggestions?.ai?.provider || 'cursor',
    required: true,
  })) as AIProviderName;

  // 2. Get provider-specific models
  const models = PROVIDER_MODELS[aiProvider] || [];
  const modelOptions = models.map(m => m.value);
  const modelNames = models.map(m => m.name);

  // 3. Select model for provider
  const aiModel = (await prompts.askQuestion({
    id: 'ai-model',
    type: 'multiple-choice',
    text: `Select ${aiProvider} model:`,
    options: modelOptions,
    default: suggestions?.ai?.model || getDefaultModel(aiProvider),
    required: true,
  })) as string;

  // 4. Optional fallback
  const useFallback = (await prompts.askQuestion({
    id: 'use-fallback',
    type: 'confirm',
    text: 'Use fallback provider?',
    default: !!suggestions?.ai?.fallback,
    required: true,
  })) as boolean;

  let aiFallback: string | undefined;
  if (useFallback) {
    const fallbackProvider = (await prompts.askQuestion({
      id: 'fallback-provider',
      type: 'multiple-choice',
      text: 'Select fallback provider:',
      options: ['anthropic', 'openai', 'gemini', 'ollama', 'cursor'],
      default: 'openai',
      required: true,
    })) as AIProviderName;

    const fallbackModels = PROVIDER_MODELS[fallbackProvider] || [];
    const fallbackModel = (await prompts.askQuestion({
      id: 'fallback-model',
      type: 'multiple-choice',
      text: `Select fallback ${fallbackProvider} model:`,
      options: fallbackModels.map(m => m.value),
      default: getDefaultModel(fallbackProvider),
      required: true,
    })) as string;

    aiFallback = `${fallbackProvider}:${fallbackModel}`;
  }

  // 5. Template source
  const templateSource = (await prompts.askQuestion({
    id: 'template-source',
    type: 'multiple-choice',
    text: 'Select template source:',
    options: ['builtin', 'ai-dev-tasks', 'custom'],
    default: suggestions?.templates?.source || 'builtin',
    required: true,
  })) as TemplateSource;

  let customTemplatePath: string | undefined;
  if (templateSource === 'custom') {
    customTemplatePath = (await prompts.askQuestion({
      id: 'custom-template-path',
      type: 'open-ended',
      text: 'Enter custom template directory path:',
      default: suggestions?.templates?.customPath || '',
      required: true,
    })) as string;
  }

  // 6. Test runner (pre-fill from suggestions if available)
  const testRunner = (await prompts.askQuestion({
    id: 'test-runner',
    type: 'multiple-choice',
    text: 'Select test runner:',
    options: ['playwright', 'cypress'],
    default: (suggestions?.testing?.runner as string) || 'playwright',
    required: true,
  })) as TestRunnerName;

  // 7. Test command
  const testCommand = (await prompts.askQuestion({
    id: 'test-command',
    type: 'open-ended',
    text: 'Enter test command:',
    default: suggestions?.testing?.command || (framework?.getDefaultConfig().testCommand) || 'npm test',
    required: true,
  })) as string;

  // 8. Test timeout
  const testTimeoutStr = (await prompts.askQuestion({
    id: 'test-timeout',
    type: 'open-ended',
    text: 'Enter test timeout (ms):',
    default: String(suggestions?.testing?.timeout || 300000),
    required: true,
  })) as string;
  const testTimeout = parseInt(testTimeoutStr, 10) || 300000;

  // 9. Artifacts directory
  const artifactsDir = (await prompts.askQuestion({
    id: 'artifacts-dir',
    type: 'open-ended',
    text: 'Enter artifacts directory:',
    default: suggestions?.testing?.artifactsDir || 'test-results',
    required: true,
  })) as string;

  // 10. Intervention mode
  const interventionMode = (await prompts.askQuestion({
    id: 'intervention-mode',
    type: 'multiple-choice',
    text: 'Select intervention mode:',
    options: ['autonomous', 'review', 'hybrid'],
    default: 'autonomous',
    required: true,
  })) as 'autonomous' | 'review' | 'hybrid';

  let approvalRequired: string[] = [];
  if (interventionMode === 'hybrid') {
    const approvalStr = (await prompts.askQuestion({
      id: 'approval-required',
      type: 'open-ended',
      text: 'Enter operations requiring approval (comma-separated):',
      default: 'delete,schema-change',
      required: false,
    })) as string;
    approvalRequired = approvalStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  // 11. Tasks path
  const tasksPath = (await prompts.askQuestion({
    id: 'tasks-path',
    type: 'open-ended',
    text: 'Enter task-master-ai tasks path:',
    default: suggestions?.taskMaster?.tasksPath || '.taskmaster/tasks/tasks.json',
    required: true,
  })) as string;

  // Initialize empty log sources (can be configured later via suggestions)
  const logSources: Array<{ type: 'file' | 'command'; path?: string; command?: string }> =
    suggestions?.logs?.sources || [];

  return {
    aiProvider,
    aiModel,
    aiFallback,
    templateSource,
    customTemplatePath,
    testRunner,
    testCommand,
    testTimeout,
    artifactsDir,
    logSources,
    interventionMode,
    approvalRequired,
    tasksPath,
    testing: suggestions?.testing,
    logs: suggestions?.logs,
  };
}

/**
 * Prompt using inquirer (fallback)
 */
async function promptWithInquirer(
  suggestions?: Partial<Config>,
  framework?: FrameworkPlugin
): Promise<InitAnswers> {
  // Select provider first
  const providerAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'aiProvider',
      message: 'Select AI provider:',
      choices: [
        { name: 'Anthropic Claude', value: 'anthropic' },
        { name: 'OpenAI GPT', value: 'openai' },
        { name: 'Google Gemini', value: 'gemini' },
        { name: 'Ollama (Local)', value: 'ollama' },
        { name: 'Cursor AI', value: 'cursor' },
      ],
      default: suggestions?.ai?.provider || 'cursor',
    },
  ]);

  // Get provider-specific models
  const models = PROVIDER_MODELS[providerAnswer.aiProvider as AIProviderName] || [];

  // Select model
  const modelAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'aiModel',
      message: `Select ${providerAnswer.aiProvider} model:`,
      choices: models.map(m => ({ name: m.name, value: m.value })),
      default: suggestions?.ai?.model || getDefaultModel(providerAnswer.aiProvider as AIProviderName),
    },
  ]);

  const answers = await inquirer.prompt<InitAnswers>([
    {
      type: 'input',
      name: 'aiFallback',
      message: 'Enter fallback provider (optional, format: provider:model):',
      default: suggestions?.ai?.fallback || '',
    },
    {
      type: 'list',
      name: 'templateSource',
      message: 'Select template source:',
      choices: [
        { name: 'Built-in (minimal defaults)', value: 'builtin' },
        { name: 'ai-dev-tasks (bundled)', value: 'ai-dev-tasks' },
        { name: 'Custom (user-provided)', value: 'custom' },
      ],
      default: suggestions?.templates?.source || 'builtin',
    },
    {
      type: 'input',
      name: 'customTemplatePath',
      message: 'Enter custom template directory path:',
      when: (answers: Partial<InitAnswers>) => answers.templateSource === 'custom',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Custom template path is required';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'testRunner',
      message: 'Select test runner:',
      choices: [
        { name: 'Playwright', value: 'playwright' },
        { name: 'Cypress', value: 'cypress' },
      ],
      default: (suggestions?.testing?.runner as string) || 'playwright',
    },
    {
      type: 'input',
      name: 'testCommand',
      message: 'Enter test command:',
      default: suggestions?.testing?.command || (framework?.getDefaultConfig().testCommand) || 'npm test',
    },
    {
      type: 'number',
      name: 'testTimeout',
      message: 'Enter test timeout (ms):',
      default: suggestions?.testing?.timeout || 300000,
    },
    {
      type: 'input',
      name: 'artifactsDir',
      message: 'Enter artifacts directory:',
      default: suggestions?.testing?.artifactsDir || 'test-results',
    },
    {
      type: 'list',
      name: 'interventionMode',
      message: 'Select intervention mode:',
      choices: [
        { name: 'Autonomous (no approval needed)', value: 'autonomous' },
        { name: 'Review (approval for all changes)', value: 'review' },
        { name: 'Hybrid (approval for specific operations)', value: 'hybrid' },
      ],
      default: 'autonomous',
    },
    {
      type: 'input',
      name: 'approvalRequired',
      message: 'Enter operations requiring approval (comma-separated):',
      default: 'delete,schema-change',
      when: (answers: Partial<InitAnswers>) => answers.interventionMode === 'hybrid',
    } as any,
    {
      type: 'input',
      name: 'tasksPath',
      message: 'Enter task-master-ai tasks path:',
      default: suggestions?.taskMaster?.tasksPath || '.taskmaster/tasks/tasks.json',
    },
  ]);

  // Merge provider and model answers
  answers.aiProvider = providerAnswer.aiProvider;
  answers.aiModel = modelAnswer.aiModel;

  // Parse fallback
  if (answers.aiFallback) {
    const [provider, model] = answers.aiFallback.split(':');
    if (provider && model) {
      answers.aiFallback = `${provider}:${model}`;
    } else {
      answers.aiFallback = undefined;
    }
  } else {
    answers.aiFallback = undefined;
  }

  // Parse approval required
  if (typeof answers.approvalRequired === 'string') {
    answers.approvalRequired = answers.approvalRequired
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
  }

  // Initialize empty log sources (can be configured later via suggestions)
  answers.logSources = suggestions?.logs?.sources || [];
  answers.testing = suggestions?.testing;
  answers.logs = suggestions?.logs;

  return answers;
}
