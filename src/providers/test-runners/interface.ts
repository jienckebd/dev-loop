import { TestResult, Artifact } from '../../types';

export interface TestRunnerOptions {
  command: string;
  timeout: number;
  artifactsDir: string;
  workingDirectory?: string;
}

export interface TestRunner {
  name: string;
  run(options: TestRunnerOptions): Promise<TestResult>;
  getArtifacts(artifactsDir: string): Promise<Artifact[]>;
}

