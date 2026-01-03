import { AIProviderManager } from './provider-manager';
import { PatternClusterer, AbstractionCandidate } from './pattern-clusterer';
import { FrameworkPlugin, AbstractionRecommendation } from '../frameworks/interface';
import { FRAMEWORK_PROMPTS } from './prompts';
import { FeedbackStore } from './feedback-store';
import { AnalysisContext } from './provider-interface';
import { logger } from '../core/logger';

export interface SemanticAnalysis {
  pattern: AbstractionCandidate;
  intent: string; // What the code is trying to do
  commonality: string; // What's common across occurrences
  variations: string[]; // How instances differ
  abstractionStrategy: {
    type: 'extract-method' | 'extract-class' | 'create-plugin' | 'config-schema' | 'entity-type' | 'field';
    parameters: string[]; // What should be parameterized
    name: string; // Suggested name
    example: string; // Example implementation
  };
  confidence: number;
  risk: 'low' | 'medium' | 'high';
}

export class SemanticAnalyzer {
  constructor(
    private providerManager: AIProviderManager,
    private patternClusterer: PatternClusterer,
    private feedbackStore?: FeedbackStore
  ) {}

  /**
   * Analyze code semantics beyond syntax
   */
  async analyzePattern(
    pattern: AbstractionCandidate,
    context: AnalysisContext
  ): Promise<SemanticAnalysis> {
    const provider = this.providerManager.selectOptimalProvider('analysis');
    const frameworkPrompts = context.framework ? FRAMEWORK_PROMPTS[context.framework] : null;

    // Build prompt with feedback context if available
    let feedbackContext = '';
    if (this.feedbackStore) {
      feedbackContext = this.feedbackStore.generateLearningContext();
    }

    const prompt = this.buildAnalysisPrompt(pattern, context, frameworkPrompts, feedbackContext);

    try {
      const result = await provider.analyze(prompt, context);

      // Parse the analysis result
      const analysis: SemanticAnalysis = {
        pattern,
        intent: this.extractIntent(result),
        commonality: this.extractCommonality(result),
        variations: this.extractVariations(result),
        abstractionStrategy: this.extractAbstractionStrategy(result, pattern),
        confidence: result.confidence,
        risk: this.assessRisk(pattern, result),
      };

      return analysis;
    } catch (error: any) {
      logger.error(`Error analyzing pattern: ${error.message}`);
      // Return fallback analysis
      return this.createFallbackAnalysis(pattern);
    }
  }

  /**
   * Generate abstraction recommendation from semantic analysis
   */
  async generateRecommendation(
    analysis: SemanticAnalysis,
    framework: FrameworkPlugin
  ): Promise<AbstractionRecommendation> {
    const pattern = analysis.pattern.cluster;
    const files = pattern.members.map(m => m.metadata.file);
    const locations = pattern.members.flatMap(m => ({
      file: m.metadata.file,
      startLine: m.metadata.startLine,
      endLine: m.metadata.endLine,
    }));

    // Calculate code reduction estimate
    const avgLines = pattern.members.reduce((sum, m) => {
      return sum + (m.metadata.endLine - m.metadata.startLine);
    }, 0) / pattern.members.length;
    const codeReduction = Math.round(avgLines * (pattern.members.length - 1));

    const recommendation: AbstractionRecommendation = {
      type: 'abstraction-pattern',
      trigger: `Detected ${pattern.members.length} similar patterns with ${(pattern.similarity * 100).toFixed(1)}% similarity`,
      suggestion: analysis.abstractionStrategy.name,
      evidence: [
        `Found in ${files.length} file(s)`,
        `Average similarity: ${(pattern.similarity * 100).toFixed(1)}%`,
        `Intent: ${analysis.intent}`,
        `Commonality: ${analysis.commonality}`,
      ],
      priority: analysis.confidence > 0.8 ? 'high' : analysis.confidence > 0.6 ? 'medium' : 'low',
      pattern: {
        id: pattern.id,
        type: this.determinePatternType(pattern),
        signature: this.generateSignature(pattern),
        files: Array.from(new Set(files)),
        locations,
        similarity: pattern.similarity,
        occurrences: pattern.members.length,
        suggestedAbstraction: analysis.pattern.suggestedAbstraction,
        suggestedName: analysis.abstractionStrategy.name,
        evidence: analysis.pattern.reasoning ? [analysis.pattern.reasoning] : [],
      },
      implementation: {
        type: this.mapStrategyToImplType(analysis.abstractionStrategy.type),
        name: analysis.abstractionStrategy.name,
        description: `${analysis.intent}. ${analysis.commonality}`,
        example: analysis.abstractionStrategy.example,
      },
      impact: {
        codeReduction,
        filesAffected: files.length,
        maintenanceBenefit: analysis.confidence > 0.8 ? 'high' : analysis.confidence > 0.6 ? 'medium' : 'low',
      },
    };

    return recommendation;
  }

  /**
   * Batch analysis for cost efficiency
   */
  async analyzeBatch(
    patterns: AbstractionCandidate[],
    context: AnalysisContext
  ): Promise<SemanticAnalysis[]> {
    const analyses: SemanticAnalysis[] = [];

    // Process in smaller batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < patterns.length; i += batchSize) {
      const batch = patterns.slice(i, i + batchSize);
      const batchAnalyses = await Promise.all(
        batch.map(pattern => this.analyzePattern(pattern, context))
      );
      analyses.push(...batchAnalyses);
    }

    return analyses;
  }

  private buildAnalysisPrompt(
    pattern: AbstractionCandidate,
    context: AnalysisContext,
    frameworkPrompts: any,
    feedbackContext: string
  ): string {
    let prompt = `Analyze this code pattern and suggest an abstraction strategy.\n\n`;

    if (frameworkPrompts) {
      prompt += `${frameworkPrompts.patternAnalysis}\n\n`;
    }

    prompt += `Pattern Details:
- Occurrences: ${pattern.cluster.members.length}
- Similarity: ${(pattern.cluster.similarity * 100).toFixed(1)}%
- Files: ${pattern.cluster.members.map(m => m.metadata.file).join(', ')}
- Suggested abstraction type: ${pattern.suggestedAbstraction}

Code samples:
${pattern.cluster.members.slice(0, 3).map((m, i) => `\nSample ${i + 1} (${m.metadata.file}:${m.metadata.startLine}-${m.metadata.endLine}):\n${m.content}`).join('\n\n')}`;

    if (feedbackContext) {
      prompt += `\n\nLearning from previous feedback:\n${feedbackContext}`;
    }

    if (frameworkPrompts) {
      prompt += `\n\n${frameworkPrompts.abstractionSuggestion}`;
    }

    prompt += `\n\nProvide analysis in JSON format:
{
  "intent": "What this code pattern is trying to accomplish",
  "commonality": "What is common across all occurrences",
  "variations": ["How instance 1 differs", "How instance 2 differs", ...],
  "abstractionStrategy": {
    "type": "extract-method" | "extract-class" | "create-plugin" | "config-schema" | "entity-type" | "field",
    "parameters": ["param1", "param2", ...],
    "name": "SuggestedName",
    "example": "Example code showing the abstraction"
  },
  "confidence": 0.0-1.0,
  "risk": "low" | "medium" | "high"
}`;

    return prompt;
  }

  private extractIntent(result: any): string {
    // Try to extract from recommendations or reasoning
    if (result.recommendations && result.recommendations.length > 0) {
      return result.recommendations[0].reasoning || 'Code pattern detected';
    }
    return result.reasoning || 'Code pattern detected';
  }

  private extractCommonality(result: any): string {
    // Parse from recommendations or reasoning
    if (result.recommendations && result.recommendations.length > 0) {
      return result.recommendations[0].suggestion || 'Similar structure and behavior';
    }
    return 'Similar structure and behavior';
  }

  private extractVariations(result: any): string[] {
    // Try to extract variations from patterns or recommendations
    if (result.patterns && result.patterns.length > 0) {
      return result.patterns.map((p: any) => p.description || 'Variation').slice(0, 3);
    }
    return ['Minor parameter differences', 'Slight structural variations'];
  }

  private extractAbstractionStrategy(result: any, pattern: AbstractionCandidate): SemanticAnalysis['abstractionStrategy'] {
    // Try to parse from recommendations
    if (result.recommendations && result.recommendations.length > 0) {
      const rec = result.recommendations[0];
      return {
        type: this.mapAbstractionType(pattern.suggestedAbstraction),
        parameters: ['config', 'options'], // Default, would be parsed from AI response
        name: this.generateName(pattern),
        example: rec.suggestion || this.generateExample(pattern),
      };
    }

    // Fallback
    return {
      type: this.mapAbstractionType(pattern.suggestedAbstraction),
      parameters: ['config', 'options'],
      name: this.generateName(pattern),
      example: this.generateExample(pattern),
    };
  }

  private mapAbstractionType(type: AbstractionCandidate['suggestedAbstraction']): SemanticAnalysis['abstractionStrategy']['type'] {
    switch (type) {
      case 'utility': return 'extract-method' as SemanticAnalysis['abstractionStrategy']['type'];
      case 'service': return 'extract-class' as SemanticAnalysis['abstractionStrategy']['type'];
      case 'plugin': return 'create-plugin' as SemanticAnalysis['abstractionStrategy']['type'];
      case 'config-schema': return 'config-schema' as SemanticAnalysis['abstractionStrategy']['type'];
      case 'base-class': return 'extract-class' as SemanticAnalysis['abstractionStrategy']['type'];
      case 'entity-type': return 'entity-type' as SemanticAnalysis['abstractionStrategy']['type'];
      case 'field': return 'field' as SemanticAnalysis['abstractionStrategy']['type'];
      default: return 'extract-method' as SemanticAnalysis['abstractionStrategy']['type'];
    }
  }

  private mapStrategyToImplType(strategyType: SemanticAnalysis['abstractionStrategy']['type']): 'plugin' | 'config-schema' | 'base-class' | 'service' | 'utility' | 'entity-type' | 'field' {
    switch (strategyType) {
      case 'extract-method': return 'utility';
      case 'extract-class': return 'base-class';
      case 'create-plugin': return 'plugin';
      case 'config-schema': return 'config-schema';
      case 'entity-type': return 'entity-type';
      case 'field': return 'field';
      default: return 'utility';
    }
  }

  private generateName(pattern: AbstractionCandidate): string {
    // Generate a name based on the pattern
    const firstMember = pattern.cluster.members[0];
    const fileName = firstMember.metadata.file.split('/').pop()?.replace(/\.[^.]+$/, '') || 'pattern';
    return `${fileName}${pattern.suggestedAbstraction === 'utility' ? 'Utility' : pattern.suggestedAbstraction === 'service' ? 'Service' : 'Pattern'}`;
  }

  private generateExample(pattern: AbstractionCandidate): string {
    // Generate a simple example
    return `// Abstracted ${pattern.suggestedAbstraction}\n// Example implementation would go here`;
  }

  private assessRisk(pattern: AbstractionCandidate, result: any): 'low' | 'medium' | 'high' {
    // Assess risk based on pattern characteristics
    if (pattern.cluster.members.length < 3) {
      return 'medium';
    }
    if (pattern.cluster.similarity < 0.7) {
      return 'high';
    }
    return 'low';
  }

  private createFallbackAnalysis(pattern: AbstractionCandidate): SemanticAnalysis {
    return {
      pattern,
      intent: 'Code pattern detected',
      commonality: 'Similar structure and behavior',
      variations: ['Minor differences'],
      abstractionStrategy: {
        type: this.mapAbstractionType(pattern.suggestedAbstraction),
        parameters: ['config'],
        name: this.generateName(pattern),
        example: this.generateExample(pattern),
      },
      confidence: pattern.confidence,
      risk: 'medium',
    };
  }

  private determinePatternType(cluster: any): 'code-block' | 'config-structure' | 'class-pattern' | 'function-pattern' | 'plugin-pattern' {
    const types = cluster.members.map((m: any) => m.metadata.type);
    if (types.every((t: string) => t === 'class')) {
      return 'class-pattern';
    }
    if (types.every((t: string) => t === 'function')) {
      return 'function-pattern';
    }
    if (types.every((t: string) => t === 'config')) {
      return 'config-structure';
    }
    return 'code-block';
  }

  private generateSignature(cluster: any): string {
    const firstMember = cluster.members[0];
    return `${firstMember.metadata.type}:${firstMember.metadata.file}:${firstMember.metadata.startLine}`;
  }
}
