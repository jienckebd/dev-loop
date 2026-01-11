/**
 * PRD Draft Generator
 *
 * Generates initial PRD draft from collected answers.
 * Uses AI to synthesize answers into a structured PRD document.
 */

import { parse as yamlParse } from 'yaml';
import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { ConversationManager } from '../../conversation/conversation-manager';
import { Conversation } from '../../conversation/types';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureType } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { TextGenerationAdapter } from '../refinement/text-generation-adapter';
import { logger } from '../../utils/logger';

/**
 * PRD Draft Generation Result
 */
export interface PrdDraftGenerationResult {
  prd: ParsedPlanningDoc;
  summary: string;
  confidence: number; // 0-1
}

/**
 * PRD Draft Generator Configuration
 */
export interface PrdDraftGeneratorConfig {
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  codebaseAnalysis: CodebaseAnalysisResult;
  promptSelector: PromptSelector;
  conversationManager?: ConversationManager;
  debug?: boolean;
}

/**
 * Generates initial PRD draft from collected answers
 */
export class PrdDraftGenerator {
  private config: PrdDraftGeneratorConfig;
  private textGenerator: TextGenerationAdapter;
  private debug: boolean;

  constructor(config: PrdDraftGeneratorConfig) {
    this.config = config;
    this.debug = config.debug || false;
    this.textGenerator = new TextGenerationAdapter(
      config.aiProvider,
      config.aiProviderConfig,
      this.debug
    );
  }

  /**
   * Generate PRD draft from conversation answers
   */
  async generatePrdDraft(
    conversationId: string,
    initialPrompt: string,
    context?: {
      iteration?: number;
    }
  ): Promise<PrdDraftGenerationResult> {
    logger.debug(`[PrdDraftGenerator] Generating PRD draft from conversation ${conversationId}`);

    // Get conversation context
    const conversation = this.config.conversationManager
      ? await this.config.conversationManager.getConversation(conversationId)
      : null;

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Get appropriate prompt
    const prompt = await this.config.promptSelector.getPromptForUseCase('prd-draft-generation', {
      mode: 'create',
      framework: this.config.codebaseAnalysis.framework,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    });

    // Build prompt for PRD draft generation
    const aiPrompt = this.buildPrdDraftPrompt(initialPrompt, conversation, prompt);

    try {
      const response = await this.textGenerator.generate(aiPrompt, {
        maxTokens: 8000,
        temperature: 0.5,
        systemPrompt: 'You are an expert at generating comprehensive PRD documents from collected requirements and answers.',
      });

      // Parse AI response to extract PRD draft
      const prd = this.parsePrdDraftResponse(response, conversation, initialPrompt);

      // Calculate confidence (based on number of answers and completeness)
      const confidence = this.calculateConfidence(conversation, prd);

      // Generate summary
      const summary = this.generateSummary(prd, conversation, confidence);

      return {
        prd,
        summary,
        confidence,
      };
    } catch (error) {
      logger.error(`[PrdDraftGenerator] Failed to generate PRD draft: ${error}`);
      throw error;
    }
  }

  /**
   * Build prompt for PRD draft generation
   */
  private buildPrdDraftPrompt(
    initialPrompt: string,
    conversation: Conversation,
    basePrompt: string
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');

    parts.push('## User Initial Prompt');
    parts.push(initialPrompt);
    parts.push('');

    parts.push('## Collected Answers');
    for (const [questionId, answer] of conversation.context.collectedAnswers.entries()) {
      const question = conversation.items.find(item => item.question.id === questionId)?.question;
      if (question && answer) {
        parts.push(`Q: ${question.text}`);
        parts.push(`A: ${typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value)}`);
        parts.push('');
      }
    }

    // Framework context
    if (this.config.codebaseAnalysis.frameworkPlugin) {
      parts.push('## Framework');
      parts.push(`Framework: ${this.config.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push(`Description: ${this.config.codebaseAnalysis.frameworkPlugin.description}`);
      parts.push('');
    }

    // Feature types context
    if (this.config.codebaseAnalysis.featureTypes && this.config.codebaseAnalysis.featureTypes.length > 0) {
      parts.push('## Detected Feature Types');
      parts.push(this.config.codebaseAnalysis.featureTypes.join(', '));
      parts.push('');
    }

    // Codebase context (limited)
    if (this.config.codebaseAnalysis.codebaseContext) {
      parts.push('## Codebase Context (Summary)');
      parts.push(this.config.codebaseAnalysis.codebaseContext.substring(0, 1500)); // Limit context size
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Generate a comprehensive PRD draft based on the initial prompt and collected answers above.');
    parts.push('The PRD should include:');
    parts.push('- PRD ID, version, status, title, description');
    parts.push('- Multiple phases (at least 3-5 phases)');
    parts.push('- Tasks for each phase with descriptions');
    parts.push('- Testing configuration (directory, runner, command)');
    parts.push('- Config overlay if needed (framework-specific config)');
    parts.push('- Dependencies (external modules, PRD dependencies, code requirements)');
    parts.push('');
    parts.push('Return the PRD in YAML frontmatter format (ParsedPlanningDoc structure).');
    parts.push('Use the framework-specific patterns and conventions.');

    return parts.join('\n');
  }

  /**
   * Parse AI response to extract PRD draft
   */
  private parsePrdDraftResponse(
    response: string,
    conversation: Conversation,
    initialPrompt: string
  ): ParsedPlanningDoc {
    // Try to parse YAML frontmatter
    try {
      const yamlMatch = response.match(/```(?:yaml|yml)?\n([\s\S]*?)\n```/);
      if (yamlMatch) {
        const parsed = yamlParse(yamlMatch[1]);
        // Convert to ParsedPlanningDoc structure
        return this.convertToParsedPlanningDoc(parsed, initialPrompt);
      }

      // Try to extract frontmatter from response
      const frontmatterMatch = response.match(/^---\n([\s\S]*?)\n---\n/);
      if (frontmatterMatch) {
        const parsed = yamlParse(frontmatterMatch[1]);
        return this.convertToParsedPlanningDoc(parsed, initialPrompt);
      }

      // Try parsing entire response as YAML
      const parsed = yamlParse(response);
      if (parsed && (parsed.prd || parsed.phases)) {
        return this.convertToParsedPlanningDoc(parsed, initialPrompt);
      }
    } catch (error) {
      logger.warn(`[PrdDraftGenerator] Failed to parse YAML: ${error}`);
    }

    // Fallback: generate basic PRD structure from answers
    return this.generateBasicPrdFromAnswers(conversation, initialPrompt);
  }

  /**
   * Convert parsed YAML to ParsedPlanningDoc
   */
  private convertToParsedPlanningDoc(parsed: any, initialPrompt: string): ParsedPlanningDoc {
    const prd: ParsedPlanningDoc = {
      prdId: parsed.prd?.id || parsed.prdId || this.generatePrdId(initialPrompt),
      version: parsed.prd?.version || parsed.version || '1.0.0',
      status: parsed.prd?.status || parsed.status || 'ready',
      title: parsed.title || parsed.prd?.title || this.extractTitle(initialPrompt),
      description: parsed.description || parsed.prd?.description || initialPrompt,
      phases: parsed.phases || parsed.requirements?.phases || [],
      configOverlay: parsed.config || parsed.configOverlay,
      testing: parsed.testing,
      dependencies: parsed.dependencies,
      rawContent: JSON.stringify(parsed, null, 2),
    };

    return prd;
  }

  /**
   * Generate basic PRD from answers (fallback)
   */
  private generateBasicPrdFromAnswers(
    conversation: Conversation,
    initialPrompt: string
  ): ParsedPlanningDoc {
    const prdId = this.generatePrdId(initialPrompt);
    const answers = Array.from(conversation.context.collectedAnswers.values());

    // Extract information from answers
    const goal = answers.find(a => a.questionId.includes('goal') || a.questionId.includes('purpose'));
    const requirements = answers.find(a => a.questionId.includes('requirement') || a.questionId.includes('functionality'));

    const prd: ParsedPlanningDoc = {
      prdId,
      version: '1.0.0',
      status: 'ready',
      title: this.extractTitle(initialPrompt),
      description:
        typeof goal?.value === 'string'
          ? goal.value
          : typeof requirements?.value === 'string'
          ? requirements.value
          : initialPrompt,
      phases: [
        {
          id: 1,
          name: 'Foundation',
          description: 'Initial setup and foundation',
          tasks: [],
        },
        {
          id: 2,
          name: 'Implementation',
          description: 'Core implementation',
          tasks: [],
        },
        {
          id: 3,
          name: 'Testing',
          description: 'Testing and validation',
          tasks: [],
        },
      ],
      testing: {
        directory: 'tests/playwright',
        runner: 'playwright',
        command: 'npx playwright test',
      },
      rawContent: JSON.stringify({ initialPrompt, answers: answers.length }, null, 2),
    };

    // Add tasks based on answers
    let taskId = 1;
    for (const answer of answers) {
      if (typeof answer.value === 'string' && answer.value.length > 10) {
        // Create a task from this answer
        const question = conversation.items.find(item => item.question.id === answer.questionId)?.question;
        if (question) {
          prd.phases[1].tasks = prd.phases[1].tasks || [];
          prd.phases[1].tasks.push({
            id: `TASK-${taskId++}`,
            title: question.text.substring(0, 50),
            description: (answer?.value as string) || '',
          });
        }
      }
    }

    return prd;
  }

  /**
   * Generate PRD ID from prompt
   */
  private generatePrdId(prompt: string): string {
    // Extract key words from prompt and create ID
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 3);
    return words.join('-') || 'prd-draft';
  }

  /**
   * Extract title from prompt
   */
  private extractTitle(prompt: string): string {
    // Use first sentence or first 50 characters as title
    const firstSentence = prompt.split(/[.!?]/)[0].trim();
    return firstSentence.length > 0 && firstSentence.length < 100
      ? firstSentence
      : prompt.substring(0, 50).trim() + (prompt.length > 50 ? '...' : '');
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(conversation: Conversation, prd: ParsedPlanningDoc): number {
    let score = 0;

    // Base score from number of answers
    const answerCount = conversation.context.collectedAnswers.size;
    score += Math.min(answerCount * 0.1, 0.5); // Up to 0.5 points

    // Score from PRD completeness
    if (prd.title && prd.title.length > 0) score += 0.1;
    if (prd.description && prd.description.length > 20) score += 0.1;
    if (prd.phases && prd.phases.length >= 3) score += 0.1;
    if (prd.testing) score += 0.1;
    if (prd.configOverlay) score += 0.1;

    // Score from task completeness
    const totalTasks = prd.phases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
    if (totalTasks >= 5) score += 0.1;
    if (totalTasks >= 10) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Generate summary
   */
  private generateSummary(prd: ParsedPlanningDoc, conversation: Conversation, confidence: number): string {
    const parts: string[] = [];

    parts.push(`PRD Draft Generated: ${prd.prdId}`);
    parts.push(`Confidence: ${Math.round(confidence * 100)}%`);
    parts.push('');
    parts.push(`Title: ${prd.title}`);
    parts.push(`Description: ${prd.description?.substring(0, 100)}${prd.description && prd.description.length > 100 ? '...' : ''}`);
    parts.push('');
    parts.push(`Phases: ${prd.phases.length}`);
    const totalTasks = prd.phases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
    parts.push(`Tasks: ${totalTasks}`);
    parts.push('');
    parts.push(`Answers Used: ${conversation.context.collectedAnswers.size}`);

    return parts.join('\n');
  }
}
