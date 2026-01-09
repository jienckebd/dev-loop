import { Observation } from '../tracking/observation-tracker';
import { MetricsData, RunMetrics } from '../metrics/debug';

export interface ImprovementSuggestion {
  id: string;
  priority: 'low' | 'medium' | 'high';
  category: 'pattern' | 'template' | 'validation' | 'context' | 'prompt';
  title: string;
  description: string;
  evidence: string[]; // Metrics/observations supporting the suggestion
  suggestedAction: string;
  estimatedImpact: string;
}

export class ImprovementSuggester {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Analyze observations and metrics to generate improvement suggestions
   */
  async analyze(observations: Observation[], metrics: MetricsData): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];

    // Analyze observations for pattern additions
    suggestions.push(...await this.suggestPatternAdditions(observations));

    // Analyze for template improvements
    suggestions.push(...await this.suggestTemplateImprovements(observations, metrics));

    // Analyze for validation enhancements
    suggestions.push(...await this.suggestValidationEnhancements(observations, metrics));

    // Analyze for context provider improvements
    suggestions.push(...await this.suggestContextImprovements(observations, metrics));

    // Analyze for prompt improvements
    suggestions.push(...await this.suggestPromptImprovements(observations, metrics));

    // Sort by priority
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return suggestions.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
  }

  /**
   * Suggest new patterns to add to PatternLearningSystem
   */
  async suggestPatternAdditions(observations: Observation[]): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const failurePatterns = observations.filter(obs => obs.type === 'failure-pattern');

    // Find patterns that occur frequently but aren't in PatternLearningSystem
    const frequentPatterns = failurePatterns.filter(obs => obs.occurrences >= 3);

    for (const pattern of frequentPatterns) {
      suggestions.push({
        id: `pattern-${pattern.id}`,
        priority: pattern.severity === 'high' ? 'high' : pattern.occurrences >= 5 ? 'medium' : 'low',
        category: 'pattern',
        title: `Add pattern for: ${pattern.description.substring(0, 60)}...`,
        description: `This failure pattern has occurred ${pattern.occurrences} times across ${pattern.affectedProjects.length} project type(s). Adding it to PatternLearningSystem would prevent future occurrences.`,
        evidence: [
          `Occurrences: ${pattern.occurrences}`,
          `Affected projects: ${pattern.affectedProjects.join(', ')}`,
          `First seen: ${pattern.firstSeen}`,
          `Last seen: ${pattern.lastSeen}`,
        ],
        suggestedAction: `Add pattern to PatternLearningSystem with guidance: "${pattern.suggestedImprovements[0] || 'Prevent this error pattern'}"`,
        estimatedImpact: `Could prevent ${pattern.occurrences} future failures`,
      });
    }

    return suggestions;
  }

  /**
   * Suggest template improvements based on low success rates
   */
  async suggestTemplateImprovements(observations: Observation[], metrics: MetricsData): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const runs = metrics.runs;

    if (runs.length < 10) {
      return suggestions; // Need more data
    }

    const recentRuns = runs.slice(-20);
    const successRate = recentRuns.filter(r => r.status === 'completed').length / recentRuns.length;

    if (successRate < 0.5) {
      suggestions.push({
        id: 'template-low-success',
        priority: 'high',
        category: 'template',
        title: 'Low success rate suggests template improvements needed',
        description: `Only ${(successRate * 100).toFixed(0)}% of recent runs succeeded. This may indicate that AI prompts need better guidance or examples.`,
        evidence: [
          `Success rate: ${(successRate * 100).toFixed(1)}%`,
          `Recent runs analyzed: ${recentRuns.length}`,
          `Failed runs: ${recentRuns.filter(r => r.status === 'failed').length}`,
        ],
        suggestedAction: 'Review and enhance prompt templates to provide better guidance and examples',
        estimatedImpact: 'Could improve success rate by 20-30%',
      });
    }

    // Check for specific error categories that might indicate template issues
    const validationFailures = observations.filter(obs =>
      obs.type === 'validation-trend' && obs.severity === 'high'
    );

    if (validationFailures.length > 0) {
      suggestions.push({
        id: 'template-validation-guidance',
        priority: 'medium',
        category: 'template',
        title: 'Add validation guidance to templates',
        description: 'High validation failure rate suggests templates should include more explicit validation instructions.',
        evidence: validationFailures.map(obs => obs.description),
        suggestedAction: 'Add validation examples and explicit instructions to code generation templates',
        estimatedImpact: 'Could reduce validation failures by 40-50%',
      });
    }

    return suggestions;
  }

  /**
   * Suggest validation enhancements
   */
  async suggestValidationEnhancements(observations: Observation[], metrics: MetricsData): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const runs = metrics.runs;

    const validationFailures = runs.filter(r => r.validation?.preValidationPassed === false);
    const validationFailureRate = validationFailures.length / runs.length;

    if (validationFailureRate > 0.3 && runs.length >= 10) {
      suggestions.push({
        id: 'validation-enhance-precheck',
        priority: 'high',
        category: 'validation',
        title: 'Enhance pre-validation checks',
        description: `${(validationFailureRate * 100).toFixed(0)}% of runs fail pre-validation. This suggests validation rules need improvement.`,
        evidence: [
          `Validation failure rate: ${(validationFailureRate * 100).toFixed(1)}%`,
          `Total validation failures: ${validationFailures.length}`,
          `Total runs: ${runs.length}`,
        ],
        suggestedAction: 'Review ValidationGate checks and add more comprehensive validation rules',
        estimatedImpact: `Could prevent ${Math.round(validationFailures.length * 0.5)} validation failures`,
      });
    }

    // Check for specific error categories
    const syntaxErrors = runs.filter(r => (r.validation?.syntaxErrorsFound || 0) > 0);
    if (syntaxErrors.length > runs.length * 0.2) {
      suggestions.push({
        id: 'validation-syntax-check',
        priority: 'medium',
        category: 'validation',
        title: 'Improve syntax validation',
        description: 'Many runs have syntax errors that pass initial validation but fail later.',
        evidence: [
          `Runs with syntax errors: ${syntaxErrors.length}`,
          `Percentage: ${((syntaxErrors.length / runs.length) * 100).toFixed(1)}%`,
        ],
        suggestedAction: 'Enhance syntax validation to catch errors earlier',
        estimatedImpact: 'Could catch syntax errors before code generation',
      });
    }

    return suggestions;
  }

  /**
   * Suggest context provider improvements
   */
  async suggestContextImprovements(observations: Observation[], metrics: MetricsData): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const runs = metrics.runs;

    // Check for token spikes
    const tokenSpikes = observations.filter(obs => obs.type === 'token-spike');
    if (tokenSpikes.length > 0) {
      suggestions.push({
        id: 'context-optimize-size',
        priority: 'medium',
        category: 'context',
        title: 'Optimize context size to reduce token usage',
        description: 'Token usage spikes indicate context may be too large or include unnecessary files.',
        evidence: tokenSpikes.map(obs => obs.description),
        suggestedAction: 'Review CodeContextProvider to optimize file selection and truncation logic',
        estimatedImpact: 'Could reduce token usage by 20-30%',
      });
    }

    // Check for missing context issues
    const missingContextErrors = runs.filter(r =>
      r.outcome?.errorCategory?.toLowerCase().includes('not found') ||
      r.outcome?.errorCategory?.toLowerCase().includes('cannot find')
    );

    if (missingContextErrors.length > runs.length * 0.15) {
      suggestions.push({
        id: 'context-missing-files',
        priority: 'medium',
        category: 'context',
        title: 'Improve file discovery for context',
        description: 'Many errors suggest missing imports or files not included in context.',
        evidence: [
          `Runs with missing context errors: ${missingContextErrors.length}`,
          `Percentage: ${((missingContextErrors.length / runs.length) * 100).toFixed(1)}%`,
        ],
        suggestedAction: 'Enhance CodeContextProvider to better discover and include related files',
        estimatedImpact: 'Could reduce missing reference errors by 50%',
      });
    }

    return suggestions;
  }

  /**
   * Suggest prompt improvements
   */
  async suggestPromptImprovements(observations: Observation[], metrics: MetricsData): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const runs = metrics.runs;

    // Check for efficiency issues
    const efficiencyIssues = observations.filter(obs => obs.type === 'efficiency-issue');
    if (efficiencyIssues.length > 0) {
      const avgIterations = runs
        .filter(r => r.status === 'completed')
        .map(r => r.efficiency?.iterationsToSuccess || 1)
        .reduce((a, b) => a + b, 0) / runs.filter(r => r.status === 'completed').length;

      if (avgIterations > 1.5) {
        suggestions.push({
          id: 'prompt-improve-quality',
          priority: 'medium',
          category: 'prompt',
          title: 'Improve prompt quality to reduce iterations',
          description: `Tasks require ${avgIterations.toFixed(1)} average iterations to succeed, suggesting prompts could be more effective.`,
          evidence: [
            `Average iterations: ${avgIterations.toFixed(1)}`,
            ...efficiencyIssues.map(obs => obs.description),
          ],
          suggestedAction: 'Review and enhance prompt templates with better examples and clearer instructions',
          estimatedImpact: 'Could reduce iterations by 30-40%',
        });
      }
    }

    // Check for repeated patterns that suggest prompt issues
    const repeatedPatterns = observations.filter(obs =>
      obs.type === 'failure-pattern' && obs.occurrences >= 5
    );

    if (repeatedPatterns.length > 3) {
      suggestions.push({
        id: 'prompt-add-guidance',
        priority: 'low',
        category: 'prompt',
        title: 'Add specific guidance for common failure patterns',
        description: 'Multiple repeated failure patterns suggest prompts need more specific guidance.',
        evidence: [
          `Repeated patterns: ${repeatedPatterns.length}`,
          ...repeatedPatterns.slice(0, 3).map(obs => `${obs.description} (${obs.occurrences} times)`),
        ],
        suggestedAction: 'Add explicit guidance in prompts to prevent these common patterns',
        estimatedImpact: 'Could prevent multiple failure types',
      });
    }

    return suggestions;
  }
}
