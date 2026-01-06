#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './cli/commands/init';
import { runCommand } from './cli/commands/run';
import { watchCommand } from './cli/commands/watch';
import { stopCommand } from './cli/commands/stop';
import { statusCommand } from './cli/commands/status';
import { logsCommand } from './cli/commands/logs';
import { metricsCommand } from './cli/commands/metrics';
import { listCommand } from './cli/commands/list';
import { showCommand } from './cli/commands/show';
import { replayCommand } from './cli/commands/replay';
import { diagnoseCommand } from './cli/commands/diagnose';
import { traceCommand } from './cli/commands/trace';
import { pauseCommand } from './cli/commands/pause';
import { resumeCommand } from './cli/commands/resume';
import { templateListCommand, templateShowCommand } from './cli/commands/template';
import { patternListCommand } from './cli/commands/pattern';
import { resetCommand } from './cli/commands/reset';
import { handoffCreateCommand, handoffShowCommand, handoffListCommand } from './cli/commands/handoff';
import { configShowCommand } from './cli/commands/config';
import { validateCommand } from './cli/commands/validate';
import { contributionCommand } from './cli/commands/contribution';
import { evolveCommand } from './cli/commands/evolve';
import { prdCommand } from './cli/commands/prd';
import { validatePrdCommand } from './cli/commands/validate-prd';
import { prdSetExecuteCommand, prdSetStatusCommand, prdSetListCommand, prdSetValidateCommand } from './cli/commands/prd-set';
import { scanCommand } from './cli/commands/scan';
import { recommendCommand } from './cli/commands/recommend';
import { feedbackCommand } from './cli/commands/feedback';
import { archiveCommand } from './cli/commands/archive';
import { reportCommand } from './cli/commands/report';

const program = new Command();

program
  .name('dev-loop')
  .description('Automated Development Workflow Orchestrator')
  .version('1.0.0');

program
  .command('init')
  .description('Interactive wizard to create devloop.config.js')
  .option('-t, --template <template>', 'Template source to use (builtin, ai-dev-tasks, custom)')
  .action(initCommand);

program
  .command('run')
  .description('Execute one iteration of the workflow loop')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('-d, --debug', 'Enable debug mode with verbose output')
  .option('--task <id>', 'Run specific task by ID')
  .option('--all', 'Run all pending tasks sequentially')
  .option('--until <id>', 'Run tasks until reaching specified task')
  .option('--skip <id>', 'Skip specific task and continue')
  .action(runCommand);

program
  .command('watch')
  .description('Daemon mode - continuous execution until PRD complete')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('-d, --debug', 'Enable debug mode with verbose output')
  .option('--until-complete', 'Exit when all tasks done and tests pass')
  .option('--max-iterations <n>', 'Maximum iterations before exit', (v) => parseInt(v, 10))
  .action(watchCommand);

program
  .command('stop')
  .description('Stop the running daemon')
  .action(stopCommand);

program
  .command('status')
  .description('Show current task progress and state')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(statusCommand);

program
  .command('logs')
  .description('View dev-loop logs and analyze project logs')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('-n, --tail <lines>', 'Number of lines to show (default: 50)', (v) => parseInt(v, 10))
  .option('-f, --follow', 'Follow the log file (like tail -f)')
  .option('--analyze', 'Analyze project logs (from configured sources)')
  .option('--clear', 'Clear the log file')
  .action(logsCommand);

program
  .command('metrics')
  .description('View debug metrics and trends over time')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--last <n>', 'Show last N runs', (v) => parseInt(v, 10))
  .option('--task <id>', 'Show metrics for specific task', (v) => parseInt(v, 10))
  .option('--summary', 'Show summary only')
  .option('--json', 'Output as JSON')
  .option('--clear', 'Clear all metrics')
  .option('--prd-set <id>', 'Show metrics for PRD set')
  .option('--prd <id>', 'Show metrics for PRD')
  .option('--phase <prdId:phaseId>', 'Show metrics for phase (format: prdId:phaseId)')
  .option('--compare <id1:id2>', 'Compare two PRDs or PRD sets (format: id1:id2)')
  .option('--trends', 'Show trends over time')
  .option('--features', 'Show feature usage metrics')
  .option('--schema', 'Show schema operation metrics')
  .action(metricsCommand);

program
  .command('list')
  .description('List all tasks with status')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--pending', 'Show only pending tasks')
  .option('--failed', 'Show failed tasks')
  .option('--done', 'Show completed tasks')
  .option('--blocked', 'Show blocked tasks')
  .option('--tree', 'Show task dependency tree')
  .option('--json', 'Output as JSON')
  .action(listCommand);

program
  .command('show <taskId>')
  .description('Show detailed task information')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--history', 'Show task execution history')
  .action(async (taskId, options) => {
    await showCommand({ ...options, taskId });
  });

program
  .command('replay <taskId>')
  .description('Re-run a task')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--dry-run', 'Show what would be executed without running')
  .option('--with-context <path>', 'Add extra context from file')
  .option('--with-pattern <id>', 'Apply specific pattern')
  .option('--with-template <name>', 'Use different template')
  .option('--compare', 'Compare with previous run')
  .action(async (taskId, options) => {
    await replayCommand({ ...options, taskId });
  });

program
  .command('diagnose [taskId]')
  .description('Analyze task failures and suggest fixes')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--suggest', 'Suggest fixes for issues')
  .option('--auto-fix', 'Attempt automatic fixes')
  .action(async (taskId, options) => {
    await diagnoseCommand({ ...options, taskId });
  });

program
  .command('trace <taskId>')
  .description('Show complete execution trace for a task')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--tokens', 'Include token usage information')
  .action(async (taskId, options) => {
    await traceCommand({ ...options, taskId });
  });

program
  .command('pause')
  .description('Pause workflow execution after current task')
  .action(pauseCommand);

program
  .command('resume')
  .description('Resume paused workflow execution')
  .action(resumeCommand);

const templateCmd = program
  .command('template')
  .description('Template management commands');

templateCmd
  .command('list')
  .description('List available templates')
  .action(templateListCommand);

templateCmd
  .command('show <name>')
  .description('Display template content')
  .action(templateShowCommand);

const patternCmd = program
  .command('pattern')
  .description('Pattern learning commands');

patternCmd
  .command('list')
  .description('List learned patterns')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(patternListCommand);

program
  .command('reset [taskId]')
  .description('Reset task(s) to pending status')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--all-failed', 'Reset all blocked/failed tasks')
  .option('--all', 'Reset all tasks to pending')
  .action(async (taskId, options) => {
    await resetCommand({ ...options, taskId });
  });

const handoffCmd = program
  .command('handoff')
  .description('Session handoff commands');

handoffCmd
  .command('create')
  .description('Generate handoff document')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('-o, --output <path>', 'Output file path')
  .action(handoffCreateCommand);

handoffCmd
  .command('show')
  .description('Show latest handoff document')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(handoffShowCommand);

handoffCmd
  .command('list')
  .description('List all handoff documents')
  .action(handoffListCommand);

const configCmd = program
  .command('config')
  .description('Configuration commands');

configCmd
  .command('show [key]')
  .description('Display configuration')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(async (key, options) => {
    await configShowCommand({ ...options, key });
  });

program
  .command('validate')
  .description('Validate configuration and environment')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--config-only', 'Validate configuration file only')
  .option('--tasks', 'Validate tasks structure')
  .option('--environment', 'Check dependencies and environment')
  .option('--fix', 'Attempt to fix issues')
  .action(async (options) => {
    await validateCommand({
      configPath: options.config,
      checkConfig: options.configOnly,
      checkTasks: options.tasks,
      checkEnvironment: options.environment,
      fix: options.fix,
    });
  });

const contributionCmd = program
  .command('contribution')
  .description('Contribution mode commands (for outer agent)');

contributionCmd
  .command('start')
  .description('Activate contribution mode')
  .requiredOption('--prd <path>', 'Path to PRD file')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(async (options) => {
    await contributionCommand({ action: 'start', prd: options.prd, config: options.config });
  });

contributionCmd
  .command('status')
  .description('Check contribution mode status')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(async (options) => {
    await contributionCommand({ action: 'status', config: options.config });
  });

contributionCmd
  .command('stop')
  .description('Deactivate contribution mode')
  .action(async () => {
    await contributionCommand({ action: 'stop' });
  });

program
  .command('evolve')
  .description('View improvement insights (observations and improvement suggestions)')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--project-type <type>', 'Filter observations by project type')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await evolveCommand({
      config: options.config,
      projectType: options.projectType,
      json: options.json,
    });
  });

program
  .command('prd <prdPath>')
  .description('Execute PRD autonomously via test-driven development')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('-d, --debug', 'Enable debug mode')
  .option('--resume', 'Resume from previous execution state')
  .action(async (prdPath, options) => {
    await prdCommand({
      prd: prdPath,
      config: options.config,
      debug: options.debug,
      resume: options.resume,
    });
  });

program
  .command('validate-prd <prdPath>')
  .description('Validate PRD frontmatter against schema')
  .option('--schema <path>', 'Path to custom schema file')
  .option('-v, --verbose', 'Show detailed validation information')
  .action(async (prdPath, options) => {
    await validatePrdCommand({
      prd: prdPath,
      schema: options.schema,
      verbose: options.verbose,
    });
  });

const prdSetCmd = program
  .command('prd-set')
  .description('PRD set execution and management commands');

prdSetCmd
  .command('execute <path>')
  .description('Execute entire PRD set (discovers index.md.yml automatically)')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('-d, --debug', 'Enable debug mode')
  .option('--parallel', 'Enable parallel execution of independent PRDs', true)
  .option('--max-concurrent <n>', 'Maximum concurrent PRD executions', (v) => parseInt(v, 10), 2)
  .action(async (path, options) => {
    await prdSetExecuteCommand({
      path,
      config: options.config,
      debug: options.debug,
      parallel: options.parallel,
      maxConcurrent: options.maxConcurrent,
    });
  });

prdSetCmd
  .command('status <path>')
  .description('Show current PRD set execution status')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (path, options) => {
    await prdSetStatusCommand({
      path,
      debug: options.debug,
    });
  });

prdSetCmd
  .command('list')
  .description('List all discovered PRD sets')
  .option('--planning-dir <dir>', 'Planning directory to scan', '.taskmaster/planning')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (options) => {
    await prdSetListCommand({
      planningDir: options.planningDir,
      debug: options.debug,
    });
  });

prdSetCmd
  .command('validate <path>')
  .description('Validate PRD set without executing')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (path, options) => {
    await prdSetValidateCommand({
      path,
      debug: options.debug,
    });
  });

prdSetCmd
  .command('pause <path>')
  .description('Pause PRD set execution')
  .action(async (path) => {
    console.log('Pause command not yet implemented');
    // TODO: Implement pause functionality
  });

prdSetCmd
  .command('resume <path>')
  .description('Resume paused PRD set execution')
  .action(async (path) => {
    console.log('Resume command not yet implemented');
    // TODO: Implement resume functionality
  });

prdSetCmd
  .command('cancel <path>')
  .description('Cancel PRD set execution')
  .action(async (path) => {
    console.log('Cancel command not yet implemented');
    // TODO: Implement cancel functionality
  });

program
  .command('scan')
  .description('Run code quality scans')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--type <type>', 'Scan type: all, static-analysis, duplicate-detection, security, complexity, tech-debt', 'all')
  .option('--output <format>', 'Output format: console, json, markdown', 'console')
  .option('--create-tasks', 'Create fix tasks from issues')
  .option('--min-severity <level>', 'Minimum severity: info, warning, error', 'info')
  .action(async (options) => {
    await scanCommand({
      type: options.type,
      output: options.output,
      createTasks: options.createTasks,
      minSeverity: options.minSeverity,
      config: options.config,
    });
  });

program
  .command('recommend')
  .description('Generate plugin/config recommendations')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--source <source>', 'Source: errors, codebase, both', 'both')
  .option('--output <format>', 'Output format: console, json', 'console')
  .option('--apply', 'Auto-apply recommendations to config')
  .option('--ai', 'Enable AI-enhanced pattern detection')
  .option('--ai-mode <mode>', 'AI mode: embeddings-only, llm-only, hybrid', 'hybrid')
  .option('--similarity <threshold>', 'Similarity threshold for clustering (0-1)', (v) => parseFloat(v))
  .option('--incremental', 'Only analyze files changed since last scan')
  .option('--full-scan', 'Force full scan ignoring cache')
  .option('--max-tokens <limit>', 'Maximum tokens to use for this scan', (v) => parseInt(v, 10))
  .option('--include-abstraction', 'Include abstraction pattern recommendations')
  .action(async (options) => {
    await recommendCommand({
      source: options.source,
      output: options.output,
      applyToConfig: options.apply,
      config: options.config,
      ai: options.ai,
      aiMode: options.aiMode,
      similarity: options.similarity,
      incremental: options.incremental,
      fullScan: options.fullScan,
      maxTokens: options.maxTokens,
      includeAbstraction: options.includeAbstraction,
    });
  });

program
  .command('feedback <recommendation-id>')
  .description('Provide feedback on AI recommendations')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--accept', 'Mark recommendation as accepted')
  .option('--reject', 'Mark recommendation as rejected')
  .option('--notes <notes>', 'Add notes about the recommendation')
  .option('--implementation <code>', 'Provide actual implementation (marks as modified)')
  .action(async (recommendationId, options) => {
    await feedbackCommand(recommendationId, {
      accept: options.accept,
      reject: options.reject,
      notes: options.notes,
      implementation: options.implementation,
      config: options.config,
    });
  });

program
  .command('archive')
  .description('Archive Task Master and dev-loop JSON state files')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--prd-name <name>', 'PRD name for archive directory (default: "default")')
  .option('--archive-path <path>', 'Custom archive path (default: .devloop/archive)')
  .option('--compress', 'Compress archive as .tar.gz')
  .action(async (options) => {
    await archiveCommand({
      config: options.config,
      prdName: options.prdName,
      archivePath: options.archivePath,
      compress: options.compress,
    });
  });

program
  .command('report')
  .description('Generate comprehensive execution reports')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--prd <id>', 'Generate report for PRD')
  .option('--prd-set <id>', 'Generate report for PRD set')
  .option('--phase <prdId:phaseId>', 'Generate report for phase (format: prdId:phaseId)')
  .option('--latest', 'Generate report for most recent PRD')
  .option('--all', 'Generate reports for all PRDs')
  .option('--format <format>', 'Report format: json, markdown, html', 'markdown')
  .option('--output <path>', 'Output file path')
  .option('--compare <id>', 'Compare with another PRD/PRD set')
  .action(async (options) => {
    await reportCommand({
      config: options.config,
      prd: options.prd,
      prdSet: options.prdSet,
      phase: options.phase,
      latest: options.latest,
      all: options.all,
      format: options.format as 'json' | 'markdown' | 'html',
      output: options.output,
      compare: options.compare,
    });
  });

program.parse();

