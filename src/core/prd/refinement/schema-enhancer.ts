/**
 * Schema Enhancer
 *
 * Generates schema definitions from codebase patterns.
 * Analyzes existing schemas and generates new schema definitions for PRD requirements.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ParsedPlanningDoc, ParsedPhase, ParsedTask } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureType } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../prompts/prompt-selector';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { TextGenerationAdapter } from './text-generation-adapter';
import { CodebaseInsight } from './codebase-insight-extractor';
import { CodeContextProvider, FileContext } from '../../analysis/code/context-provider';
import { logger } from '../../utils/logger';

/**
 * Schema Enhancement Result
 */
export interface SchemaEnhancementResult {
  schemas: SchemaDefinition[];
  summary: string;
  confidence: number; // 0-1
}

/**
 * Schema Definition
 */
export interface SchemaDefinition {
  id: string; // e.g., "my_module.schema.yml"
  type: 'config-schema' | 'entity-type' | 'plugin-type' | 'field-type';
  path: string; // Relative path where schema should be created
  content: string; // Schema definition content (YAML or other format)
  description: string;
  framework?: string;
  featureTypes?: FeatureType[];
  relatedSchemas?: string[]; // References to related schema files
}

/**
 * Schema Enhancer Configuration
 */
export interface SchemaEnhancerConfig {
  projectRoot: string;
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  codebaseAnalysis: CodebaseAnalysisResult;
  promptSelector: PromptSelector;
  debug?: boolean;
}

/**
 * Enhances PRD with schema definitions based on codebase patterns
 */
export class SchemaEnhancer {
  private config: SchemaEnhancerConfig;
  private textGenerator: TextGenerationAdapter;
  private contextProvider: CodeContextProvider;
  private debug: boolean;

  constructor(config: SchemaEnhancerConfig) {
    this.config = config;
    this.debug = config.debug || false;
    this.textGenerator = new TextGenerationAdapter(
      config.aiProvider,
      config.aiProviderConfig,
      this.debug
    );
    this.contextProvider = new CodeContextProvider(this.debug);
  }

  /**
   * Enhance PRD with schema definitions
   */
  async enhanceSchemas(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<SchemaEnhancementResult> {
    logger.debug(`[SchemaEnhancer] Enhancing PRD ${prd.prdId} with schema definitions`);

    // 1. Analyze PRD requirements to identify schema needs
    const schemaNeeds = this.analyzeSchemaNeeds(prd);

    // 2. Match with existing codebase patterns
    const matchedPatterns = this.matchWithCodebasePatterns(
      schemaNeeds,
      this.config.codebaseAnalysis
    );

    // 3. Generate schema definitions using AI
    const schemas = await this.generateSchemaDefinitions(
      schemaNeeds,
      matchedPatterns,
      context
    );

    // 4. Calculate confidence and generate summary
    const confidence = this.calculateConfidence(schemas, matchedPatterns);
    const summary = this.generateSummary(schemas, schemaNeeds);

    return {
      schemas,
      summary,
      confidence,
    };
  }

  /**
   * Enhance schemas with context from user answers
   */
  async enhanceSchemasWithContext(
    prd: ParsedPlanningDoc,
    answers: Map<string, any>,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[] = [],
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<SchemaEnhancementResult> {
    logger.debug(`[SchemaEnhancer] Enhancing PRD ${prd.prdId} with context from answers`);

    // Extract file contexts for schema files
    const schemaFileContexts: Map<string, FileContext> = new Map();
    const schemaFiles = codebaseAnalysis.relevantFiles.filter(f =>
      f.includes('schema') && (f.endsWith('.yml') || f.endsWith('.yaml')) || f.includes('entity_type')
    );

    for (const schemaFile of schemaFiles.slice(0, 10)) { // Limit to 10 files to avoid performance issues
      try {
        const fileContext = await this.contextProvider.getFileContext(schemaFile);
        if (fileContext) {
          schemaFileContexts.set(schemaFile, fileContext);
        }
      } catch (error) {
        logger.debug(`[SchemaEnhancer] Failed to extract context from ${schemaFile}: ${error}`);
      }
    }

    // Extract schema patterns from file contexts
    const extractedSchemaPatterns: Array<{ pattern: string; file: string; examples: string[] }> = [];
    for (const [filePath, fileContext] of schemaFileContexts.entries()) {
      if (fileContext.skeleton) {
        extractedSchemaPatterns.push({
          pattern: path.basename(filePath),
          file: filePath,
          examples: [fileContext.skeleton.substring(0, 300)],
        });
      }
    }

    logger.debug(`[SchemaEnhancer] Extracted ${extractedSchemaPatterns.length} schema pattern(s) from ${schemaFileContexts.size} schema file(s)`);

    // Use answers to guide schema generation
    const schemaNeeds = this.analyzeSchemaNeeds(prd);

    // Filter schema needs based on answers
    if (answers.has('schema-entity-types') || answers.has('schema-priority')) {
      const selectedTypes = answers.get('schema-entity-types') || answers.get('schema-priority');
      if (Array.isArray(selectedTypes)) {
        // Filter to only selected entity types
        // This would require more sophisticated parsing, but for now we'll use all
        logger.debug(`[SchemaEnhancer] Focusing on selected entity types: ${selectedTypes.join(', ')}`);
      }
    }

    // Use pattern preference from answers
    let usePatterns = true;
    if (answers.has('schema-pattern-follow')) {
      const patternChoice = answers.get('schema-pattern-follow');
      usePatterns = patternChoice && typeof patternChoice === 'string' && patternChoice.includes('use');
    }

    // Match with codebase patterns if user wants to use them
    const matchedPatterns = usePatterns
      ? this.matchWithCodebasePatterns(schemaNeeds, codebaseAnalysis)
      : new Map<string, any>();

    // Apply insight preferences
    const insightPreferences = Array.from(answers.entries())
      .filter(([key]) => key.startsWith('insight-'))
      .map(([key, value]) => ({ insightId: key.replace('insight-', ''), preference: value }));

    // Generate schema definitions using AI with context (including extracted schema patterns)
    const schemas = await this.generateSchemaDefinitionsWithContext(
      schemaNeeds,
      matchedPatterns,
      insights,
      insightPreferences,
      context,
      {
        schemaPatterns: extractedSchemaPatterns,
        fileContexts: schemaFileContexts,
      }
    );

    // Calculate confidence and generate summary
    const confidence = this.calculateConfidence(schemas, matchedPatterns);
    const summary = this.generateSummary(schemas, schemaNeeds);

    return {
      schemas,
      summary,
      confidence,
    };
  }

  /**
   * Refine specific schemas
   */
  async refineSpecificSchemas(
    schemas: SchemaEnhancementResult,
    refineIds: string[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<SchemaEnhancementResult> {
    logger.debug(`[SchemaEnhancer] Refining ${refineIds.length} specific schema(s): ${refineIds.join(', ')}`);

    const refinedSchemas: SchemaDefinition[] = [];
    const schemasToRefine = schemas.schemas.filter(s => refineIds.includes(s.id) || refineIds.some(id => s.id.includes(id)));

    for (const schema of schemasToRefine) {
      try {
        // Find related patterns in codebase
        const relatedPatterns = this.findRelatedPatterns(schema, codebaseAnalysis);

        // Refine schema using patterns
        const refined = await this.refineSchemaWithPatterns(schema, relatedPatterns, codebaseAnalysis);
        refinedSchemas.push(refined);
      } catch (error) {
        logger.warn(`[SchemaEnhancer] Failed to refine schema ${schema.id}: ${error}`);
        refinedSchemas.push(schema); // Keep original if refinement fails
      }
    }

    // Keep schemas that weren't refined
    const unchangedSchemas = schemas.schemas.filter(s => !schemasToRefine.includes(s));
    const allSchemas = [...unchangedSchemas, ...refinedSchemas];

    // Recalculate confidence using matched patterns
    const matchedPatterns = new Map<string, any>();
    for (const schema of allSchemas) {
      const patterns = this.findRelatedPatterns(schema, codebaseAnalysis);
      if (patterns.length > 0) {
        matchedPatterns.set(schema.id, { pattern: patterns[0], similarity: 0.9 });
      }
    }

    const confidence = this.calculateConfidence(allSchemas, matchedPatterns);

    return {
      schemas: allSchemas,
      summary: `Refined ${refinedSchemas.length} schema(s): ${refinedSchemas.map(s => s.id).join(', ')}`,
      confidence: Math.max(confidence, schemas.confidence), // Don't decrease confidence
    };
  }

  /**
   * Generate schema definitions with context from insights and preferences
   */
  private async generateSchemaDefinitionsWithContext(
    schemaNeeds: Array<{ type: string; requirement: string; task: any; phase: any }>,
    matchedPatterns: Map<string, any>,
    insights: CodebaseInsight[],
    insightPreferences: Array<{ insightId: string; preference: any }>,
    context?: { conversationId?: string; iteration?: number },
    schemaContext?: {
      schemaPatterns?: Array<{ pattern: string; file: string; examples: string[] }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): Promise<SchemaDefinition[]> {
    // Apply insight preferences to matched patterns
    for (const pref of insightPreferences) {
      const insight = insights.find(i => i.id === pref.insightId);
      if (insight && pref.preference.action === 'use' && insight.pattern) {
        // Apply pattern from insight
        // This would be more sophisticated in a real implementation
        logger.debug(`[SchemaEnhancer] Applying insight pattern: ${insight.pattern}`);
      }
    }

    // Include extracted schema patterns in matched patterns if available
    if (schemaContext?.schemaPatterns && schemaContext.schemaPatterns.length > 0) {
      for (const extractedPattern of schemaContext.schemaPatterns) {
        if (!matchedPatterns.has(extractedPattern.pattern)) {
          matchedPatterns.set(extractedPattern.pattern, {
            pattern: extractedPattern.pattern,
            examples: extractedPattern.examples,
            file: extractedPattern.file,
            similarity: 0.8, // High similarity for extracted patterns
          });
        }
      }
    }

    // Generate schemas with enriched context (including file contexts for reference)
    const schemas = await this.generateSchemaDefinitions(schemaNeeds, matchedPatterns, context, schemaContext);

    return schemas;
  }

  /**
   * Find related patterns for a schema
   */
  private findRelatedPatterns(
    schema: SchemaDefinition,
    codebaseAnalysis: CodebaseAnalysisResult
  ): any[] {
    const related: any[] = [];

    if (codebaseAnalysis.schemaPatterns) {
      for (const pattern of codebaseAnalysis.schemaPatterns) {
        if (pattern.type === schema.type || pattern.pattern.includes(schema.type)) {
          related.push(pattern);
        }
      }
    }

    return related;
  }

  /**
   * Refine a schema using patterns
   */
  private async refineSchemaWithPatterns(
    schema: SchemaDefinition,
    patterns: any[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<SchemaDefinition> {
    if (patterns.length === 0) {
      // No patterns found, try to improve schema anyway
      logger.debug(`[SchemaEnhancer] No patterns found for schema ${schema.id}, keeping as-is`);
      return schema;
    }

    // Use the first/best pattern to refine schema
    const pattern = patterns[0];

    // Build refinement prompt
    const prompt = await this.config.promptSelector.getPromptForUseCase(
      'schema-enhancement',
      {
        mode: 'convert',
        framework: codebaseAnalysis.frameworkPlugin?.name,
        featureTypes: codebaseAnalysis.featureTypes as FeatureType[],
      }
    );

    const refinementPrompt = this.buildSchemaRefinementPrompt(schema, pattern, prompt);

    try {
      const response = await this.textGenerator.generate(refinementPrompt, {
        maxTokens: 2000,
        temperature: 0.3,
        systemPrompt: 'You are an expert at refining schema definitions based on codebase patterns.',
      });

      // Parse refined schema content (create minimal task-like object for parsing)
      const refinedContent = this.parseSchemaResponse(response, { type: schema.type, task: { id: schema.id, title: schema.description || schema.id, description: schema.description || '' } as ParsedTask });

      if (refinedContent && refinedContent !== schema.content) {
        return {
          ...schema,
          content: refinedContent,
          relatedSchemas: pattern.examples || schema.relatedSchemas,
        };
      }
    } catch (error) {
      logger.warn(`[SchemaEnhancer] Failed to refine schema ${schema.id} using patterns: ${error}`);
    }

    // Return original schema if refinement failed
    return schema;
  }

  /**
   * Build prompt for schema refinement
   */
  private buildSchemaRefinementPrompt(
    schema: SchemaDefinition,
    pattern: any,
    basePrompt: string
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');
    parts.push('## Refine Existing Schema');
    parts.push(`Schema ID: ${schema.id}`);
    parts.push(`Schema Type: ${schema.type}`);
    parts.push(`Current Content:\n\`\`\`yaml\n${schema.content}\n\`\`\``);
    parts.push('');

    parts.push('## Codebase Pattern (Use as Reference)');
    parts.push(`Pattern Type: ${pattern.type || 'unknown'}`);
    if (pattern.pattern) {
      parts.push(`Pattern: ${pattern.pattern}`);
    }
    if (pattern.examples && pattern.examples.length > 0) {
      parts.push(`Example Files: ${pattern.examples.slice(0, 3).join(', ')}`);
    }
    parts.push('');

    parts.push('## Instructions');
    parts.push('Refine the schema above to better match the codebase pattern.');
    parts.push('Improve the schema structure, add missing fields, and ensure it follows the pattern conventions.');
    parts.push('Return the refined schema in YAML format.');

    return parts.join('\n');
  }

  /**
   * Analyze PRD requirements to identify schema needs
   */
  private analyzeSchemaNeeds(prd: ParsedPlanningDoc): Array<{
    type: 'config-schema' | 'entity-type' | 'plugin-type' | 'field-type';
    requirement: string;
    task: ParsedTask;
    phase: ParsedPhase;
  }> {
    const needs: Array<{
      type: 'config-schema' | 'entity-type' | 'plugin-type' | 'field-type';
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }> = [];

    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        const taskText = `${task.title} ${task.description}`.toLowerCase();

        // Detect schema needs from task description
        if (
          taskText.includes('config') ||
          taskText.includes('configuration') ||
          taskText.includes('schema')
        ) {
          needs.push({
            type: 'config-schema',
            requirement: task.description,
            task,
            phase,
          });
        }

        if (taskText.includes('entity') || taskText.includes('model')) {
          needs.push({
            type: 'entity-type',
            requirement: task.description,
            task,
            phase,
          });
        }

        if (taskText.includes('plugin')) {
          needs.push({
            type: 'plugin-type',
            requirement: task.description,
            task,
            phase,
          });
        }

        if (taskText.includes('field')) {
          needs.push({
            type: 'field-type',
            requirement: task.description,
            task,
            phase,
          });
        }
      }
    }

    return needs;
  }

  /**
   * Match schema needs with existing codebase patterns
   */
  private matchWithCodebasePatterns(
    needs: Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>,
    analysis: CodebaseAnalysisResult
  ): Map<string, any> {
    const matches = new Map();

    for (const need of needs) {
      // Look for similar patterns in codebase
      if (analysis.schemaPatterns) {
        for (const pattern of analysis.schemaPatterns) {
          if (pattern.type === need.type) {
            matches.set(need.task.id, {
              pattern,
              similarity: 0.8, // Basic similarity score
            });
            break;
          }
        }
      }

      // Look for patterns in file contexts
      if (analysis.patterns) {
        for (const pattern of analysis.patterns) {
          const sigLower = pattern.signature.toLowerCase();
          if (
            (need.type === 'entity-type' && sigLower.includes('entity')) ||
            (need.type === 'plugin-type' && sigLower.includes('plugin')) ||
            (need.type === 'service' && sigLower.includes('service'))
          ) {
            if (!matches.has(need.task.id)) {
              matches.set(need.task.id, {
                pattern,
                similarity: 0.6,
              });
            }
          }
        }
      }
    }

    return matches;
  }

  /**
   * Generate schema definitions using AI
   */
  private async generateSchemaDefinitions(
    needs: Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>,
    matchedPatterns: Map<string, any>,
    context?: {
      conversationId?: string;
      iteration?: number;
    },
    schemaContext?: {
      schemaPatterns?: Array<{ pattern: string; file: string; examples: string[] }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): Promise<SchemaDefinition[]> {
    const schemas: SchemaDefinition[] = [];

    // Get appropriate prompt for schema generation
    const prompt = await this.config.promptSelector.getPromptForUseCase(
      'schema-enhancement',
      {
        mode: 'convert', // Default to convert mode for schema enhancement
        framework: this.config.codebaseAnalysis.framework,
        featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
      }
    );

    // Generate schema for each need
    for (const need of needs) {
      try {
        const matchedPattern = matchedPatterns.get(need.task.id);
        const schema = await this.generateSingleSchema(
          need,
          matchedPattern,
          prompt,
          context,
          schemaContext
        );
        if (schema) {
          schemas.push(schema);
        }
      } catch (error) {
        logger.warn(
          `[SchemaEnhancer] Failed to generate schema for task ${need.task.id}: ${error}`
        );
      }
    }

    return schemas;
  }

  /**
   * Generate a single schema definition
   */
  private async generateSingleSchema(
    need: {
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    },
    matchedPattern: any,
    basePrompt: string,
    context?: {
      conversationId?: string;
      iteration?: number;
    },
    schemaContext?: {
      schemaPatterns?: Array<{ pattern: string; file: string; examples: string[] }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): Promise<SchemaDefinition | null> {
    // Build prompt for AI with schema context (patterns and file contexts)
    const prompt = this.buildSchemaGenerationPrompt(need, matchedPattern, basePrompt, schemaContext);

    try {
      const response = await this.textGenerator.generate(prompt, {
        maxTokens: 2000,
        temperature: 0.3, // Lower temperature for more deterministic schema generation
        systemPrompt: 'You are an expert at generating schema definitions based on requirements and codebase patterns.',
      });

      // Parse AI response to extract schema definition
      const schemaContent = this.parseSchemaResponse(response, need);

      if (!schemaContent) {
        return null;
      }

      // Determine schema path based on framework and type
      const schemaPath = this.determineSchemaPath(
        need,
        this.config.codebaseAnalysis.frameworkPlugin
      );

      return {
        id: this.generateSchemaId(need.task.id, need.type),
        type: need.type as SchemaDefinition['type'],
        path: schemaPath,
        content: schemaContent,
        description: `Schema for ${need.task.title}`,
        framework: this.config.codebaseAnalysis.framework,
        featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
        relatedSchemas: matchedPattern?.pattern?.examples || [],
      };
    } catch (error) {
      logger.error(`[SchemaEnhancer] Failed to generate schema: ${error}`);
      return null;
    }
  }

  /**
   * Build prompt for schema generation
   */
  private buildSchemaGenerationPrompt(
    need: {
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    },
    matchedPattern: any,
    basePrompt: string,
    schemaContext?: {
      schemaPatterns?: Array<{ pattern: string; file: string; examples: string[] }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): string {
    const parts: string[] = [];

    // Base prompt
    parts.push(basePrompt);
    parts.push('\n---\n');

    // Requirement context
    parts.push('## Requirement');
    parts.push(`Task: ${need.task.title}`);
    parts.push(`Description: ${need.task.description}`);
    parts.push(`Phase: ${need.phase.name}`);
    parts.push(`Schema Type: ${need.type}`);
    parts.push('');

    // Framework context
    if (this.config.codebaseAnalysis.frameworkPlugin) {
      parts.push('## Framework');
      parts.push(`Framework: ${this.config.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push(`Description: ${this.config.codebaseAnalysis.frameworkPlugin.description}`);
      parts.push('');
    }

    // Extracted schema patterns from existing schema files (NEW)
    if (schemaContext?.schemaPatterns && schemaContext.schemaPatterns.length > 0) {
      parts.push('## Extracted Schema Patterns (Follow These Structures)');
      for (const extractedPattern of schemaContext.schemaPatterns.slice(0, 5)) {
        parts.push(`- Pattern: ${extractedPattern.pattern}`);
        parts.push(`  File: ${path.basename(extractedPattern.file)}`);
        if (extractedPattern.examples && extractedPattern.examples.length > 0) {
          parts.push(`  Structure: ${extractedPattern.examples[0].substring(0, 200)}${extractedPattern.examples[0].length > 200 ? '...' : ''}`);
        }
      }
      if (schemaContext.schemaPatterns.length > 5) {
        parts.push(`... and ${schemaContext.schemaPatterns.length - 5} more patterns`);
      }
      parts.push('');
      parts.push('**IMPORTANT**: Follow these existing schema structures when generating new schemas.');
      parts.push('');
    }

    // Codebase patterns context
    if (matchedPattern?.pattern) {
      parts.push('## Existing Pattern (Use as Reference)');
      parts.push(`Pattern Type: ${matchedPattern.pattern.type || 'unknown'}`);
      if (matchedPattern.pattern.examples && matchedPattern.pattern.examples.length > 0) {
        parts.push(`Example Files: ${matchedPattern.pattern.examples.slice(0, 3).join(', ')}`);
      }
      parts.push('');
    }

    // File contexts for reference (NEW)
    if (schemaContext?.fileContexts && schemaContext.fileContexts.size > 0) {
      parts.push('## Example Schema Files (Reference for Structure)');
      let fileCount = 0;
      for (const [filePath, fileContext] of schemaContext.fileContexts.entries()) {
        if (fileCount >= 3) break;
        parts.push(`- ${path.basename(filePath)}`);
        if (fileContext.skeleton) {
          parts.push(`  Structure: ${fileContext.skeleton.substring(0, 200)}${fileContext.skeleton.length > 200 ? '...' : ''}`);
        }
        fileCount++;
      }
      parts.push('');
    }

    // Codebase context summary
    if (this.config.codebaseAnalysis.codebaseContext) {
      parts.push('## Codebase Context');
      parts.push(this.config.codebaseAnalysis.codebaseContext.substring(0, 2000)); // Limit context size
      parts.push('');
    }

    // Instructions
    parts.push('## Instructions');
    parts.push(`Generate a ${need.type} schema definition for the requirement above.`);
    parts.push('Follow the framework-specific patterns and conventions.');
    if (matchedPattern?.pattern) {
      parts.push('Use the existing pattern as a reference but adapt it for this requirement.');
    }
    parts.push('Return the schema definition in the appropriate format (YAML for Drupal, etc.).');

    return parts.join('\n');
  }

  /**
   * Parse AI response to extract schema definition
   */
  private parseSchemaResponse(
    response: string,
    need: { type: string; task: ParsedTask }
  ): string | null {
    // Try to extract YAML/JSON schema from response
    // Look for code blocks or YAML sections
    const yamlMatch = response.match(/```(?:yaml|yml)?\n([\s\S]*?)\n```/);
    if (yamlMatch) {
      return yamlMatch[1];
    }

    // Look for YAML-like content (lines starting with key: value)
    const yamlLines = response.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.includes(':') && !trimmed.startsWith('#');
    });
    if (yamlLines.length > 0) {
      return yamlLines.join('\n');
    }

    // If no structured format found, try to extract the main content
    // Split by common separators and take the most relevant section
    const sections = response.split(/\n---+\n/);
    for (const section of sections) {
      if (section.toLowerCase().includes(need.type) || section.toLowerCase().includes('schema')) {
        return section.trim();
      }
    }

    // Last resort: return entire response if it looks like schema content
    if (response.length > 50 && response.length < 5000) {
      return response.trim();
    }

    return null;
  }

  /**
   * Determine schema path based on framework and type
   */
  private determineSchemaPath(
    need: { type: string; task: ParsedTask },
    frameworkPlugin?: any
  ): string {
    const taskId = need.task.id.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const baseName = `${taskId}_schema`;

    if (frameworkPlugin?.name === 'drupal') {
      // Drupal schema paths: config/schema/{module}.schema.yml or docroot/modules/{module}/config/schema/
      return `config/schema/${baseName}.schema.yml`;
    } else if (frameworkPlugin?.name === 'django') {
      // Django doesn't use YAML schemas, but could use models.py or schemas.py
      return `schemas/${baseName}.py`;
    } else {
      // Generic: use schemas directory
      return `schemas/${baseName}.yml`;
    }
  }

  /**
   * Generate schema ID
   */
  private generateSchemaId(taskId: string, type: string): string {
    const cleanId = taskId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `${cleanId}_${type}`;
  }

  /**
   * Calculate confidence score for schema enhancements
   */
  private calculateConfidence(
    schemas: SchemaDefinition[],
    matchedPatterns: Map<string, any>
  ): number {
    if (schemas.length === 0) {
      return 0;
    }

    let totalConfidence = 0;
    for (const schema of schemas) {
      const match = matchedPatterns.get(schema.id.split('_')[0]); // Extract task ID from schema ID
      if (match) {
        totalConfidence += match.similarity || 0.5;
      } else {
        totalConfidence += 0.3; // Lower confidence if no pattern match
      }
    }

    return Math.min(totalConfidence / schemas.length, 1.0);
  }

  /**
   * Generate summary of schema enhancements
   */
  private generateSummary(
    schemas: SchemaDefinition[],
    needs: Array<{ type: string; requirement: string; task: ParsedTask; phase: ParsedPhase }>
  ): string {
    const parts: string[] = [];

    parts.push(`Generated ${schemas.length} schema definition(s) for ${needs.length} requirement(s).`);

    // Group by type
    const byType = new Map<string, SchemaDefinition[]>();
    for (const schema of schemas) {
      if (!byType.has(schema.type)) {
        byType.set(schema.type, []);
      }
      byType.get(schema.type)!.push(schema);
    }

    for (const [type, typeSchemas] of byType.entries()) {
      parts.push(`- ${typeSchemas.length} ${type} schema(s)`);
    }

    // List schema files
    parts.push('\nSchema files to be created:');
    for (const schema of schemas) {
      parts.push(`- ${schema.path}: ${schema.description}`);
    }

    return parts.join('\n');
  }
}
