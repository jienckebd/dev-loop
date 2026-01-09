import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from "../../core/execution/task-bridge";
import { StateManager } from "../../core/utils/state-manager";

export async function handoffCreateCommand(options: {
  config?: string;
  output?: string;
}): Promise<void> {
  const spinner = ora('Generating handoff document').start();

  try {
    const config = await loadConfig(options.config);
    const taskBridge = new TaskMasterBridge(config);
    const stateManager = new StateManager(config);

    const allTasks = await taskBridge.getAllTasks();
    const workflowState = await stateManager.getWorkflowState();

    // Categorize tasks
    const doneTasks = allTasks.filter(t => t.status === 'done');
    const pendingTasks = allTasks.filter(t => t.status === 'pending');
    const inProgressTasks = allTasks.filter(t => t.status === 'in-progress');
    const blockedTasks = allTasks.filter(t => t.status === 'blocked');

    // Generate handoff document
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const handoffContent = `# Dev-Loop Handoff Document

Generated: ${new Date().toISOString()}

## Summary

| Status | Count |
|--------|-------|
| Done | ${doneTasks.length} |
| In Progress | ${inProgressTasks.length} |
| Pending | ${pendingTasks.length} |
| Blocked | ${blockedTasks.length} |
| **Total** | **${allTasks.length}** |

Progress: ${workflowState.progress ? Math.round(workflowState.progress * 100) : 0}%

## Current State

${workflowState.currentTask ? `Current Task: **${workflowState.currentTask.id}** - ${workflowState.currentTask.title}` : 'No active task'}
Status: ${workflowState.status}

## Completed Work

${doneTasks.length > 0 ? doneTasks.map(t => `- [x] **${t.id}**: ${t.title}`).join('\n') : 'No tasks completed yet.'}

## In Progress

${inProgressTasks.length > 0 ? inProgressTasks.map(t => `- [ ] **${t.id}**: ${t.title}`).join('\n') : 'No tasks in progress.'}

## Pending Work

${pendingTasks.length > 0 ? pendingTasks.map(t => `- [ ] **${t.id}**: ${t.title}`).join('\n') : 'No pending tasks.'}

## Blocked Tasks

${blockedTasks.length > 0 ? blockedTasks.map(t => `- **${t.id}**: ${t.title}\n  Status: ${t.status}`).join('\n\n') : 'No blocked tasks.'}

## Next Steps

${pendingTasks.length > 0 ? `1. Resume with task **${pendingTasks[0].id}**: ${pendingTasks[0].title}` : 'All tasks completed!'}
${blockedTasks.length > 0 ? `\n**Note**: ${blockedTasks.length} task(s) are blocked and may need manual intervention.` : ''}

## Commands to Resume

\`\`\`bash
# Check current status
npx dev-loop status

# Run next task
npx dev-loop run

# Run all pending tasks
npx dev-loop run --all

# View logs
npx dev-loop logs --tail 50
\`\`\`
`;

    // Determine output path
    const outputPath = options.output || path.join('files-private', `handoff-${timestamp}.md`);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, handoffContent);

    spinner.succeed('Handoff document generated');
    console.log(chalk.green(`\n✓ Created: ${outputPath}`));
    console.log(chalk.gray(`\nProgress: ${doneTasks.length}/${allTasks.length} tasks completed`));

  } catch (error) {
    spinner.fail('Failed to generate handoff');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function handoffShowCommand(options: {
  config?: string;
}): Promise<void> {
  try {
    // Find most recent handoff file
    const handoffDir = 'files-private';
    if (!await fs.pathExists(handoffDir)) {
      console.log(chalk.yellow('No handoff documents found'));
      return;
    }

    const files = await fs.readdir(handoffDir);
    const handoffFiles = files.filter(f => f.startsWith('handoff-') && f.endsWith('.md'));

    if (handoffFiles.length === 0) {
      console.log(chalk.yellow('No handoff documents found'));
      return;
    }

    // Sort by name (contains timestamp) and get most recent
    handoffFiles.sort().reverse();
    const latestHandoff = path.join(handoffDir, handoffFiles[0]);

    console.log(chalk.bold(`\nLatest Handoff: ${latestHandoff}\n`));
    console.log(chalk.gray('─'.repeat(80)));

    const content = await fs.readFile(latestHandoff, 'utf-8');
    console.log(content);

    console.log(chalk.gray('─'.repeat(80)));

  } catch (error) {
    console.error(chalk.red(`Failed to show handoff: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function handoffListCommand(): Promise<void> {
  try {
    const handoffDir = 'files-private';
    if (!await fs.pathExists(handoffDir)) {
      console.log(chalk.yellow('No handoff documents found'));
      return;
    }

    const files = await fs.readdir(handoffDir);
    const handoffFiles = files.filter(f => f.startsWith('handoff-') && f.endsWith('.md'));

    if (handoffFiles.length === 0) {
      console.log(chalk.yellow('No handoff documents found'));
      return;
    }

    console.log(chalk.bold('\nHandoff Documents\n'));
    console.log(chalk.gray('─'.repeat(60)));

    handoffFiles.sort().reverse();
    for (const file of handoffFiles) {
      const filePath = path.join(handoffDir, file);
      const stats = await fs.stat(filePath);
      console.log(`  ${file}  (${(stats.size / 1024).toFixed(1)} KB)`);
    }

    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`\nTotal: ${handoffFiles.length} handoff document(s)`));

  } catch (error) {
    console.error(chalk.red(`Failed to list handoffs: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
