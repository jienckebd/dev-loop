/**
 * AI-Driven Ambiguity Analyzer
 *
 * Analyzes PRD content using AI to detect genuine ambiguities that require human input.
 * Uses full context from dev-loop: patterns, observations, constitution, codebase analysis.
 */

import { Question, ClarificationCategory } from '../../conversation/types';
import { ParsedPlanningDoc, ConstitutionRules } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { PatternEntry, ObservationEntry } from '../learning/types';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { logger } from '../../utils/logger';

export interface AmbiguityAnalyzerConfig {
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  patterns?: PatternEntry[];
  observations?: ObservationEntry[];
  debug?: boolean;
}

export interface DetectedAmbiguity {
  id: string;
  category: 'architecture' | 'integration' | 'performance' | 'security';
  question: string;
  options: string[];
  suggestedDefault: string;
  reasoning: string;
  confidence: number;
}

export class AmbiguityAnalyzer {
  private aiProvider: AIProvider;
  private aiProviderConfig: AIProviderConfig;
  private patterns: PatternEntry[];
  private observations: ObservationEntry[];
  private debug: boolean;

  constructor(config: AmbiguityAnalyzerConfig) {
    this.aiProvider = config.aiProvider;
    this.aiProviderConfig = config.aiProviderConfig;
    this.patterns = config.patterns || [];
    this.observations = config.observations || [];
    this.debug = config.debug || false;
  }

  /**
   * Analyze PRD for genuine ambiguities using AI with full context
   */
  async analyzeAmbiguities(
    parsedDoc: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    constitution?: ConstitutionRules
  ): Promise<Question[]> {
    const prompt = this.buildAnalysisPrompt(parsedDoc, codebaseAnalysis, constitution);

    try {
      logger.debug('[AmbiguityAnalyzer] Analyzing PRD for ambiguities with AI');

      // Check if AI provider supports text generation
      if (!this.aiProvider.generateText) {
        logger.warn('[AmbiguityAnalyzer] AI provider does not support generateText, skipping AI analysis');
        return [];
      }

      const response = await this.aiProvider.generateText(prompt, {
        maxTokens: 2000,
        temperature: 0.3, // Lower temperature for consistent analysis
      });

      const ambiguities = this.parseAIResponse(response);
      return this.convertToQuestions(ambiguities);
    } catch (error) {
      logger.warn(`[AmbiguityAnalyzer] AI analysis failed: ${error}`);
      return [];
    }
  }

  /**
   * Build comprehensive prompt with all available context
   */
  private buildAnalysisPrompt(
    parsedDoc: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    constitution?: ConstitutionRules
  ): string {
    // Build context sections
    const frameworkContext = this.buildFrameworkContext(codebaseAnalysis);
    const patternContext = this.buildPatternContext();
    const observationContext = this.buildObservationContext();
    const constitutionContext = this.buildConstitutionContext(constitution);

    return `You are a senior engineer reviewing a PRD (Product Requirements Document) to identify genuine architectural decisions that require human input.

## PRD Content
Title: ${parsedDoc.title}
${parsedDoc.rawContent || JSON.stringify(parsedDoc, null, 2)}

## Framework Context
${frameworkContext}

## Learned Patterns (from past PRD executions)
${patternContext}

## Observations (issues/successes from past executions)
${observationContext}

## Project Constitution (rules from .cursorrules)
${constitutionContext}

## Analysis Instructions

Act like a senior engineer doing a requirements review. REASON about what the PRD specifies vs what it leaves open.

DO NOT look for an "Open Questions" section. Instead, analyze the actual requirements and REASON about:

1. **Architecture decisions**: What technology choices are implied but not mandated?
   - Example: PRD mentions "queue processing" but doesn't specify Drupal Queue API vs Redis/RabbitMQ
   - Example: PRD mentions "storage" but doesn't specify database vs file system vs external service

2. **Integration decisions**: What external API patterns could work but aren't specified?
   - Example: PRD mentions "Slack webhook" but doesn't specify where credentials are stored
   - Example: PRD mentions "SMS service" but doesn't specify rate limiting strategy

3. **Performance decisions**: What optimization tradeoffs exist that the PRD doesn't address?
   - Example: PRD mentions "templates" but doesn't specify caching strategy
   - Example: PRD mentions "batch processing" but doesn't specify batch size limits

4. **Security decisions**: What data handling policies are relevant but not detailed?
   - Example: PRD mentions "notifications" with recipient data but doesn't specify logging policy
   - Example: PRD mentions "API keys" but doesn't specify encryption requirements

For each ambiguity you identify through reasoning:
- Explain WHY it's genuinely ambiguous (not just missing detail)
- Confirm it has multiple VALID approaches (not one obvious answer)
- Verify it would IMPACT the implementation significantly

## Output Format

Return a JSON array of detected ambiguities. Each must have:
- id: Unique identifier (kebab-case)
- category: One of architecture|integration|performance|security
- question: Clear question with tradeoffs noted
- options: Array of 2-4 STRING options (plain text, not objects)
- suggestedDefault: Which option string to suggest
- reasoning: Why this is ambiguous based on your analysis
- confidence: 0.3-0.6 (lower = more genuinely ambiguous)

If the PRD is fully explicit with no genuine ambiguities, return empty array [].

CRITICAL:
- Options must be plain strings like "Use Drupal Queue API (simpler, sufficient for most cases)"
- Do NOT return options as objects
- Do NOT ask about things already specified in the PRD
- Do NOT ask about framework conventions (covered by constitution)
- ONLY ask about genuine design decisions with multiple valid approaches

Return ONLY valid JSON, no markdown formatting.`;
  }

  /**
   * Build framework context from codebase analysis
   */
  private buildFrameworkContext(codebaseAnalysis: CodebaseAnalysisResult): string {
    const lines: string[] = [];

    lines.push(`Framework: ${codebaseAnalysis.framework || 'unknown'}`);

    if (codebaseAnalysis.frameworkPlugin) {
      lines.push(`Framework Plugin: ${codebaseAnalysis.frameworkPlugin.name}`);

      // Add code quality tools
      const tools = codebaseAnalysis.frameworkPlugin.getCodeQualityTools?.() || [];
      if (tools.length > 0) {
        lines.push(`Code Quality Tools: ${tools.map(t => t.name).join(', ')}`);
      }

      // Add tech debt indicators
      const debt = codebaseAnalysis.frameworkPlugin.getTechDebtIndicators?.() || [];
      if (debt.length > 0) {
        lines.push(`Tech Debt Patterns to Avoid: ${debt.map(d => d.description).slice(0, 3).join('; ')}`);
      }
    }

    if (codebaseAnalysis.schemaPatterns && codebaseAnalysis.schemaPatterns.length > 0) {
      lines.push(`Schema Patterns: ${codebaseAnalysis.schemaPatterns.map(p => p.type).join(', ')}`);
    }

    if (codebaseAnalysis.testPatterns && codebaseAnalysis.testPatterns.length > 0) {
      lines.push(`Test Framework: ${codebaseAnalysis.testPatterns[0].framework}`);
    }

    return lines.length > 1 ? lines.join('\n') : 'No framework context available.';
  }

  /**
   * Build context from learned patterns
   */
  private buildPatternContext(): string {
    if (this.patterns.length === 0) {
      return 'No learned patterns available.';
    }

    // Get most relevant patterns (by relevance score)
    const relevantPatterns = this.patterns
      .filter(p => p.relevanceScore >= 0.7)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5);

    if (relevantPatterns.length === 0) {
      return 'No high-relevance patterns available.';
    }

    return relevantPatterns.map(p =>
      `- [${p.category}] ${p.pattern.substring(0, 100)}${p.pattern.length > 100 ? '...' : ''}`
    ).join('\n');
  }

  /**
   * Build context from observations
   */
  private buildObservationContext(): string {
    if (this.observations.length === 0) {
      return 'No observations available.';
    }

    // Get most relevant observations
    const relevantObs = this.observations
      .filter(o => o.relevanceScore >= 0.7)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5);

    if (relevantObs.length === 0) {
      return 'No high-relevance observations available.';
    }

    return relevantObs.map(o =>
      `- [${o.category}] ${o.observation.substring(0, 100)}${o.observation.length > 100 ? '...' : ''}`
    ).join('\n');
  }

  /**
   * Build context from constitution rules
   */
  private buildConstitutionContext(constitution?: ConstitutionRules): string {
    if (!constitution) {
      return 'No constitution loaded.';
    }

    const lines: string[] = [];

    if (constitution.constraints && constitution.constraints.length > 0) {
      lines.push('Constraints:');
      lines.push(...constitution.constraints.slice(0, 5).map(c => `- ${c}`));
    }

    if (constitution.patterns && constitution.patterns.length > 0) {
      lines.push('Required Patterns:');
      lines.push(...constitution.patterns.slice(0, 3).map(p => `- ${p.pattern} (when: ${p.when})`));
    }

    if (constitution.avoid && constitution.avoid.length > 0) {
      lines.push('Patterns to Avoid:');
      lines.push(...constitution.avoid.slice(0, 3).map(a => `- ${a}`));
    }

    return lines.length > 0 ? lines.join('\n') : 'Constitution loaded but empty.';
  }

  /**
   * Parse AI response to structured ambiguities
   */
  private parseAIResponse(response: string): DetectedAmbiguity[] {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.debug('[AmbiguityAnalyzer] No JSON array found in AI response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return [];
      }

      // Validate and filter valid ambiguities
      return parsed.filter(a =>
        a.id &&
        a.category &&
        ['architecture', 'integration', 'performance', 'security'].includes(a.category) &&
        a.question &&
        Array.isArray(a.options) && a.options.length >= 2
      ).map(a => {
        // Normalize options to strings (AI may return objects with label/value)
        const normalizedOptions = a.options.map((opt: any) =>
          typeof opt === 'string' ? opt : (opt.label || opt.value || String(opt))
        );
        // Normalize suggestedDefault to string
        const normalizedDefault = typeof a.suggestedDefault === 'string'
          ? a.suggestedDefault
          : (a.suggestedDefault?.label || a.suggestedDefault?.value ||
             (typeof a.options[0] === 'string' ? a.options[0] : a.options[0]?.label || a.options[0]?.value));

        return {
          id: a.id,
          category: a.category,
          question: a.question,
          options: normalizedOptions,
          suggestedDefault: normalizedDefault,
          reasoning: a.reasoning || 'AI detected ambiguity',
          confidence: Math.max(0.3, Math.min(0.6, a.confidence || 0.5)),
        };
      });
    } catch (error) {
      logger.warn(`[AmbiguityAnalyzer] Failed to parse AI response: ${error}`);
      return [];
    }
  }

  /**
   * Convert detected ambiguities to Question objects
   */
  private convertToQuestions(ambiguities: DetectedAmbiguity[]): Question[] {
    return ambiguities.map(a => ({
      id: a.id,
      text: a.question,
      type: 'multiple-choice' as const,
      options: a.options,
      required: false,
      category: this.mapCategory(a.category),
      context: a.reasoning,
      confidence: a.confidence,
      inferredAnswer: a.suggestedDefault,
      inferenceSource: `AI suggestion based on ${a.category} best practices`,
    }));
  }

  /**
   * Map ambiguity category to ClarificationCategory
   */
  private mapCategory(category: string): ClarificationCategory {
    switch (category) {
      case 'architecture': return 'architecture';
      case 'integration': return 'integration';
      case 'performance': return 'implementation';
      case 'security': return 'implementation';
      default: return 'implementation';
    }
  }
}
