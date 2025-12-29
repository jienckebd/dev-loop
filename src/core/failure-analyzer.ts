import { AIProvider } from '../providers/ai/interface';
import { PrdContext, Issue, FileKnowledge, Pattern, Approach } from './prd-context';
import { TestExecutionResult, ExtendedTestResult, FailureDetails } from './test-executor';

export interface FailureInfo {
  testId: string;
  rootCause: string;
  category: 'code' | 'test' | 'environment' | 'unknown';
  affectedFiles: FileKnowledge[];
  suggestedFix: string;
  learnings: string[];
}

export interface FailureAnalysis {
  failures: FailureInfo[];
  commonPatterns: string[];
  suggestedFixes: string[];
}

export class FailureAnalyzer {
  constructor(
    private aiProvider: AIProvider,
    private debug: boolean = false
  ) {}

  /**
   * Analyze test failures and extract learnings
   */
  async analyze(
    result: TestExecutionResult,
    context: PrdContext
  ): Promise<FailureAnalysis> {
    const analyses: FailureInfo[] = [];

    for (const failure of result.results.filter(r => !r.success)) {
      const analysis = await this.analyzeFailure(failure, context);
      analyses.push(analysis);

      // Update context with learnings
      await this.updateContextWithLearnings(analysis, context);
    }

    const commonPatterns = this.findCommonPatterns(analyses);
    const suggestedFixes = this.generateFixSuggestions({ failures: analyses, commonPatterns, suggestedFixes: [] }, context);

    return {
      failures: analyses,
      commonPatterns,
      suggestedFixes,
    };
  }

  /**
   * Analyze a single test failure
   */
  private async analyzeFailure(
    failure: ExtendedTestResult,
    context: PrdContext
  ): Promise<FailureInfo> {
    // Use AI to analyze the failure with full context
    const prompt = this.buildAnalysisPrompt(failure, context);

    try {
      const response = await this.aiProvider.generateCode(prompt, {
        task: {
          id: `analyze-${failure.testId}`,
          title: `Analyze failure: ${failure.testId}`,
          description: 'Analyze test failure and determine root cause',
          status: 'pending',
          priority: 'critical',
        },
        codebaseContext: this.buildCodebaseContext(context),
      });

      // Parse AI response
      const analysis = this.parseAnalysisResponse(response, failure);

      return analysis;
    } catch (error) {
      if (this.debug) {
        console.warn(`[FailureAnalyzer] AI analysis failed, using fallback: ${error}`);
      }
      // Fallback analysis
      return this.fallbackAnalysis(failure, context);
    }
  }

  /**
   * Build analysis prompt
   */
  private buildAnalysisPrompt(failure: ExtendedTestResult, context: PrdContext): string {
    const sections = [
      `Analyze this test failure and determine the root cause.`,
      '',
      `## Test Output`,
      failure.output.substring(0, 2000), // Limit output size
      '',
    ];

    if (failure.failureDetails) {
      sections.push(
        `## Error Details`,
        JSON.stringify(failure.failureDetails, null, 2),
        ''
      );
    }

    // Add previous attempts
    const previousAttempts = this.getPreviousAttempts(failure.testId, context);
    if (previousAttempts.length > 0) {
      sections.push(
        `## Previous Attempts on This Test`,
        ...previousAttempts.map(a => `- ${a}`),
        ''
      );
    }

    // Add known issues
    if (context.knowledge.discoveredIssues.length > 0) {
      sections.push(
        `## Known Issues in This PRD`,
        ...context.knowledge.discoveredIssues.map(i => `- ${i.description}`),
        ''
      );
    }

    sections.push(
      `Provide analysis in this format:`,
      `1. Root cause (code issue, test issue, environment issue)`,
      `2. Category: code/test/environment/unknown`,
      `3. Specific file and line if identifiable`,
      `4. Suggested fix approach`,
      `5. Any patterns to remember for future`,
      `6. Affected files with their purpose`
    );

    return sections.join('\n');
  }

  /**
   * Parse AI response into FailureInfo
   */
  private parseAnalysisResponse(response: any, failure: ExtendedTestResult): FailureInfo {
    const content = response.files?.[0]?.content || response.summary || '';

    // Try to extract structured information
    const rootCauseMatch = content.match(/root cause[:\s]+(.+?)(?:\n|$)/i);
    const categoryMatch = content.match(/category[:\s]+(code|test|environment|unknown)/i);
    const fixMatch = content.match(/suggested fix[:\s]+(.+?)(?:\n\n|\n##|$)/is);

    // Extract file paths
    const fileMatches = content.matchAll(/([^\s]+\.(?:php|ts|js|tsx|jsx))(?:\s*:\s*(\d+))?/g);
    const affectedFiles: FileKnowledge[] = [];
    for (const match of fileMatches) {
      affectedFiles.push({
        path: match[1],
        purpose: 'Mentioned in error analysis',
        discoveredAt: new Date().toISOString(),
      });
    }

    return {
      testId: failure.testId,
      rootCause: rootCauseMatch?.[1]?.trim() || 'Unknown root cause',
      category: (categoryMatch?.[1]?.toLowerCase() as any) || 'unknown',
      affectedFiles,
      suggestedFix: fixMatch?.[1]?.trim() || 'Review error output and fix accordingly',
      learnings: this.extractLearnings(content),
    };
  }

  /**
   * Extract learnings from analysis
   */
  private extractLearnings(content: string): string[] {
    const learnings: string[] = [];

    // Look for patterns section
    const patternsMatch = content.match(/patterns?[:\s]+(.+?)(?:\n\n|\n##|$)/is);
    if (patternsMatch) {
      const patterns = patternsMatch[1].split('\n').filter(l => l.trim());
      learnings.push(...patterns);
    }

    return learnings;
  }

  /**
   * Fallback analysis when AI fails
   */
  private fallbackAnalysis(failure: ExtendedTestResult, context: PrdContext): FailureInfo {
    const output = failure.output.toLowerCase();

    // Simple pattern matching
    let category: 'code' | 'test' | 'environment' | 'unknown' = 'unknown';
    if (output.includes('syntax') || output.includes('parse') || output.includes('typeerror')) {
      category = 'code';
    } else if (output.includes('timeout') || output.includes('network')) {
      category = 'environment';
    } else if (output.includes('assert') || output.includes('expect')) {
      category = 'test';
    }

    // Extract file paths from error
    const fileMatches = failure.output.matchAll(/([^\s]+\.(?:php|ts|js|tsx|jsx))(?:\s*:\s*(\d+))?/g);
    const affectedFiles: FileKnowledge[] = [];
    for (const match of fileMatches) {
      affectedFiles.push({
        path: match[1],
        purpose: 'Mentioned in error',
        discoveredAt: new Date().toISOString(),
      });
    }

    return {
      testId: failure.testId,
      rootCause: failure.failureDetails?.message || 'Test execution failed',
      category,
      affectedFiles,
      suggestedFix: 'Review test output and error details',
      learnings: [],
    };
  }

  /**
   * Get previous attempts for a test
   */
  private getPreviousAttempts(testId: string, context: PrdContext): string[] {
    const attempts: string[] = [];

    // Find test in context
    const test = context.tests.find(t => t.id === testId);
    if (test && test.attempts > 1) {
      attempts.push(`Test has been attempted ${test.attempts} times`);
    }

    // Find related failed approaches
    const relatedApproaches = context.knowledge.failedApproaches.filter(
      a => a.description.includes(testId)
    );
    for (const approach of relatedApproaches) {
      attempts.push(`${approach.description}: ${approach.reason}`);
    }

    return attempts;
  }

  /**
   * Build codebase context for AI
   */
  private buildCodebaseContext(context: PrdContext): string {
    const sections: string[] = [];

    if (context.knowledge.codeLocations.length > 0) {
      sections.push(
        '## Known Code Locations',
        ...context.knowledge.codeLocations.map(
          l => `- ${l.path}: ${l.purpose}`
        )
      );
    }

    return sections.join('\n');
  }

  /**
   * Update context with learnings from analysis
   */
  private async updateContextWithLearnings(
    analysis: FailureInfo,
    context: PrdContext
  ): Promise<void> {
    // Add discovered issues
    if (analysis.rootCause && analysis.rootCause !== 'Unknown root cause') {
      const existingIssue = context.knowledge.discoveredIssues.find(
        i => i.description === analysis.rootCause
      );
      if (!existingIssue) {
        context.knowledge.discoveredIssues.push({
          id: `issue-${Date.now()}`,
          description: analysis.rootCause,
          testId: analysis.testId,
          discoveredAt: new Date().toISOString(),
        });
      }
    }

    // Add file knowledge
    for (const file of analysis.affectedFiles) {
      const existing = context.knowledge.codeLocations.find(
        l => l.path === file.path
      );
      if (!existing) {
        context.knowledge.codeLocations.push(file);
      }
    }

    // Record failed approach if this is a retry
    const test = context.tests.find(t => t.id === analysis.testId);
    if (test && test.attempts > 1) {
      context.knowledge.failedApproaches.push({
        id: `failed-${Date.now()}`,
        description: `Attempt ${test.attempts} for ${analysis.testId}`,
        reason: analysis.rootCause,
        attemptedAt: new Date().toISOString(),
      });
    }

    // Add learnings as patterns if they're code-related
    for (const learning of analysis.learnings) {
      if (learning.length > 20 && learning.includes('code') || learning.includes('pattern')) {
        context.knowledge.workingPatterns.push({
          id: `pattern-${Date.now()}`,
          description: learning,
          code: '', // Would be extracted from learning if it contains code
          context: analysis.testId,
          discoveredAt: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Find common patterns across failures
   */
  private findCommonPatterns(analyses: FailureInfo[]): string[] {
    const patterns: string[] = [];

    // Group by category
    const byCategory = new Map<string, number>();
    for (const analysis of analyses) {
      byCategory.set(analysis.category, (byCategory.get(analysis.category) || 0) + 1);
    }

    for (const [category, count] of byCategory.entries()) {
      if (count > 1) {
        patterns.push(`${count} failures are ${category} issues`);
      }
    }

    // Check for common file patterns
    const fileCounts = new Map<string, number>();
    for (const analysis of analyses) {
      for (const file of analysis.affectedFiles) {
        fileCounts.set(file.path, (fileCounts.get(file.path) || 0) + 1);
      }
    }

    for (const [file, count] of fileCounts.entries()) {
      if (count > 1) {
        patterns.push(`${file} appears in ${count} failures`);
      }
    }

    return patterns;
  }

  /**
   * Generate fix suggestions
   */
  private generateFixSuggestions(analyses: FailureAnalysis, context: PrdContext): string[] {
    const suggestions: string[] = [];

    // Group by category
    const codeIssues = analyses.failures.filter(f => f.category === 'code');
    const testIssues = analyses.failures.filter(f => f.category === 'test');
    const envIssues = analyses.failures.filter(f => f.category === 'environment');

    if (codeIssues.length > 0) {
      suggestions.push(`Fix ${codeIssues.length} code issue(s) in: ${codeIssues.map(f => f.affectedFiles[0]?.path).filter(Boolean).join(', ')}`);
    }

    if (testIssues.length > 0) {
      suggestions.push(`Review and fix ${testIssues.length} test issue(s)`);
    }

    if (envIssues.length > 0) {
      suggestions.push(`Check environment configuration (${envIssues.length} environment issue(s))`);
    }

    return suggestions;
  }
}
