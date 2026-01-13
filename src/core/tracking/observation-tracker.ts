import * as fs from 'fs-extra';
import * as path from 'path';
import { MetricsData, RunMetrics } from '../metrics/debug';

export interface Observation {
  id: string;
  type: 'failure-pattern' | 'efficiency-issue' | 'validation-trend' | 'token-spike' | 'json-parsing-failure';
  severity: 'low' | 'medium' | 'high';
  description: string;
  occurrences: number;
  affectedProjects: string[];
  affectedProviders?: string[]; // Track which AI providers have this issue
  firstSeen: string;
  lastSeen: string;
  suggestedImprovements: string[];
  evidence?: string[]; // Metrics/observations supporting this observation
  // Context properties for linking to dev-loop entities
  prdId?: string;
  prdSetId?: string;
  phaseId?: number;
  taskId?: string;
  // ObservationEntry compatibility fields
  createdAt?: string;
  relevanceScore?: number;
  expiresAt?: string | null;
  category?: string;
  observation?: string;
  context?: Record<string, any>;
  metadata?: Record<string, any>;
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
    const defaultData: ObservationData = {
      version: '1.0',
      observations: [],
    };

    try {
      if (fs.existsSync(this.observationsPath)) {
        const content = fs.readFileSync(this.observationsPath, 'utf-8');
        const parsed = JSON.parse(content);
        // Ensure observations array exists (file may contain {} or missing field)
        if (!parsed.observations || !Array.isArray(parsed.observations)) {
          parsed.observations = [];
        }
        return {
          version: parsed.version || defaultData.version,
          observations: parsed.observations,
        };
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`[ObservationTracker] Failed to load observations: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return defaultData;
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
    const now = new Date().toISOString();
    const observation: Observation = {
      id: `failure-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'failure-pattern',
      severity: this.assessSeverity(errorText),
      description: errorSignature,
      occurrences: 1,
      affectedProjects: [projectType],
      firstSeen: now,
      lastSeen: now,
      suggestedImprovements: this.suggestImprovementsForError(errorText),
      evidence: [errorText.substring(0, 200)],
      // Context properties for linking to dev-loop entities
      prdId: projectType,
      createdAt: now,
      relevanceScore: 1.0,
      category: 'failure-pattern',
      observation: errorSignature,
      context: { projectType },
      metadata: {},
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

  /**
   * Track a JSON parsing failure with provider context
   */
  async trackJsonParsingFailure(
    responseSample: string,
    extractionAttempts: string[],
    projectType: string,
    providerName: string,
    taskId?: string,
    prdId?: string,
    phaseId?: number
  ): Promise<void> {
    // Extract a signature from the response for grouping similar failures
    const signature = this.extractJsonFailureSignature(responseSample);
    const now = new Date().toISOString();

    // Check if similar observation exists (same signature + same provider)
    const existing = this.observations.observations.find(obs =>
      obs.type === 'json-parsing-failure' &&
      obs.description === signature &&
      obs.affectedProviders?.includes(providerName)
    );

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = now;
      if (!existing.affectedProjects.includes(projectType)) {
        existing.affectedProjects.push(projectType);
      }
      // Add task context to evidence if not already present
      if (taskId) {
        const taskEvidence = `Task: ${taskId}`;
        if (!existing.evidence?.includes(taskEvidence)) {
          existing.evidence = existing.evidence || [];
          existing.evidence.push(taskEvidence);
        }
      }
      this.saveObservations();

      if (this.debug) {
        console.log(`[ObservationTracker] Updated JSON parsing failure observation (occurrences: ${existing.occurrences})`);
      }
      return;
    }

    // Create new observation
    const evidence: string[] = [
      `Provider: ${providerName}`,
      `Response sample: ${responseSample.substring(0, 500)}${responseSample.length > 500 ? '...' : ''}`,
      `Attempted strategies: [${extractionAttempts.join(', ')}]`,
    ];

    if (taskId) evidence.push(`Task: ${taskId}`);
    if (prdId) evidence.push(`PRD: ${prdId}`);
    if (phaseId !== undefined) evidence.push(`Phase: ${phaseId}`);

    const observation: Observation = {
      id: `json-parsing-failure-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'json-parsing-failure',
      severity: this.assessJsonFailureSeverity(responseSample),
      description: signature,
      occurrences: 1,
      affectedProjects: [projectType],
      affectedProviders: [providerName],
      firstSeen: now,
      lastSeen: now,
      suggestedImprovements: this.suggestImprovementsForJsonFailure(responseSample, providerName),
      evidence,
      // Context properties for linking to dev-loop entities
      prdId: prdId || projectType,
      phaseId,
      taskId,
      createdAt: now,
      relevanceScore: 1.0,
      category: 'json-parsing',
      observation: signature,
      context: { provider: providerName, projectType },
      metadata: {},
    };

    this.observations.observations.push(observation);
    this.saveObservations();

    if (this.debug) {
      console.log(`[ObservationTracker] Tracked new JSON parsing failure from ${providerName}`);
    }
  }

  /**
   * Extract a signature from JSON failure response for grouping
   */
  private extractJsonFailureSignature(responseSample: string): string {
    // Try to identify the response format
    if (!responseSample || responseSample.trim().length === 0) {
      return 'Empty response';
    }

    // Check for common patterns
    if (responseSample.includes('"type":"result"')) {
      return 'Nested result object without extractable CodeChanges';
    }

    if (responseSample.includes('```json') || responseSample.includes('```')) {
      return 'JSON code block with malformed structure';
    }

    if (responseSample.includes('"files"') && !responseSample.includes('"summary"')) {
      return 'Files array present but missing summary';
    }

    if (responseSample.includes('No code changes') || responseSample.includes('no changes')) {
      return 'No-changes response without proper JSON format';
    }

    // Extract first 100 chars as signature
    const firstLine = responseSample.split('\n')[0]?.substring(0, 100) || 'Unknown format';
    return `Unrecognized format: ${firstLine}`;
  }

  /**
   * Assess severity of JSON parsing failure
   */
  private assessJsonFailureSeverity(responseSample: string): 'low' | 'medium' | 'high' {
    // Empty response is high severity
    if (!responseSample || responseSample.trim().length === 0) {
      return 'high';
    }

    // If response contains files array, it's medium (structure exists but extraction failed)
    if (responseSample.includes('"files"')) {
      return 'medium';
    }

    // If response mentions "complete" or "no changes", it's low (valid response, just not JSON)
    const lower = responseSample.toLowerCase();
    if (lower.includes('complete') || lower.includes('no changes') || lower.includes('already exists')) {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Suggest improvements for JSON parsing failures
   */
  private suggestImprovementsForJsonFailure(responseSample: string, providerName: string): string[] {
    const suggestions: string[] = [];

    if (!responseSample || responseSample.trim().length === 0) {
      suggestions.push('Investigate why provider returned empty response');
      suggestions.push('Add retry logic for empty responses');
    }

    if (responseSample.includes('"files"') && !responseSample.includes('"summary"')) {
      suggestions.push('Enhance prompt to require summary field in JSON output');
      suggestions.push('Add fallback to generate summary from files array');
    }

    if (responseSample.includes('```') && !responseSample.includes('```json')) {
      suggestions.push('Update prompt to require ```json language tag');
    }

    if (responseSample.includes('no changes') || responseSample.includes('complete')) {
      suggestions.push('Add pattern recognition for "no changes needed" responses');
    }

    suggestions.push(`Provider-specific: ${providerName}`);
    suggestions.push('Consider adding stricter JSON validation in prompts');

    return suggestions;
  }

  /**
   * Get JSON parsing failure rate (overall or per provider)
   */
  async getJsonParsingFailureRate(providerName?: string): Promise<number> {
    const jsonFailures = this.observations.observations.filter(obs => {
      if (obs.type !== 'json-parsing-failure') return false;
      if (providerName && !obs.affectedProviders?.includes(providerName)) return false;
      return true;
    });

    const totalOccurrences = jsonFailures.reduce((sum, obs) => sum + obs.occurrences, 0);
    // This is a simple count-based rate; for accurate rate, we'd need total attempts
    // For now, return as a normalized value based on observation count
    return totalOccurrences;
  }

  /**
   * Get common JSON parsing failure patterns
   */
  async getCommonJsonFailurePatterns(providerName?: string): Promise<Observation[]> {
    let observations = this.observations.observations.filter(obs =>
      obs.type === 'json-parsing-failure'
    );

    if (providerName) {
      observations = observations.filter(obs =>
        obs.affectedProviders?.includes(providerName)
      );
    }

    // Sort by occurrences (most common first)
    return observations.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Get JSON failure suggestions (provider-specific or universal)
   */
  async getJsonFailureSuggestions(providerName?: string): Promise<string[]> {
    const patterns = await this.getCommonJsonFailurePatterns(providerName);
    const suggestions = new Set<string>();

    patterns.forEach(obs => {
      obs.suggestedImprovements.forEach(suggestion => {
        suggestions.add(suggestion);
      });
    });

    return Array.from(suggestions);
  }

  /**
   * Compare JSON parsing success rates across providers
   */
  async getProviderComparison(): Promise<Record<string, { occurrences: number; patterns: number }>> {
    const comparison: Record<string, { occurrences: number; patterns: number }> = {};

    const jsonFailures = this.observations.observations.filter(obs =>
      obs.type === 'json-parsing-failure'
    );

    for (const obs of jsonFailures) {
      if (!obs.affectedProviders) continue;
      for (const provider of obs.affectedProviders) {
        if (!comparison[provider]) {
          comparison[provider] = { occurrences: 0, patterns: 0 };
        }
        comparison[provider].occurrences += obs.occurrences;
        comparison[provider].patterns++;
      }
    }

    return comparison;
  }

  /**
   * Get failures unique to a specific provider
   */
  async getProviderSpecificFailures(providerName: string): Promise<Observation[]> {
    return this.observations.observations.filter(obs =>
      obs.type === 'json-parsing-failure' &&
      obs.affectedProviders?.length === 1 &&
      obs.affectedProviders[0] === providerName
    );
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
