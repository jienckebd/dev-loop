import { LogAnalyzer } from './interface';
import { LogSource, LogAnalysis } from '../../types';
import { AIProvider } from '../ai/interface';
import { TaskContext } from '../../types';
import * as fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class AILogAnalyzer implements LogAnalyzer {
  public name = 'ai-analyzer';

  constructor(private aiProvider: AIProvider) {}

  async analyze(sources: LogSource[]): Promise<LogAnalysis> {
    const allContent: string[] = [];

    // Collect log content from all sources
    for (const source of sources) {
      let content = '';

      if (source.type === 'file' && source.path) {
        try {
          if (await fs.pathExists(source.path)) {
            content = await fs.readFile(source.path, 'utf-8');
          }
        } catch (error) {
          // Ignore file read errors
        }
      } else if (source.type === 'command' && source.command) {
        try {
          const { stdout, stderr } = await execAsync(source.command);
          content = stdout + stderr;
        } catch (error: any) {
          content = error.stdout || error.stderr || '';
        }
      }

      if (content) {
        allContent.push(content);
      }
    }

    const combinedLogs = allContent.join('\n---\n');

    if (!combinedLogs.trim()) {
      return {
        errors: [],
        warnings: [],
        summary: 'No log content found',
      };
    }

    // Use AI to analyze the logs
    const context: TaskContext = {
      task: {
        id: 'log-analysis',
        title: 'Log Analysis',
        description: 'Analyze application logs for errors and warnings',
        status: 'in-progress',
        priority: 'medium',
      },
    };

    try {
      return await this.aiProvider.analyzeError(combinedLogs, context);
    } catch (error) {
      // Fallback if AI analysis fails
      return {
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        summary: 'Failed to analyze logs with AI',
        recommendations: ['Review logs manually'],
      };
    }
  }
}

