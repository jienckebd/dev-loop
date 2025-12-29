import * as fs from 'fs-extra';
import * as path from 'path';
import { MetricsData, RunMetrics } from './debug-metrics';

export interface Observation {
  id: string;
  type: 'failure-pattern' | 'efficiency-issue' | 'validation-trend' | 'token-spike';
  severity: 'low' | 'medium' | 'high';
  description: string;
  occurrences: number;
  affectedProjects: string[];
  firstSeen: string;
  lastSeen: string;
  suggestedImprovements: string[];
  evidence?: string[]; // Metrics/observations supporting this observation
}

interface ObservationData {
  version: string;
  observations: Observation[];
}

export class ObservationTracker {
  private observationsPath: string;
  private observations: ObservationData;
  private debug: boolean;

  constructor(observationsPath: string = '.devloop/observations.json', debug: boolean = false) {
    this.observationsPath = path.resolve(process.cwd(), observationsPath);
    this.debug = debug;
    this.observations = this.loadObservations();
  }

  private loadObservations(): ObservationData {
    try {
      if (fs.existsSync(this.observationsPath)) {
        const content = fs.readFileSync(this.observationsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`[ObservationTracker] Failed to load observations: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      version: '1.0',
      observations: [],
    };
  }

  private saveObservations(): void {
    try {
      const dir = path.dirname(this.observationsPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.observationsPath, JSON.stringify(this.observations, null, 2), 'utf-8');
    } catch (error) {
      if (this.debug) {
        console.error(`[ObservationTracker] Failed to save observations: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Analyze metrics to detect trends and patterns
   */
  async analyzeMetrics(metrics: MetricsData): Promise<Observation[]> {
    const observations: Observation[] = [];
    const runs = metrics.runs;

    if (runs.length === 0) {
      return observations;
    }

    // Analyze validation failures trend
    const recentRuns = runs.slice(-20); // Last 20 runs
    const validationFailures = recentRuns.filter(r =>
      r.validation?.preValidationPassed === false
    ).length;
    const olderRuns = runs.slice(-40, -20);
    const olderValidationFailures = olderRuns.filter(r =>
      r.validation?.preValidationPassed === false
    ).length;

    if (recentRuns.length >= 10 && olderRuns.length >= 10) {
      const recentRate = validationFailures / recentRuns.length;
      const olderRate = olderValidationFailures / olderRuns.length;
      const increase = ((recentRate - olderRate) / (olderRate || 0.01)) * 100;

      if (increase > 50) {
        observations.push({
          id: `validation-trend-${Date.now()}`,
          type: 'validation-trend',
          severity: increase > 100 ? 'high' : 'medium',
          description: `Validation failures increased ${increase.toFixed(0)}% in last ${recentRuns.length} runs`,
          occurrences: validationFailures,
          affectedProjects: this.getUniqueProjectTypes(recentRuns),
          firstSeen: olderRuns[0]?.timestamp || new Date().toISOString(),
          lastSeen: recentRuns[recentRuns.length - 1]?.timestamp || new Date().toISOString(),
          suggestedImprovements: [
            'Review ValidationGate checks for common failure patterns',
            'Add more specific validation rules based on error categories',
            'Improve patch search string validation',
          ],
          evidence: [
            `Recent validation failure rate: ${(recentRate * 100).toFixed(1)}%`,
            `Previous validation failure rate: ${(olderRate * 100).toFixed(1)}%`,
          ],
        });
      }
    }

    // Analyze token usage spikes
    const avgTokens = this.average(recentRuns.map(r => (r.tokens?.input || 0) + (r.tokens?.output || 0)));
    const highTokenRuns = recentRuns.filter(r => {
      const total = (r.tokens?.input || 0) + (r.tokens?.output || 0);
      return total > avgTokens * 1.5;
    });

    if (highTokenRuns.length > recentRuns.length * 0.3) {
      observations.push({
        id: `token-spike-${Date.now()}`,
        type: 'token-spike',
        severity: 'medium',
        description: `${highTokenRuns.length} of ${recentRuns.length} recent runs used >150% of average tokens`,
        occurrences: highTokenRuns.length,
        affectedProjects: this.getUniqueProjectTypes(highTokenRuns),
        firstSeen: highTokenRuns[0]?.timestamp || new Date().toISOString(),
        lastSeen: highTokenRuns[highTokenRuns.length - 1]?.timestamp || new Date().toISOString(),
        suggestedImprovements: [
          'Optimize CodeContextProvider to reduce context size',
          'Review file inclusion logic to avoid unnecessary files',
          'Consider truncating large files instead of including full content',
        ],
        evidence: [
          `Average tokens per run: ${avgTokens.toFixed(0)}`,
          `High token runs: ${highTokenRuns.length}`,
        ],
      });
    }

    // Analyze efficiency issues
    const successfulRuns = recentRuns.filter(r => r.status === 'completed');
    if (successfulRuns.length > 0) {
      const avgIterations = this.average(
        successfulRuns.map(r => r.outcome?.retryCount || 0).filter(c => c > 0)
      );
      const highIterationRuns = successfulRuns.filter(r => (r.outcome?.retryCount || 0) > 2);

      if (highIterationRuns.length > successfulRuns.length * 0.2 && avgIterations > 1.5) {
        observations.push({
          id: `efficiency-issue-${Date.now()}`,
          type: 'efficiency-issue',
          severity: 'medium',
          description: `Tasks require ${avgIterations.toFixed(1)} average iterations to succeed`,
          occurrences: highIterationRuns.length,
          affectedProjects: this.getUniqueProjectTypes(highIterationRuns),
          firstSeen: highIterationRuns[0]?.timestamp || new Date().toISOString(),
          lastSeen: highIterationRuns[highIterationRuns.length - 1]?.timestamp || new Date().toISOString(),
          suggestedImprovements: [
            'Improve initial code generation quality',
            'Enhance pattern learning to prevent common mistakes',
            'Add better context to reduce retries',
          ],
          evidence: [
            `Average iterations to success: ${avgIterations.toFixed(1)}`,
            `Runs requiring >2 iterations: ${highIterationRuns.length}`,
          ],
        });
      }
    }

    return observations;
  }

  /**
   * Track a failure pattern with project context
   */
  async trackFailurePattern(errorText: string, projectType: string): Promise<void> {
    const errorSignature = this.extractErrorSignature(errorText);

    // Check if similar observation exists
    const existing = this.observations.observations.find(obs =>
      obs.type === 'failure-pattern' &&
      obs.description.toLowerCase().includes(errorSignature.toLowerCase())
    );

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = new Date().toISOString();
      if (!existing.affectedProjects.includes(projectType)) {
        existing.affectedProjects.push(projectType);
      }
      this.saveObservations();
      return;
    }

    // Create new observation
    const observation: Observation = {
      id: `failure-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'failure-pattern',
      severity: this.assessSeverity(errorText),
      description: errorSignature,
      occurrences: 1,
      affectedProjects: [projectType],
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      suggestedImprovements: this.suggestImprovementsForError(errorText),
      evidence: [errorText.substring(0, 200)],
    };

    this.observations.observations.push(observation);
    this.saveObservations();
  }

  /**
   * Get observations, optionally filtered by project type
   */
  async getObservations(projectType?: string): Promise<Observation[]> {
    let observations = this.observations.observations;

    if (projectType) {
      observations = observations.filter(obs =>
        obs.affectedProjects.includes(projectType)
      );
    }

    // Sort by severity and recency
    return observations.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    });
  }

  /**
   * Generate improvement suggestions based on observations
   */
  async suggestImprovements(): Promise<string[]> {
    const observations = await this.getObservations();
    const suggestions = new Set<string>();

    observations.forEach(obs => {
      obs.suggestedImprovements.forEach(suggestion => {
        suggestions.add(suggestion);
      });
    });

    return Array.from(suggestions);
  }

  private getUniqueProjectTypes(runs: RunMetrics[]): string[] {
    const types = new Set<string>();
    runs.forEach(run => {
      if (run.projectMetadata?.projectType) {
        types.add(run.projectMetadata.projectType);
      }
    });
    return Array.from(types);
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private extractErrorSignature(errorText: string): string {
    // Extract a short signature from error text
    const lines = errorText.split('\n').filter(l => l.trim());
    if (lines.length === 0) return errorText.substring(0, 100);

    // Try to find the main error line
    const errorLine = lines.find(l =>
      l.toLowerCase().includes('error') ||
      l.toLowerCase().includes('failed') ||
      l.toLowerCase().includes('exception')
    ) || lines[0];

    return errorLine.substring(0, 150);
  }

  private assessSeverity(errorText: string): 'low' | 'medium' | 'high' {
    const lower = errorText.toLowerCase();

    if (lower.includes('fatal') || lower.includes('crash') || lower.includes('timeout')) {
      return 'high';
    }

    if (lower.includes('error') || lower.includes('exception') || lower.includes('failed')) {
      return 'medium';
    }

    return 'low';
  }

  private suggestImprovementsForError(errorText: string): string[] {
    const lower = errorText.toLowerCase();
    const suggestions: string[] = [];

    if (lower.includes('not found') || lower.includes('cannot find')) {
      suggestions.push('Add pattern to PatternLearningSystem for missing references');
      suggestions.push('Improve CodeContextProvider to include all necessary imports');
    }

    if (lower.includes('syntax') || lower.includes('parse')) {
      suggestions.push('Enhance ValidationGate syntax validation');
      suggestions.push('Add pre-validation checks for common syntax errors');
    }

    if (lower.includes('patch') || lower.includes('search string')) {
      suggestions.push('Improve patch search string matching logic');
      suggestions.push('Add guidance for exact whitespace matching in patterns');
    }

    if (lower.includes('test') && lower.includes('fail')) {
      suggestions.push('Review test execution patterns');
      suggestions.push('Add better error context to test failures');
    }

    if (suggestions.length === 0) {
      suggestions.push('Review error pattern and add to PatternLearningSystem');
      suggestions.push('Consider adding validation to prevent this error');
    }

    return suggestions;
  }
}
