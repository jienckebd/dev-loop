/**
 * Zod Schemas for LangChain Structured Output
 *
 * These schemas are used with model.withStructuredOutput() for type-safe AI responses.
 */

import { z } from 'zod';

/**
 * Schema for code file changes
 */
export const FileChangeSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  content: z.string().describe('Full content of the file'),
  operation: z.enum(['create', 'update', 'delete']).optional().describe('Type of file operation'),
});

/**
 * Schema for code generation responses
 */
export const CodeChangesSchema = z.object({
  files: z.array(FileChangeSchema).describe('List of files to create or modify'),
  summary: z.string().describe('Brief summary of the changes made'),
});

/**
 * Schema for error analysis responses
 */
export const AnalysisSchema = z.object({
  errorType: z.string().describe('Category of the error'),
  rootCause: z.string().describe('Root cause analysis'),
  suggestedFix: z.string().describe('Suggested fix for the error'),
  affectedFiles: z.array(z.string()).describe('List of files affected by the error'),
  confidence: z.number().min(0).max(1).describe('Confidence level of the analysis'),
});

/**
 * Schema for pattern detection responses
 */
export const PatternDetectionSchema = z.object({
  patterns: z.array(z.object({
    id: z.string().describe('Unique pattern identifier'),
    name: z.string().describe('Human-readable pattern name'),
    description: z.string().describe('Description of the pattern'),
    locations: z.array(z.object({
      file: z.string(),
      startLine: z.number(),
      endLine: z.number(),
    })).describe('Where the pattern was found'),
    confidence: z.number().min(0).max(1).describe('Confidence level'),
  })).describe('Detected patterns'),
  recommendations: z.array(z.object({
    type: z.enum(['abstraction', 'refactor', 'optimization']),
    suggestion: z.string(),
    reasoning: z.string(),
    estimatedImpact: z.enum(['low', 'medium', 'high']),
  })).describe('Recommendations based on patterns'),
});

/**
 * Schema for embedding generation (used for semantic search)
 */
export const EmbeddingRequestSchema = z.object({
  texts: z.array(z.string()).describe('Texts to generate embeddings for'),
});

/**
 * Schema for fix task generation
 */
export const FixTaskSchema = z.object({
  taskType: z.enum(['fix', 'investigation', 'refactor']).describe('Type of fix task'),
  title: z.string().describe('Task title'),
  description: z.string().describe('Detailed task description'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).describe('Task priority'),
  targetFiles: z.array(z.string()).describe('Files to focus on'),
  steps: z.array(z.string()).describe('Steps to complete the fix'),
});

/**
 * Schema for improvement suggestions
 */
export const ImprovementSuggestionSchema = z.object({
  suggestions: z.array(z.object({
    category: z.enum(['performance', 'maintainability', 'reliability', 'security', 'testing']),
    title: z.string(),
    description: z.string(),
    effort: z.enum(['low', 'medium', 'high']),
    impact: z.enum(['low', 'medium', 'high']),
  })).describe('List of improvement suggestions'),
});

// Type exports for use in TypeScript
export type FileChange = z.infer<typeof FileChangeSchema>;
export type CodeChanges = z.infer<typeof CodeChangesSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type PatternDetection = z.infer<typeof PatternDetectionSchema>;
export type FixTask = z.infer<typeof FixTaskSchema>;
export type ImprovementSuggestion = z.infer<typeof ImprovementSuggestionSchema>;
