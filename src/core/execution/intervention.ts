import inquirer from 'inquirer';
import chalk from 'chalk';
import { Config } from '../../config/schema/core';
import { CodeChanges } from '../../types';

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

export class InterventionSystem {
  constructor(private config: Config) {}

  async requiresApproval(changes: CodeChanges): Promise<boolean> {
    if (this.config.intervention.mode === 'autonomous') {
      return false;
    }

    if (this.config.intervention.mode === 'review') {
      return true;
    }

    // Hybrid mode: check if any operation requires approval
    if (this.config.intervention.mode === 'hybrid') {
      const requiresApproval = changes.files.some((file) =>
        this.config.intervention.approvalRequired.some((op) =>
          file.operation.toLowerCase().includes(op.toLowerCase())
        )
      );
      return requiresApproval;
    }

    return false;
  }

  async requestApproval(changes: CodeChanges): Promise<ApprovalResult> {
    console.log(chalk.bold('\n📋 Code Changes Pending Approval\n'));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.cyan('Summary:'));
    console.log(`  ${changes.summary}\n`);

    console.log(chalk.cyan('Files to be modified:'));
    changes.files.forEach((file) => {
      const operationColor =
        file.operation === 'delete' ? chalk.red :
        file.operation === 'create' ? chalk.green :
        chalk.yellow;
      console.log(`  ${operationColor(file.operation.toUpperCase())} ${file.path}`);
    });

    console.log(chalk.gray('─'.repeat(60)));

    const { approved, reason } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'approved',
        message: 'Approve these changes?',
        default: false,
      },
      {
        type: 'input',
        name: 'reason',
        message: 'Reason (optional):',
        when: (answers: any) => !answers.approved,
      },
    ]);

    return {
      approved,
      reason: reason || undefined,
    };
  }

  async displayChanges(changes: CodeChanges): Promise<void> {
    console.log(chalk.bold('\n📝 Generated Code Changes\n'));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.cyan('Summary:'));
    console.log(`  ${changes.summary}\n`);

    changes.files.forEach((file, index) => {
      console.log(chalk.cyan(`\nFile ${index + 1}: ${file.path}`));
      console.log(chalk.gray(`Operation: ${file.operation}`));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(file.content);
      console.log(chalk.gray('─'.repeat(60)));
    });
  }
}

