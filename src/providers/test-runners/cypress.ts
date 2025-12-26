import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TestRunner, TestRunnerOptions } from './interface';
import { TestResult, Artifact } from '../../types';

const execAsync = promisify(exec);

export class CypressRunner implements TestRunner {
  public name = 'cypress';

  async run(options: TestRunnerOptions): Promise<TestResult> {
    const startTime = Date.now();
    const workingDir = options.workingDirectory || process.cwd();

    try {
      // Execute Cypress tests
      const { stdout, stderr } = await execAsync(options.command, {
        cwd: workingDir,
        timeout: options.timeout,
        env: {
          ...process.env,
          CI: 'true', // Ensure CI mode for consistent output
        },
      });

      const output = stdout + stderr;
      const duration = Date.now() - startTime;

      // Parse Cypress test results
      // Cypress typically exits with code 0 on success, non-zero on failure
      const success = !output.includes('failed') && !output.includes('Failed');

      // Collect artifacts
      const artifacts = await this.getArtifacts(options.artifactsDir);

      return {
        success,
        output,
        artifacts,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const output = error.stdout || error.stderr || error.message || String(error);

      // Even on error, try to collect artifacts
      let artifacts: Artifact[] = [];
      try {
        artifacts = await this.getArtifacts(options.artifactsDir);
      } catch {
        // Ignore artifact collection errors
      }

      return {
        success: false,
        output,
        artifacts,
        duration,
      };
    }
  }

  async getArtifacts(artifactsDir: string): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    const fullPath = path.resolve(artifactsDir);

    if (!(await fs.pathExists(fullPath))) {
      return artifacts;
    }

    try {
      // Look for Cypress artifacts
      // Cypress typically stores artifacts in cypress/screenshots and cypress/videos
      const screenshotsDir = path.join(fullPath, 'screenshots');
      const videosDir = path.join(fullPath, 'videos');

      for (const [dir, artifactType] of [
        [screenshotsDir, 'screenshot' as const],
        [videosDir, 'video' as const],
      ]) {
        if (await fs.pathExists(dir)) {
          const files = await fs.readdir(dir, { recursive: true });
          for (const file of files) {
            const fileStr = String(file);
            const filePath = path.join(String(dir), fileStr);
            const stat = await fs.stat(filePath);
            if (stat.isFile()) {
              artifacts.push({
                type: artifactType as Artifact['type'],
                path: filePath,
                name: path.basename(fileStr),
              });
            }
          }
        }
      }

      // Also check for Cypress test results JSON
      const resultsFile = path.join(fullPath, 'results.json');
      if (await fs.pathExists(resultsFile)) {
        artifacts.push({
          type: 'log',
          path: resultsFile,
          name: 'results.json',
        });
      }
    } catch (error) {
      // Ignore errors during artifact collection
    }

    return artifacts;
  }
}

