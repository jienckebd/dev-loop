import inquirer from 'inquirer';
import { AIProviderName, TestRunnerName, TemplateSource } from '../types';

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
}

export async function promptInitConfig(): Promise<InitAnswers> {
  const answers = await inquirer.prompt<InitAnswers>([
    {
      type: 'list',
      name: 'aiProvider',
      message: 'Select AI provider:',
      choices: [
        { name: 'Anthropic Claude', value: 'anthropic' },
        { name: 'OpenAI GPT', value: 'openai' },
        { name: 'Google Gemini', value: 'gemini' },
        { name: 'Ollama (Local)', value: 'ollama' },
      ],
      default: 'anthropic',
    },
    {
      type: 'input',
      name: 'aiModel',
      message: 'Enter AI model name:',
      default: (answers: Partial<InitAnswers>) => {
        switch (answers.aiProvider) {
          case 'anthropic':
            return 'claude-sonnet-4-20250514';
          case 'openai':
            return 'gpt-4o';
          case 'gemini':
            return 'gemini-pro';
          case 'ollama':
            return 'llama2';
          default:
            return '';
        }
      },
    },
    {
      type: 'input',
      name: 'aiFallback',
      message: 'Enter fallback provider (optional, format: provider:model):',
      default: '',
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
      default: 'builtin',
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
      default: 'playwright',
    },
    {
      type: 'input',
      name: 'testCommand',
      message: 'Enter test command:',
      default: 'npm test',
    },
    {
      type: 'number',
      name: 'testTimeout',
      message: 'Enter test timeout (ms):',
      default: 300000,
    },
    {
      type: 'input',
      name: 'artifactsDir',
      message: 'Enter artifacts directory:',
      default: 'test-results',
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
      default: '.taskmaster/tasks/tasks.json',
    },
  ]);

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

  // Initialize empty log sources (can be configured later)
  answers.logSources = [];

  return answers;
}

