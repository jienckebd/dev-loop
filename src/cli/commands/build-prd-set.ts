/**
 * Build PRD Set Command
 *
 * Comprehensive command for building PRD sets with three modes:
 * - Convert: Analyze Claude Code planning docs and convert to PRD sets
 * - Enhance: Enhance existing PRD sets with schema discovery, test planning, and feature configuration
 * - Create: Interactive mode starting from user prompt (similar to Cursor plan mode)
 */

import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { AIProviderFactory } from '../../providers/ai/factory';
import { AIProviderConfig } from '../../providers/ai/interface';
import { PRDBuilderOrchestrator, BuildInput, BuildOptions, BuildResult } from '../../core/prd/builder/prd-builder-orchestrator';
import { ConversationManager } from '../../core/conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../core/tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from '../../core/prd/builder/interactive-prompt-system';
import { FileDiscoveryService } from '../../core/prd/builder/file-discovery-service';
import { BuildMode } from '../../core/conversation/types';
import { logger } from '../../core/utils/logger';
import { killAllChildProcesses } from '../../providers/ai/cursor-chat-opener';

interface BuildPrdSetOptions {
  convert?: string; // Planning doc path (convert mode)
  enhance?: string; // PRD set path (enhance mode)
  create?: boolean; // Create mode flag
  prompt?: string; // Initial prompt (for create mode)
  outputDir?: string;
  setId?: string;
  autoApprove?: boolean;
  skipAnalysis?: boolean;
  maxIterations?: number;
  interactive?: boolean;
  debug?: boolean;
  // Mode-specific options
  gapsOnly?: boolean; // Enhance mode
  enhanceTypes?: string; // Enhance mode (comma-separated: schemas,tests,config,all)
  preserveExisting?: boolean; // Enhance mode
  maxQuestions?: number; // Create mode
  skipQuestions?: boolean; // Create mode
  validateOnly?: boolean; // Convert mode
  force?: boolean; // Convert mode
  questions?: number; // Create mode (alias for maxQuestions)
  template?: string; // Create mode
  watch?: boolean; // Watch mode for PRD building
  requireExecutable?: boolean; // Require 100% executability (default: true)
  maxExecutabilityIterations?: number; // Maximum iterations for executability validation (default: 10)
}

/**
 * Register the build-prd-set command
 */
export function registerBuildPrdSetCommand(program: Command): void {
  program
    .command('build-prd-set [input]')
    .description('Build PRD sets with three modes: convert (planning docs), enhance (existing PRD sets), or create (interactive)')
    .option('--convert <path>', 'Convert mode: path to planning document')
    .option('--enhance <path>', 'Enhance mode: path to existing PRD set')
    .option('--create', 'Create mode: interactive PRD creation from prompt')
    .option('--prompt <text>', 'Initial prompt for create mode')
    .option('-o, --output-dir <dir>', 'Output directory for PRD set')
    .option('-s, --set-id <id>', 'PRD set ID (default: extracted from document/prompt)')
    .option('--auto-approve', 'Skip user checkpoints (fully automated)')
    .option('--skip-analysis', 'Skip codebase analysis (faster, less comprehensive)')
    .option('--max-iterations <n>', 'Number of refinement iterations', '3')
    .option('--interactive', 'Enable interactive prompts (default: true)', true)
    .option('--no-interactive', 'Disable interactive prompts')
    .option('-d, --debug', 'Enable debug output')
    // Convert mode options
    .option('--validate-only', 'Only validate, don\'t create files (convert mode)')
    .option('-f, --force', 'Overwrite existing PRD set (convert mode)')
    // Enhance mode options
    .option('--gaps-only', 'Only detect and report gaps, don\'t enhance (enhance mode)')
    .option('--enhance-types <types>', 'Specific enhancement types (enhance mode): schemas,tests,config,all')
    .option('--preserve-existing', 'Don\'t modify existing valid configurations (enhance mode)', true)
    // Create mode options
    .option('--max-questions <n>', 'Maximum number of questions (create mode)', '10')
    .option('--questions <n>', 'Maximum number of questions (create mode, alias for max-questions)')
    .option('--skip-questions', 'Skip questions and generate PRD directly from prompt (create mode)')
    .option('--template <template>', 'Use specific PRD template (create mode)')
    .option('--watch', 'Watch mode: monitor PRD building progress with auto-save checkpoints')
    .option('--require-executable', 'Require 100% executability (default: true)', true)
    .option('--no-require-executable', 'Allow PRD sets that are not 100% executable')
    .option('--max-executability-iterations <n>', 'Maximum iterations for executability validation', '10')
    .action(async (input: string | undefined, options: BuildPrdSetOptions) => {
      await buildPrdSet(input, options);
    });
}

async function buildPrdSet(input: string | undefined, options: BuildPrdSetOptions): Promise<void> {
  const spinner = ora('Loading configuration').start();
  const debug = options.debug || false;

  try {
    // Load configuration
    const config = await loadConfig();
    if (debug || (config as any).debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    // Initialize services
    spinner.start('Initializing services');
    
    // Get code generation AI provider (not pattern provider)
    const aiProvider = AIProviderFactory.createWithFallback(config);

    // Extract AIProviderConfig from config
    const getApiKeyEnvVar = (provider: string): string => {
      switch (provider) {
        case 'anthropic': return 'ANTHROPIC_API_KEY';
        case 'openai': return 'OPENAI_API_KEY';
        case 'gemini': return 'GOOGLE_AI_API_KEY';
        case 'ollama': return 'OLLAMA_API_KEY';
        default: return '';
      }
    };

    const aiProviderConfig: AIProviderConfig = {
      apiKey: config.ai.apiKey || process.env[getApiKeyEnvVar(config.ai.provider)] || '',
      model: config.ai.model,
      temperature: 0.7,
      maxTokens: config.ai.maxTokens || 4000,
      cursorRulesPath: (config as any).rules?.cursorRulesPath,
      frameworkConfig: (config as any).framework,
    };

    const conversationManager = new ConversationManager({
      enabled: true,
      debug,
    });

    const progressTracker = new PRDBuildingProgressTracker({
      enabled: true,
      autoSaveInterval: options.watch ? 300 : 0, // Auto-save every 5 minutes in watch mode
      debug,
    });

    const interactivePrompts = new InteractivePromptSystem({
      useRichUI: true,
      debug,
    });

    const orchestrator = new PRDBuilderOrchestrator({
      projectRoot: process.cwd(),
      config,
      aiProvider,
      aiProviderConfig,
      conversationManager,
      progressTracker,
      interactivePrompts,
      debug,
    });

    // Register signal handlers for immediate exit (before any async operations)
    // These must be registered BEFORE any interactive prompts
    // CRITICAL: Remove any existing SIGINT handlers first, then register ours
    // This ensures prompt libraries don't interfere with immediate exit
    // Use module-level flag so it can be checked from anywhere (including orchestrator)
    const exitingFlag = { value: false };
    
    const handleExit = (signal: string, code: number) => {
      if (exitingFlag.value) {
        // Force exit immediately if already exiting (second Ctrl+C)
        process.exit(code);
        return;
      }
      exitingFlag.value = true;
      
      // Stop spinner immediately
      if (spinner) {
        spinner.stop();
      }
      
      // Kill all child processes synchronously
      killAllChildProcesses('SIGTERM');
      
      // Write directly to stderr to bypass any buffering
      process.stderr.write('\n\n⚠ Interrupted by user\n\n');
      
      // Exit immediately (synchronous - don't wait for anything)
      process.exit(code);
    };

    // Remove any existing SIGINT/SIGTERM handlers that might interfere
    // Use prependListener to ensure our handler runs FIRST (before prompt libraries)
    // Then register our handler to ensure immediate exit
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.prependListener('SIGINT', () => handleExit('SIGINT', 130));
    process.prependListener('SIGTERM', () => handleExit('SIGTERM', 143));
    
    // Export exiting flag so orchestrator can check it
    (global as any).__devloop_exiting = exitingFlag;

    spinner.succeed('Services initialized');

    // Load config and get paths
    const preProductionDir = (config as any).prdBuilding?.preProductionDir || '.taskmaster/pre-production';
    const productionDir = (config as any).prdBuilding?.productionDir || '.taskmaster/production';
    const defaultOutputDir = options.outputDir || productionDir;

    // Initialize file discovery service
    const fileDiscovery = new FileDiscoveryService({ debug });

    // Determine mode and build input
    let mode: BuildMode | undefined = options.convert ? 'convert' : options.enhance ? 'enhance' : options.create ? 'create' : undefined;
    let selectedPath: string | undefined = input || options.convert || options.enhance;

    // When no input provided, prompt for mode
    if (!mode && !input && !options.convert && !options.enhance && !options.create && !options.prompt) {
      spinner.stop();
      try {
        mode = await interactivePrompts.selectMode();
        spinner.start('Processing selection');
      } catch (error) {
        // Check if we're already exiting (signal handler was called)
        if (exitingFlag.value) {
          process.exit(130);
          return;
        }
        spinner.fail('Mode selection cancelled');
        console.error(chalk.red('Operation cancelled by user.'));
        process.exit(0);
      }
    }

    // If mode is selected but no path provided, discover and prompt for selection
    if (mode === 'convert' && !selectedPath) {
      spinner.start(`Scanning ${preProductionDir} for planning documents...`);
      
      // Ensure directory exists
      const dirExists = await fileDiscovery.ensureDirectoryExists(preProductionDir, false);
      if (!dirExists) {
        spinner.fail(`Directory not found: ${preProductionDir}`);
        console.error(chalk.red(`\nError: Directory ${preProductionDir} does not exist.`));
        console.error(chalk.yellow(`Please create the directory or update prdBuilding.preProductionDir in devloop.config.js`));
        process.exit(1);
      }

      // Discover planning documents
      const documents = await fileDiscovery.discoverPlanningDocuments(preProductionDir);
      
      if (documents.length === 0) {
        spinner.fail(`No planning documents found in ${preProductionDir}`);
        console.error(chalk.red(`\nError: No *.md files found in ${preProductionDir}`));
        console.error(chalk.yellow(`Please add planning documents (*.md files) to ${preProductionDir} or update prdBuilding.preProductionDir in devloop.config.js`));
        process.exit(1);
      }

      spinner.stop();
      try {
        selectedPath = await interactivePrompts.selectFileFromList(
          documents,
          `Select a planning document to convert (found ${documents.length}):`
        );
        spinner.start('Processing selected file');
      } catch (error) {
        // Check if we're already exiting (signal handler was called)
        if (exitingFlag.value) {
          process.exit(130);
          return;
        }
        spinner.fail('File selection cancelled');
        console.error(chalk.red('Operation cancelled by user.'));
        process.exit(0);
      }
    } else if (mode === 'enhance' && !selectedPath) {
      spinner.start(`Scanning ${preProductionDir} for PRD sets...`);
      
      // Ensure directory exists
      const dirExists = await fileDiscovery.ensureDirectoryExists(preProductionDir, false);
      if (!dirExists) {
        spinner.fail(`Directory not found: ${preProductionDir}`);
        console.error(chalk.red(`\nError: Directory ${preProductionDir} does not exist.`));
        console.error(chalk.yellow(`Please create the directory or update prdBuilding.preProductionDir in devloop.config.js`));
        process.exit(1);
      }

      // Discover PRD sets
      const prdSets = await fileDiscovery.discoverPrdSets(preProductionDir);
      
      if (prdSets.length === 0) {
        spinner.fail(`No PRD sets found in ${preProductionDir}`);
        console.error(chalk.red(`\nError: No PRD sets (index.md.yml) found in ${preProductionDir}`));
        console.error(chalk.yellow(`Please add PRD sets to ${preProductionDir} or update prdBuilding.preProductionDir in devloop.config.js`));
        process.exit(1);
      }

      spinner.stop();
      try {
        selectedPath = await interactivePrompts.selectPrdSetFromList(
          prdSets,
          `Select a PRD set to enhance (found ${prdSets.length}):`
        );
        spinner.start('Processing selected PRD set');
      } catch (error) {
        // Check if we're already exiting (signal handler was called)
        if (exitingFlag.value) {
          process.exit(130);
          return;
        }
        spinner.fail('PRD set selection cancelled');
        console.error(chalk.red('Operation cancelled by user.'));
        process.exit(0);
      }
    }

    // Auto-detect mode if not specified but path is provided
    if (!mode && selectedPath) {
      spinner.start('Auto-detecting mode');
      mode = await orchestrator.autoDetectMode({ path: selectedPath });
      spinner.succeed(`Auto-detected mode: ${mode}`);
    } else if (!mode && !selectedPath && !options.prompt) {
      // No input and no prompt - use create mode
      mode = 'create';
      spinner.info('No input provided, using create mode');
    } else if (!mode) {
      mode = 'create';
    }

    const buildInput: BuildInput = {
      path: selectedPath,
      prompt: options.prompt,
      mode,
    };

    // Build options with output directory handling
    // Default to productionDir if not specified
    // Handlers will create subfolder structure: {productionDir}/{setId}/
    const buildOptions: BuildOptions = {
      outputDir: options.outputDir || defaultOutputDir, // Use provided outputDir or productionDir as default
      productionDir, // Pass productionDir config so handlers know to use subfolder structure
      setId: options.setId,
      autoApprove: options.autoApprove || false,
      skipAnalysis: options.skipAnalysis || false,
      maxIterations: parseInt(String(options.maxIterations || '3'), 10),
      interactive: options.interactive !== false,
      debug: options.debug || false,
      // Mode-specific options
      gapsOnly: options.gapsOnly,
      enhanceTypes: options.enhanceTypes
        ? (options.enhanceTypes.split(',') as Array<'schemas' | 'tests' | 'config' | 'all'>)
        : undefined,
      preserveExisting: options.preserveExisting !== false,
      maxQuestions: parseInt(String(options.questions || options.maxQuestions || '10'), 10),
      skipQuestions: options.skipQuestions || false,
      validateOnly: options.validateOnly,
      force: options.force,
      requireExecutable: options.requireExecutable !== false, // Default to true
      maxExecutabilityIterations: parseInt(String(options.maxExecutabilityIterations || '10'), 10),
    };

    // Start watch mode if requested
    if (options.watch) {
      spinner.info('Watch mode enabled - monitoring PRD building progress');
      // Watch mode would be handled by watch command integration
      // For now, just log that watch mode is requested
    }

    // Execute build
    spinner.start(`Building PRD set (mode: ${mode})...`);
    const result = await orchestrator.build(buildInput, buildOptions);

    if (result.success) {
      spinner.succeed('PRD set built successfully');

      // Display results
      console.log(chalk.green('\n✓ PRD Set Build Complete\n'));
      console.log(chalk.cyan('Mode:'), mode);
      console.log(chalk.cyan('Status:'), result.executable ? chalk.green('EXECUTABLE') : chalk.yellow('NOT EXECUTABLE'));
      if (result.prdSetPath) {
        console.log(chalk.cyan('Output:'), result.prdSetPath);
      }
      console.log('');
      console.log(result.summary);
      console.log('');

      if (!result.executable) {
        console.log(chalk.yellow('⚠ PRD set is not 100% executable. Review and refine as needed.'));
      } else {
        console.log(chalk.green('✓ PRD set is 100% executable and ready for dev-loop execution.'));
      }
    } else {
      spinner.fail('PRD set build failed');
      console.error(chalk.red('\n✗ PRD Set Build Failed\n'));
      console.error(result.summary);
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('PRD set build failed');
    console.error(chalk.red('\n✗ PRD Set Build Failed\n'));
    console.error(error);
    process.exit(1);
  }
}
