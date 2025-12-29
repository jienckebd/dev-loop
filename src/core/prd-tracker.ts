import * as fs from 'fs-extra';
import * as path from 'path';
import { TaskMasterBridge } from './task-bridge';
import { TestRunnerFactory } from '../providers/test-runners/factory';
import { Config } from '../config/schema';

export interface PrdCompletionStatus {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  blockedTasks: number;
  testsPassing: boolean;
  percentComplete: number;
  lastTestResult?: {
    success: boolean;
    output: string;
  };
}

export class PrdTracker {
  private taskBridge: TaskMasterBridge;
  private testRunner: any;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.taskBridge = new TaskMasterBridge(config);
    this.testRunner = TestRunnerFactory.create(config);
  }

  async getCompletionStatus(): Promise<PrdCompletionStatus> {
    // Get all tasks
    const allTasks = await this.taskBridge.getAllTasks();

    // Count tasks by status
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === 'done').length;
    const failedTasks = allTasks.filter(t => t.status === 'blocked').length;
    const pendingTasks = allTasks.filter(t => t.status === 'pending' || t.status === 'in-progress').length;
    const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;

    // Calculate percentage (based on completed vs total)
    const percentComplete = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100)
      : 100;

    // Run tests to check if they pass
    let testsPassing = false;
    let lastTestResult: { success: boolean; output: string } | undefined;

    try {
      const testResult = await this.testRunner.run({
        command: this.config.testing.command,
        timeout: this.config.testing.timeout || 300000,
        artifactsDir: this.config.testing.artifactsDir || 'test-results',
      });

      testsPassing = testResult.success;
      lastTestResult = {
        success: testResult.success,
        output: testResult.output || '',
      };
    } catch (error) {
      // If test run fails, assume tests are not passing
      testsPassing = false;
      lastTestResult = {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      pendingTasks,
      blockedTasks,
      testsPassing,
      percentComplete,
      lastTestResult,
    };
  }

  async isComplete(): Promise<boolean> {
    const status = await this.getCompletionStatus();
    return status.pendingTasks === 0 &&
           status.blockedTasks === 0 &&
           status.testsPassing;
  }
}
