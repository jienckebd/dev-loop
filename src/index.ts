#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './cli/commands/init';
import { runCommand } from './cli/commands/run';
import { watchCommand } from './cli/commands/watch';
import { stopCommand } from './cli/commands/stop';
import { statusCommand } from './cli/commands/status';
import { logsCommand } from './cli/commands/logs';

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
  .action(runCommand);

program
  .command('watch')
  .description('Daemon mode - continuous execution until PRD complete')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
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
  .description('View/analyze recent logs')
  .option('-c, --config <path>', 'Path to config file', 'devloop.config.js')
  .option('--analyze', 'Run log analysis')
  .action(logsCommand);

program.parse();

