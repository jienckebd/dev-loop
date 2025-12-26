import { Config } from '../../config/schema';
import { TestRunner } from './interface';
import { PlaywrightRunner } from './playwright';
import { CypressRunner } from './cypress';

export class TestRunnerFactory {
  static create(config: Config): TestRunner {
    switch (config.testing.runner) {
      case 'playwright':
        return new PlaywrightRunner();
      case 'cypress':
        return new CypressRunner();
      default:
        throw new Error(`Unknown test runner: ${config.testing.runner}`);
    }
  }
}

