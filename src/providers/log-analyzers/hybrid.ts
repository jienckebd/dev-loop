import { LogAnalyzer } from './interface';
import { LogSource, LogAnalysis } from '../../types';
import { PatternMatcher } from './pattern-matcher';
import { AILogAnalyzer } from './ai-analyzer';

export class HybridLogAnalyzer implements LogAnalyzer {
  public name = 'hybrid';

  constructor(
    private patternMatcher: PatternMatcher,
    private aiAnalyzer: AILogAnalyzer
  ) {}

  async analyze(sources: LogSource[]): Promise<LogAnalysis> {
    // First, run pattern matching (fast)
    const patternResult = await this.patternMatcher.analyze(sources);

    // If patterns found issues or we want comprehensive analysis, use AI
    if (patternResult.errors.length > 0 || patternResult.warnings.length > 0) {
      const aiResult = await this.aiAnalyzer.analyze(sources);

      // Combine results
      return {
        errors: [...new Set([...patternResult.errors, ...aiResult.errors])],
        warnings: [...new Set([...patternResult.warnings, ...aiResult.warnings])],
        summary: `${patternResult.summary}. AI Analysis: ${aiResult.summary}`,
        recommendations: aiResult.recommendations || patternResult.recommendations,
      };
    }

    // If no patterns matched, still use AI for comprehensive analysis
    const aiResult = await this.aiAnalyzer.analyze(sources);

    return {
      errors: aiResult.errors,
      warnings: aiResult.warnings,
      summary: aiResult.summary,
      recommendations: aiResult.recommendations,
    };
  }
}

