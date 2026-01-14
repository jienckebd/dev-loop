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
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
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
  /**
   * Whether @codebase tag is being used for AI calls.
   */
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
   * Execute an operation with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isJsonError = error instanceof Error &&
          (error.message.includes('JSON') || error.message.includes('parse'));
        const isRetryable = isJsonError || (error instanceof Error && error.message.includes('timeout'));

        if (attempt === maxRetries || !isRetryable) {
          logger.warn(`[SchemaEnhancer] ${operationName} failed after ${attempt} attempts: ${error}`);
          return null;
        }

        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`[SchemaEnhancer] ${operationName} retry ${attempt}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return null;
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
      }, {
        purpose: `Refine ${schema.type} schema using ${pattern.pattern} pattern`,
        phase: 'schema-enhancement',
        expectedImpact: `Updated schema for ${schema.type}`,
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
   * Generate schema definitions using AI (with batching by type)
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
    const basePrompt = await this.config.promptSelector.getPromptForUseCase(
      'schema-enhancement',
      {
        mode: 'convert', // Default to convert mode for schema enhancement
        framework: this.config.codebaseAnalysis.framework,
        featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
      }
    );

    // Group needs by type for batching
    const groupedNeeds = this.groupNeedsByType(needs);
    
    // Process groups in parallel with concurrency limit for performance
    const CONCURRENCY = 3;
    const entries = Array.from(groupedNeeds.entries());
    
    logger.info(`[SchemaEnhancer] Processing ${entries.length} schema type groups with concurrency ${CONCURRENCY}`);
    
    // Process in batches of CONCURRENCY
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      const batchPromises = batch.map(async ([type, typeNeeds]) => {
        const results: SchemaDefinition[] = [];
        
        if (typeNeeds.length === 1) {
          // Single schema - use individual generation
          try {
            const need = typeNeeds[0];
            const matchedPattern = matchedPatterns.get(need.task.id);
            const schema = await this.generateSingleSchema(
              need,
              matchedPattern,
              basePrompt,
              context,
              schemaContext
            );
            if (schema) {
              results.push(schema);
            }
          } catch (error) {
            logger.warn(
              `[SchemaEnhancer] Failed to generate schema for task ${typeNeeds[0].task.id}: ${error}`
            );
          }
        } else {
          // Multiple schemas of same type - batch them
          try {
            const batchSchemas = await this.generateBatchSchemas(
              typeNeeds,
              type,
              matchedPatterns,
              basePrompt,
              context,
              schemaContext
            );
            results.push(...batchSchemas);
          } catch (error) {
            logger.warn(
              `[SchemaEnhancer] Failed to generate batch schemas for type ${type}: ${error}, falling back to individual generation`
            );
            // Fallback to individual generation if batch fails
            for (const need of typeNeeds) {
              try {
                const matchedPattern = matchedPatterns.get(need.task.id);
                const schema = await this.generateSingleSchema(
                  need,
                  matchedPattern,
                  basePrompt,
                  context,
                  schemaContext
                );
                if (schema) {
                  results.push(schema);
                }
              } catch (individualError) {
                logger.warn(
                  `[SchemaEnhancer] Failed to generate schema for task ${need.task.id}: ${individualError}`
                );
              }
            }
          }
        }
        
        return results;
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      for (const results of batchResults) {
        schemas.push(...results);
      }
      
      if (i + CONCURRENCY < entries.length) {
        logger.debug(`[SchemaEnhancer] Completed batch ${Math.floor(i / CONCURRENCY) + 1}, processing next...`);
      }
    }

    return schemas;
  }

  /**
   * Group schema needs by type
   */
  private groupNeedsByType(
    needs: Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>
  ): Map<string, Array<{
    type: string;
    requirement: string;
    task: ParsedTask;
    phase: ParsedPhase;
  }>> {
    const grouped = new Map<string, Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>>();

    for (const need of needs) {
      if (!grouped.has(need.type)) {
        grouped.set(need.type, []);
      }
      grouped.get(need.type)!.push(need);
    }

    return grouped;
  }

  /**
   * Generate multiple schemas of the same type in a single AI call
   */
  private async generateBatchSchemas(
    needs: Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>,
    type: string,
    matchedPatterns: Map<string, any>,
    basePrompt: string,
    context?: {
      conversationId?: string;
      iteration?: number;
    },
    schemaContext?: {
      schemaPatterns?: Array<{ pattern: string; file: string; examples: string[] }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): Promise<SchemaDefinition[]> {
    logger.debug(`[SchemaEnhancer] Generating batch of ${needs.length} ${type} schema(s)`);

    // Build batch prompt
    const batchPrompt = this.buildBatchSchemaPrompt(needs, type, matchedPatterns, basePrompt, schemaContext);

    try {
      const response = await this.textGenerator.generate(batchPrompt, {
        maxTokens: 8000, // Higher token limit for batch
        temperature: 0.3,
        systemPrompt: 'You are an expert at generating multiple schema definitions based on requirements and codebase patterns. Generate all schemas in the batch, separating each with clear markers.',
      }, {
        purpose: `Generate batch of ${needs.length} ${type} schemas`,
        phase: 'schema-enhancement',
        expectedImpact: `${needs.length} schema definitions`,
      });

      // Parse batch response
      const batchSchemas = this.parseBatchSchemaResponse(response, needs, type);

      // Fill in additional metadata for each schema
      for (const schema of batchSchemas) {
        schema.framework = this.config.codebaseAnalysis.framework;
        schema.featureTypes = this.config.codebaseAnalysis.featureTypes as FeatureType[];
        const matchedPattern = matchedPatterns.get(schema.id.split('_')[0]); // Extract task ID
        if (matchedPattern?.pattern?.examples) {
          schema.relatedSchemas = matchedPattern.pattern.examples;
        }
      }

      return batchSchemas;
    } catch (error) {
      logger.error(`[SchemaEnhancer] Failed to generate batch schemas: ${error}`);
      throw error;
    }
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
    // Check if schema file already exists and is valid (skip AI call if so)
    const schemaPath = this.determineSchemaPath(
      need,
      this.config.codebaseAnalysis.frameworkPlugin
    );
    const fullPath = path.join(this.config.projectRoot, schemaPath);
    
    if (await fs.pathExists(fullPath)) {
      try {
        const existingContent = await fs.readFile(fullPath, 'utf-8');
        if (this.isValidSchema(existingContent, need.type)) {
          logger.info(`[SchemaEnhancer] Skipping ${need.task.id} - schema already exists and is valid at ${schemaPath}`);
          return {
            id: this.generateSchemaId(need.task.id, need.type),
            type: need.type as SchemaDefinition['type'],
            path: schemaPath,
            content: existingContent,
            description: `Schema for ${need.task.title}`,
            framework: this.config.codebaseAnalysis.framework,
            featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
            relatedSchemas: matchedPattern?.pattern?.examples || [],
          };
        }
      } catch (error) {
        logger.debug(`[SchemaEnhancer] Failed to read existing schema file ${fullPath}: ${error}`);
        // Continue to generate new schema if reading fails
      }
    }

    // Build prompt for AI with schema context (patterns and file contexts)
    const prompt = this.buildSchemaGenerationPrompt(need, matchedPattern, basePrompt, schemaContext);

    // Use retry logic for AI call
    const result = await this.executeWithRetry(
      async () => {
        const response = await this.textGenerator.generate(prompt, {
          maxTokens: 2000,
          temperature: 0.3, // Lower temperature for more deterministic schema generation
          systemPrompt: 'You are an expert at generating schema definitions based on requirements and codebase patterns.',
        }, {
          purpose: `Generate ${need.type} schema for ${need.task.title || need.task.id}`,
          phase: 'schema-enhancement',
          expectedImpact: `Schema definition for ${need.type}`,
        });

        // Parse AI response to extract schema definition
        const schemaContent = this.parseSchemaResponse(response, need);

        if (!schemaContent) {
          throw new Error('Failed to parse schema response');
        }

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
      },
      `generateSchema(${need.task.id})`
    );

    return result;
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

    // Always include full codebase context for all AI providers
    // Dev-loop's CodebaseAnalyzer provides consistent context across all providers
    
    // Framework context - always included
    if (this.config.codebaseAnalysis.frameworkPlugin) {
      parts.push('## Framework');
      parts.push(`Framework: ${this.config.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push(`Description: ${this.config.codebaseAnalysis.frameworkPlugin.description}`);
      parts.push('');
    }

    // Full context - extracted schema patterns from existing schema files
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

    // File contexts for reference
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

    // Codebase patterns context - brief reference for both modes
    if (matchedPattern?.pattern) {
      parts.push('## Existing Pattern (Use as Reference)');
      parts.push(`Pattern Type: ${matchedPattern.pattern.type || 'unknown'}`);
      if (matchedPattern.pattern.examples && matchedPattern.pattern.examples.length > 0) {
        parts.push(`Example Files: ${matchedPattern.pattern.examples.slice(0, 3).join(', ')}`);
      }
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
   * Build prompt for batch schema generation
   */
  private buildBatchSchemaPrompt(
    needs: Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>,
    type: string,
    matchedPatterns: Map<string, any>,
    basePrompt: string,
    schemaContext?: {
      schemaPatterns?: Array<{ pattern: string; file: string; examples: string[] }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');
    parts.push(`## Batch Schema Generation: ${type}`);
    parts.push(`Generate ${needs.length} ${type} schema definition(s) in a single response.`);
    parts.push('');

    // List all requirements in the batch
    parts.push('## Requirements to Generate');
    for (let i = 0; i < needs.length; i++) {
      const need = needs[i];
      parts.push(`### Schema ${i + 1}: ${need.task.title}`);
      parts.push(`Task ID: ${need.task.id}`);
      parts.push(`Description: ${need.task.description}`);
      parts.push(`Phase: ${need.phase.name}`);
      parts.push(`Expected Schema ID: ${this.generateSchemaId(need.task.id, need.type)}`);
      parts.push(`Expected Path: ${this.determineSchemaPath(need, this.config.codebaseAnalysis.frameworkPlugin)}`);
      parts.push('');
    }

    // Framework context (shared across all)
    if (this.config.codebaseAnalysis.frameworkPlugin) {
      parts.push('## Framework');
      parts.push(`Framework: ${this.config.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push(`Description: ${this.config.codebaseAnalysis.frameworkPlugin.description}`);
      parts.push('');
    }

    // Extracted schema patterns
    if (schemaContext?.schemaPatterns && schemaContext.schemaPatterns.length > 0) {
      parts.push('## Extracted Schema Patterns (Follow These Structures)');
      for (const extractedPattern of schemaContext.schemaPatterns.slice(0, 5)) {
        parts.push(`- Pattern: ${extractedPattern.pattern}`);
        parts.push(`  File: ${path.basename(extractedPattern.file)}`);
        if (extractedPattern.examples && extractedPattern.examples.length > 0) {
          parts.push(`  Structure: ${extractedPattern.examples[0].substring(0, 200)}${extractedPattern.examples[0].length > 200 ? '...' : ''}`);
        }
      }
      parts.push('');
    }

    // Instructions
    parts.push('## Instructions');
    parts.push(`Generate ${needs.length} ${type} schema definition(s) for all requirements listed above.`);
    parts.push('Return each schema in the following format:');
    parts.push('');
    parts.push('```yaml');
    parts.push('# SCHEMA: <schema-id>');
    parts.push('# TASK: <task-id>');
    parts.push('# PATH: <expected-path>');
    parts.push('<yaml-schema-content>');
    parts.push('```');
    parts.push('');
    parts.push('Separate each schema with a clear delimiter line (e.g., `---` or `### SCHEMA END`).');
    parts.push('Follow the framework-specific patterns and conventions for all schemas.');
    parts.push('Ensure each schema matches its corresponding requirement.');

    return parts.join('\n');
  }

  /**
   * Parse batch schema response to extract multiple schemas
   */
  private parseBatchSchemaResponse(
    response: string,
    needs: Array<{
      type: string;
      requirement: string;
      task: ParsedTask;
      phase: ParsedPhase;
    }>,
    type: string
  ): SchemaDefinition[] {
    const schemas: SchemaDefinition[] = [];

    // Try to split by schema markers
    const schemaSections = response.split(/### SCHEMA END|# SCHEMA:|SCHEMA:/i);

    for (let i = 0; i < needs.length; i++) {
      const need = needs[i];
      let schemaContent: string | null = null;
      const expectedId = this.generateSchemaId(need.task.id, need.type);

      // Look for schema with matching ID or task ID
      for (const section of schemaSections) {
        const taskIdMatch = section.match(/TASK:\s*([^\n]+)/i);
        const schemaIdMatch = section.match(/SCHEMA:\s*([^\n]+)/i);
        const taskId = taskIdMatch ? taskIdMatch[1].trim() : null;
        const schemaId = schemaIdMatch ? schemaIdMatch[1].trim() : null;

        if (taskId === need.task.id || schemaId === expectedId || (i === 0 && !schemaContent)) {
          // Extract YAML content from this section
          const yamlMatch = section.match(/```(?:yaml|yml)?\n([\s\S]*?)\n```/);
          if (yamlMatch) {
            schemaContent = yamlMatch[1];
            break;
          }

          // Try to extract path if specified
          const pathMatch = section.match(/PATH:\s*([^\n]+)/i);
          if (pathMatch) {
            // Use specified path
          }

          // Fallback: extract YAML-like content
          const yamlLines = section.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed.length > 0 && !trimmed.startsWith('#') && trimmed.includes(':');
          });
          if (yamlLines.length >= 2) {
            schemaContent = yamlLines.join('\n');
            break;
          }
        }
      }

      // If not found by ID, try sequential extraction
      if (!schemaContent && i < schemaSections.length) {
        const section = schemaSections[i + 1]; // Skip first section (header)
        if (section) {
          const yamlMatch = section.match(/```(?:yaml|yml)?\n([\s\S]*?)\n```/);
          if (yamlMatch) {
            schemaContent = yamlMatch[1];
          }
        }
      }

      // If still no content, use single schema extraction as fallback
      if (!schemaContent) {
        schemaContent = this.parseSchemaResponse(response, need);
      }

      if (schemaContent) {
        const schemaPath = this.determineSchemaPath(need, this.config.codebaseAnalysis.frameworkPlugin);
        schemas.push({
          id: expectedId,
          type: need.type as SchemaDefinition['type'],
          path: schemaPath,
          content: schemaContent,
          description: `Schema for ${need.task.title}`,
          framework: this.config.codebaseAnalysis.framework,
          featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
        });
      }
    }

    return schemas;
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
   * Validate if schema content is valid for the given type
   */
  private isValidSchema(content: string, type: string): boolean {
    if (!content || content.trim().length === 0) {
      return false;
    }

    // Basic validation: check if content looks like YAML or JSON schema
    const trimmed = content.trim();
    
    // Check for YAML-like structure (key: value pairs)
    const yamlPattern = /^\s*\w+:\s*.+/m;
    if (yamlPattern.test(trimmed)) {
      // Additional check: ensure it's not just a comment or empty structure
      const nonCommentLines = trimmed.split('\n').filter(line => {
        const trimmedLine = line.trim();
        return trimmedLine.length > 0 && !trimmedLine.startsWith('#');
      });
      return nonCommentLines.length >= 2; // At least 2 non-comment lines
    }

    // Check for JSON-like structure
    const jsonPattern = /^\s*[\{\[]/;
    if (jsonPattern.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        // Not valid JSON
        return false;
      }
    }

    // If it doesn't match YAML or JSON patterns but has substantial content, consider valid
    // (might be framework-specific format)
    return trimmed.length > 50;
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
