import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from '../../core/task-bridge';
import { Task, TaskStatus } from '../../types';

export async function listCommand(options: {
  config?: string;
  pending?: boolean;
  failed?: boolean;
  done?: boolean;
  blocked?: boolean;
  tree?: boolean;
  json?: boolean;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const taskBridge = new TaskMasterBridge(config);

    const tasks = await taskBridge.getAllTasks();

    let filteredTasks = tasks;

    // Apply filters
    if (options.pending) {
      filteredTasks = tasks.filter(t => t.status === 'pending');
    } else if (options.failed) {
      filteredTasks = tasks.filter(t => t.status === 'blocked');
    } else if (options.done) {
      filteredTasks = tasks.filter(t => t.status === 'done');
    } else if (options.blocked) {
      filteredTasks = tasks.filter(t => t.status === 'blocked');
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(filteredTasks, null, 2));
      return;
    }

    // Tree output
    if (options.tree) {
      printTaskTree(filteredTasks);
      return;
    }

    // Default table output
    printTaskTable(filteredTasks);

  } catch (error) {
    console.error(chalk.red(`Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function printTaskTable(tasks: Task[]): void {
  console.log(chalk.bold('\nTasks\n'));
  console.log(chalk.gray('─'.repeat(80)));

  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks found'));
    return;
  }

  // Group by status
  const byStatus: Record<string, Task[]> = {};
  for (const task of tasks) {
    const status = task.status || 'pending';
    if (!byStatus[status]) {
      byStatus[status] = [];
    }
    byStatus[status].push(task);
  }

  const statusOrder: TaskStatus[] = ['pending', 'in-progress', 'blocked', 'done'];

  for (const status of statusOrder) {
    if (!byStatus[status]) continue;

    const statusColor = {
      'pending': chalk.yellow,
      'in-progress': chalk.blue,
      'blocked': chalk.red,
      'done': chalk.green,
    }[status] || chalk.white;

    console.log(chalk.bold(`\n${statusColor(status.toUpperCase())} (${byStatus[status].length})\n`));

    for (const task of byStatus[status]) {
      const priorityColor = {
        critical: chalk.red,
        high: chalk.yellow,
        medium: chalk.cyan,
        low: chalk.gray,
      }[task.priority || 'medium'] || chalk.white;

      const prefix = task.parentId ? '  └─ ' : '';
      console.log(`${prefix}${chalk.bold(task.id)} ${task.title}`);
      console.log(`    ${priorityColor(`Priority: ${task.priority || 'medium'}`)}`);
      if (task.description) {
        const desc = task.description.split('\n')[0].substring(0, 60);
        console.log(`    ${chalk.gray(desc)}${desc.length >= 60 ? '...' : ''}`);
      }
    }
  }

  console.log(chalk.gray('\n─'.repeat(80)));
  console.log(chalk.gray(`Total: ${tasks.length} tasks`));
}

function printTaskTree(tasks: Task[]): void {
  console.log(chalk.bold('\nTask Dependency Tree\n'));
  console.log(chalk.gray('─'.repeat(80)));

  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks found'));
    return;
  }

  // Build dependency map
  const taskMap = new Map<string, Task>();
  const children = new Map<string, Task[]>();

  for (const task of tasks) {
    taskMap.set(task.id.toString(), task);
    if (task.dependencies && task.dependencies.length > 0) {
      for (const depId of task.dependencies) {
        if (!children.has(depId.toString())) {
          children.set(depId.toString(), []);
        }
        children.get(depId.toString())!.push(task);
      }
    }
  }

  // Find root tasks (no dependencies or dependencies not in current set)
  const rootTasks = tasks.filter(t =>
    !t.dependencies ||
    t.dependencies.length === 0 ||
    t.dependencies.every(depId => !taskMap.has(depId.toString()))
  );

  function printTask(task: Task, indent: string = '', isLast: boolean = true): void {
    const statusColor = {
      'pending': chalk.yellow,
      'in-progress': chalk.blue,
      'blocked': chalk.red,
      'done': chalk.green,
    }[task.status || 'pending'] || chalk.white;

    const connector = isLast ? '└─' : '├─';
    console.log(`${indent}${connector} ${chalk.bold(task.id)} ${statusColor(task.status || 'pending')} ${task.title}`);

    const taskChildren = children.get(task.id.toString()) || [];
    const newIndent = indent + (isLast ? '  ' : '│ ');

    for (let i = 0; i < taskChildren.length; i++) {
      printTask(taskChildren[i], newIndent, i === taskChildren.length - 1);
    }
  }

  for (let i = 0; i < rootTasks.length; i++) {
    printTask(rootTasks[i], '', i === rootTasks.length - 1);
  }
}
