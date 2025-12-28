import { Config } from '../../config/schema';
import { LogAnalyzer } from './interface';
import { PatternMatcher } from './pattern-matcher';
import { AILogAnalyzer } from './ai-analyzer';
import { HybridLogAnalyzer } from './hybrid';
import { AIProviderFactory } from '../ai/factory';

export class LogAnalyzerFactory {
  static create(config: Config): LogAnalyzer {
    const patternMatcher = new PatternMatcher(
      config.logs.patterns.error,
      config.logs.patterns.warning,
      (config.logs as any).ignorePatterns  // Optional ignore patterns
    );

    if (config.logs.useAI) {
      const aiProvider = AIProviderFactory.createWithFallback(config);
      const aiAnalyzer = new AILogAnalyzer(aiProvider);
      return new HybridLogAnalyzer(patternMatcher, aiAnalyzer);
    }

    return patternMatcher;
  }
}

