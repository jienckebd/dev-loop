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
import { evolutionCommand } from './cli/commands/evolution';
import { evolveCommand } from './cli/commands/evolve';
import { prdCommand } from './cli/commands/prd';

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

const evolutionCmd = program
  .command('evolution')
  .description('Evolution mode commands (for outer agent)');

evolutionCmd
  .command('start')
  .description('Activate evolution mode')
  .requiredOption('--prd <path>', 'Path to PRD file')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(async (options) => {
    await evolutionCommand({ action: 'start', prd: options.prd, config: options.config });
  });

evolutionCmd
  .command('status')
  .description('Check evolution mode status')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .action(async (options) => {
    await evolutionCommand({ action: 'status', config: options.config });
  });

evolutionCmd
  .command('stop')
  .description('Deactivate evolution mode')
  .action(async () => {
    await evolutionCommand({ action: 'stop' });
  });

program
  .command('evolve')
  .description('View evolution insights (observations and improvement suggestions)')
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

program.parse();

