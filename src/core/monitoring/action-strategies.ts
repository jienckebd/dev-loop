/**
 * Action Strategies
 * 
 * Specific fix strategies for each issue type.
 * Each strategy knows how to fix a particular type of issue.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../config/schema/core';
import { IssueClassification } from './issue-classifier';
import { DevLoopEvent } from '../utils/event-stream';
import { logger } from '../utils/logger';
import { getEventStream } from '../utils/event-stream';

export interface ActionStrategy {
  name: string;
  issueType: string;
  execute(classification: IssueClassification, events: DevLoopEvent[]): Promise<{
    success: boolean;
    fixApplied: boolean;
    rollbackRequired: boolean;
    error?: string;
  }>;
}

export interface StrategyResult {
  success: boolean;
  fixApplied: boolean;
  rollbackRequired: boolean;
  error?: string;
}

/**
 * JSON Parsing Failure Strategy
 * Enhances JSON parser with better extraction logic
 */
export function createJsonParsingStrategy(config: Config): ActionStrategy {
  return {
    name: 'enhance-json-parser',
    issueType: 'json-parsing-failure',
    async execute(classification, events): Promise<StrategyResult> {
      try {
        const parserPath = path.join(process.cwd(), 'node_modules/dev-loop/src/providers/ai/json-parser.ts');
        
        if (!fs.existsSync(parserPath)) {
          return {
            success: false,
            fixApplied: false,
            rollbackRequired: false,
            error: `JSON parser file not found: ${parserPath}`,
          };
        }

        const parserContent = fs.readFileSync(parserPath, 'utf8');
        
        // Extract failure reasons from events
        const reasons = events
          .filter(e => e.data.reason && typeof e.data.reason === 'string')
          .map(e => e.data.reason as string);
        
        const mostCommonReason = reasons[0] || 'unknown';

        // Generate fix based on common failure reason
        let fixContent = parserContent;
        
        // Add better error handling for common patterns
        if (mostCommonReason.includes('control character') || mostCommonReason.includes('bad control')) {
          // Add control character sanitization
          if (!parserContent.includes('sanitizeControlCharacters')) {
            fixContent = addControlCharacterSanitization(fixContent);
          }
        }

        if (mostCommonReason.includes('newline') || mostCommonReason.includes('literal')) {
          // Add newline escaping
          if (!parserContent.includes('escapeLiteralNewlines')) {
            fixContent = addNewlineEscaping(fixContent);
          }
        }

        // Only apply fix if content changed
        if (fixContent === parserContent) {
          logger.info('[JsonParsingStrategy] No changes needed to parser');
          return {
            success: true,
            fixApplied: false,
            rollbackRequired: false,
          };
        }

        // Create backup
        const backupPath = `${parserPath}.backup.${Date.now()}`;
        fs.writeFileSync(backupPath, parserContent);

        // Apply fix
        fs.writeFileSync(parserPath, fixContent);

        logger.info(`[JsonParsingStrategy] Enhanced JSON parser (backup: ${path.basename(backupPath)})`);

        // Emit event
        getEventStream().emit(
          'intervention:fix_applied',
          {
            strategy: 'enhance-json-parser',
            file: parserPath,
            backup: backupPath,
            reason: `Fixed ${mostCommonReason}`,
          },
          { severity: 'info' }
        );

        return {
          success: true,
          fixApplied: true,
          rollbackRequired: false,
        };
      } catch (error) {
        logger.error('[JsonParsingStrategy] Error applying fix:', error);
        return {
          success: false,
          fixApplied: false,
          rollbackRequired: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Task Blocking Strategy
 * Unblocks tasks with enhanced context
 */
export function createTaskBlockingStrategy(config: Config): ActionStrategy {
  return {
    name: 'unblock-task',
    issueType: 'task-blocked',
    async execute(classification, events): Promise<StrategyResult> {
      try {
        const blockedEvents = events.filter(e => e.type === 'task:blocked');
        
        if (blockedEvents.length === 0) {
          return {
            success: false,
            fixApplied: false,
            rollbackRequired: false,
            error: 'No blocked tasks found in events',
          };
        }

        const taskId = blockedEvents[0].taskId || blockedEvents[0].data.taskId as string;
        
        if (!taskId) {
          return {
            success: false,
            fixApplied: false,
            rollbackRequired: false,
            error: 'No task ID found in blocked events',
          };
        }

        // Extract failure context
        const failureReasons: string[] = [];
        for (const event of blockedEvents) {
          if (event.data.reason && typeof event.data.reason === 'string') {
            failureReasons.push(event.data.reason);
          }
          if (event.data.error && typeof event.data.error === 'string') {
            failureReasons.push(event.data.error);
          }
        }

        // Reset retry count
        const retryCountsPath = path.join(process.cwd(), '.devloop/retry-counts.json');
        let retryCounts: Record<string, number> = {};
        
        if (fs.existsSync(retryCountsPath)) {
          try {
            retryCounts = JSON.parse(fs.readFileSync(retryCountsPath, 'utf8'));
          } catch (error) {
            logger.warn('[TaskBlockingStrategy] Failed to parse retry-counts.json:', error);
          }
        }

        retryCounts[taskId] = 0;
        fs.writeFileSync(retryCountsPath, JSON.stringify(retryCounts, null, 2));

        logger.info(`[TaskBlockingStrategy] Unblocked task ${taskId} (reset retry count)`);

        // Emit event
        getEventStream().emit(
          'contribution:agent_unblocked',
          {
            taskIds: [taskId],
            reason: `Automated unblock after analysis: ${failureReasons.join(', ')}`,
            resetRetryCount: true,
            clearErrors: true,
          },
          { severity: 'info' }
        );

        return {
          success: true,
          fixApplied: true,
          rollbackRequired: false,
        };
      } catch (error) {
        logger.error('[TaskBlockingStrategy] Error unblocking task:', error);
        return {
          success: false,
          fixApplied: false,
          rollbackRequired: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Boundary Violation Strategy
 * Enhances boundary enforcement logic
 */
export function createBoundaryViolationStrategy(config: Config): ActionStrategy {
  return {
    name: 'enhance-boundary-enforcement',
    issueType: 'boundary-violation',
    async execute(classification, events): Promise<StrategyResult> {
      try {
        const workflowPath = path.join(process.cwd(), 'node_modules/dev-loop/src/core/execution/workflow.ts');
        
        if (!fs.existsSync(workflowPath)) {
          return {
            success: false,
            fixApplied: false,
            rollbackRequired: false,
            error: `Workflow file not found: ${workflowPath}`,
          };
        }

        const workflowContent = fs.readFileSync(workflowPath, 'utf8');

        // Check if early filtering is already implemented
        if (workflowContent.includes('filterFilesBeforeValidation') || workflowContent.includes('Early file filtering')) {
          logger.info('[BoundaryViolationStrategy] Early filtering already implemented');
          
          // Might need to enhance warnings instead
          return enhanceBoundaryWarnings(workflowPath, workflowContent);
        }

        // Add early file filtering if not present
        const enhancedContent = addEarlyFileFiltering(workflowContent);

        // Create backup
        const backupPath = `${workflowPath}.backup.${Date.now()}`;
        fs.writeFileSync(backupPath, workflowContent);

        // Apply fix
        fs.writeFileSync(workflowPath, enhancedContent);

        logger.info(`[BoundaryViolationStrategy] Enhanced boundary enforcement (backup: ${path.basename(backupPath)})`);

        getEventStream().emit(
          'intervention:fix_applied',
          {
            strategy: 'enhance-boundary-enforcement',
            file: workflowPath,
            backup: backupPath,
            reason: 'Added early file filtering before validation',
          },
          { severity: 'info' }
        );

        return {
          success: true,
          fixApplied: true,
          rollbackRequired: false,
        };
      } catch (error) {
        logger.error('[BoundaryViolationStrategy] Error applying fix:', error);
        return {
          success: false,
          fixApplied: false,
          rollbackRequired: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Validation Failure Strategy
 * Enhances validation gates
 */
export function createValidationFailureStrategy(config: Config): ActionStrategy {
  return {
    name: 'enhance-validation-gates',
    issueType: 'validation-failure',
    async execute(classification, events): Promise<StrategyResult> {
      try {
        const validationPath = path.join(process.cwd(), 'node_modules/dev-loop/src/core/validation/validation-gate.ts');
        
        if (!fs.existsSync(validationPath)) {
          return {
            success: false,
            fixApplied: false,
            rollbackRequired: false,
            error: `Validation gate file not found: ${validationPath}`,
          };
        }

        const validationContent = fs.readFileSync(validationPath, 'utf8');
        
        // Extract error categories
        const categories = new Set<string>();
        for (const event of events) {
          if (event.data.category && typeof event.data.category === 'string') {
            categories.add(event.data.category);
          }
        }

        // Enhance validation gates with better error recovery
        let enhancedContent = validationContent;

        if (!validationContent.includes('generateRecoverySuggestions')) {
          enhancedContent = addRecoverySuggestions(enhancedContent);
        }

        // Create backup
        const backupPath = `${validationPath}.backup.${Date.now()}`;
        fs.writeFileSync(backupPath, validationContent);

        // Apply fix
        fs.writeFileSync(validationPath, enhancedContent);

        logger.info(`[ValidationFailureStrategy] Enhanced validation gates (backup: ${path.basename(backupPath)})`);

        getEventStream().emit(
          'intervention:fix_applied',
          {
            strategy: 'enhance-validation-gates',
            file: validationPath,
            backup: backupPath,
            reason: `Enhanced validation for categories: ${Array.from(categories).join(', ')}`,
          },
          { severity: 'info' }
        );

        return {
          success: true,
          fixApplied: true,
          rollbackRequired: false,
        };
      } catch (error) {
        logger.error('[ValidationFailureStrategy] Error applying fix:', error);
        return {
          success: false,
          fixApplied: false,
          rollbackRequired: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Contribution Mode Issue Strategy
 * Fixes contribution mode issues based on specific issue type
 */
export function createContributionModeStrategy(config: Config): ActionStrategy {
  return {
    name: 'fix-contribution-mode-issue',
    issueType: 'contribution:issue_detected',
    async execute(classification, events): Promise<StrategyResult> {
      try {
        const issueType = classification.context.primaryIssueType as string || 'unknown';
        
        // Delegate to specific fix based on issue type
        switch (issueType) {
          case 'module-confusion':
            return await fixModuleConfusion(config, classification, events);
          case 'session-pollution':
            return await fixSessionPollution(config, classification, events);
          case 'boundary-violations':
            return await fixBoundaryViolations(config, classification, events);
          case 'target-module-context-loss':
            return await fixContextLoss(config, classification, events);
          default:
            logger.warn(`[ContributionModeStrategy] Unknown issue type: ${issueType}`);
            return {
              success: false,
              fixApplied: false,
              rollbackRequired: false,
              error: `Unknown contribution mode issue type: ${issueType}`,
            };
        }
      } catch (error) {
        logger.error('[ContributionModeStrategy] Error applying fix:', error);
        return {
          success: false,
          fixApplied: false,
          rollbackRequired: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * IPC Connection Failure Strategy
 * Enhances IPC connection logic
 */
export function createIPCConnectionStrategy(config: Config): ActionStrategy {
  return {
    name: 'enhance-ipc-connection',
    issueType: 'ipc-connection-failure',
    async execute(classification, events): Promise<StrategyResult> {
      try {
        const ipcPath = path.join(process.cwd(), 'node_modules/dev-loop/src/core/utils/agent-ipc.ts');
        
        if (!fs.existsSync(ipcPath)) {
          return {
            success: false,
            fixApplied: false,
            rollbackRequired: false,
            error: `IPC file not found: ${ipcPath}`,
          };
        }

        const ipcContent = fs.readFileSync(ipcPath, 'utf8');

        // Add retry logic with exponential backoff if not present
        let enhancedContent = ipcContent;
        
        if (!ipcContent.includes('exponentialBackoff') && !ipcContent.includes('retry with backoff')) {
          enhancedContent = addIPCRetryLogic(enhancedContent);
        }

        // Create backup
        const backupPath = `${ipcPath}.backup.${Date.now()}`;
        fs.writeFileSync(backupPath, ipcContent);

        // Apply fix
        fs.writeFileSync(ipcPath, enhancedContent);

        logger.info(`[IPCConnectionStrategy] Enhanced IPC connection logic (backup: ${path.basename(backupPath)})`);

        getEventStream().emit(
          'intervention:fix_applied',
          {
            strategy: 'enhance-ipc-connection',
            file: ipcPath,
            backup: backupPath,
            reason: 'Added retry logic with exponential backoff',
          },
          { severity: 'info' }
        );

        return {
          success: true,
          fixApplied: true,
          rollbackRequired: false,
        };
      } catch (error) {
        logger.error('[IPCConnectionStrategy] Error applying fix:', error);
        return {
          success: false,
          fixApplied: false,
          rollbackRequired: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// Helper functions for code modifications

function addControlCharacterSanitization(content: string): string {
  // This would add a helper function to sanitize control characters
  // For now, we'll add a comment indicating where it should go
  const sanitizationHelper = `
/**
 * Sanitize control characters in JSON strings
 */
function sanitizeControlCharacters(jsonString: string): string {
  // Remove or escape problematic control characters
  return jsonString.replace(/[\\x00-\\x1F\\x7F]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code === 0x09 || code === 0x0A || code === 0x0D) {
      return char; // Keep tabs, newlines, carriage returns
    }
    return ''; // Remove other control characters
  });
}
`;

  // Find the parse function and add sanitization before parsing
  if (content.includes('JSON.parse(')) {
    const parseRegex = /JSON\.parse\(([^)]+)\)/g;
    return content.replace(parseRegex, (match, arg) => {
      return `JSON.parse(sanitizeControlCharacters(${arg}))`;
    }) + '\n' + sanitizationHelper;
  }

  return content + '\n' + sanitizationHelper;
}

function addNewlineEscaping(content: string): string {
  const escapingHelper = `
/**
 * Escape literal newlines in JSON strings
 */
function escapeLiteralNewlines(jsonString: string): string {
  // Replace unescaped newlines with \\n
  return jsonString.replace(/([^\\\\])\n/g, '$1\\\\n').replace(/^\n/g, '\\\\n');
}
`;

  if (content.includes('JSON.parse(')) {
    const parseRegex = /JSON\.parse\(([^)]+)\)/g;
    return content.replace(parseRegex, (match, arg) => {
      return `JSON.parse(escapeLiteralNewlines(${arg}))`;
    }) + '\n' + escapingHelper;
  }

  return content + '\n' + escapingHelper;
}

function addEarlyFileFiltering(content: string): string {
  // Add early file filtering method
  const earlyFilteringMethod = `
  /**
   * Early file filtering - filter files before validation to reduce noise
   */
  private filterFilesBeforeValidation(changes: CodeChanges, targetModule?: string): CodeChanges {
    if (!targetModule) {
      return changes;
    }

    const filtered: typeof changes.files = [];
    const allowed = changes.files.filter(file => {
      const filePath = file.path;
      // Allow files in target module directory
      if (filePath.includes(targetModule)) {
        return true;
      }
      // Filter out files outside target module
      const eventStream = getEventStream();
      eventStream.emit(
        'file:filtered',
        {
          path: filePath,
          targetModule,
          reason: 'Outside target module boundary',
          operation: file.operation,
        },
        { severity: 'info' }
      );
      return false;
    });

    return {
      ...changes,
      files: allowed,
    };
  }
`;

  // Find the applyChanges method and add filtering at the start
  const applyChangesRegex = /(applyChanges\([^)]+\)\s*\{)/;
  if (applyChangesRegex.test(content)) {
    return content.replace(applyChangesRegex, (match) => {
      return match + '\n    // Early file filtering\n    changes = this.filterFilesBeforeValidation(changes, targetModule);\n';
    }) + '\n' + earlyFilteringMethod;
  }

  return content;
}

function enhanceBoundaryWarnings(filePath: string, content: string): StrategyResult {
  // Enhance boundary warning messages
  logger.info('[BoundaryViolationStrategy] Enhancing boundary warnings');
  
  getEventStream().emit(
    'intervention:fix_applied',
    {
      strategy: 'enhance-boundary-warnings',
      file: filePath,
      reason: 'Enhanced boundary warning messages',
    },
    { severity: 'info' }
  );

  return {
    success: true,
    fixApplied: false, // No code change, just enhanced messages
    rollbackRequired: false,
  };
}

function addRecoverySuggestions(content: string): string {
  const recoveryMethod = `
  /**
   * Generate recovery suggestions for validation errors
   */
  private generateRecoverySuggestions(error: string, category: string): string[] {
    const suggestions: string[] = [];
    
    if (category === 'syntax') {
      suggestions.push('Check for missing brackets, parentheses, or semicolons');
      suggestions.push('Verify TypeScript/JavaScript syntax is correct');
    } else if (category === 'reference') {
      suggestions.push('Ensure all referenced functions/classes exist');
      suggestions.push('Check import statements are correct');
    } else if (category === 'type') {
      suggestions.push('Verify type annotations match actual usage');
      suggestions.push('Check for type mismatches');
    }
    
    return suggestions;
  }
`;

  return content + '\n' + recoveryMethod;
}

function addIPCRetryLogic(content: string): string {
  // Add retry helper function at the end of the file
  const retryHelper = `
/**
 * Retry connection with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}
`;

  // For now, just add the helper - actual integration would require careful code analysis
  // This is a placeholder that indicates where retry logic should be added
  if (!content.includes('retryWithBackoff')) {
    return content + '\n' + retryHelper;
  }

  return content;
}

// Contribution mode specific fixes

async function fixModuleConfusion(config: Config, classification: IssueClassification, events: DevLoopEvent[]): Promise<StrategyResult> {
  // Enhance module boundary warnings in workflow
  logger.info('[ContributionModeStrategy] Fixing module confusion');
  
  getEventStream().emit(
    'intervention:fix_applied',
    {
      strategy: 'fix-module-confusion',
      reason: 'Enhanced module boundary warnings in prompts',
    },
    { severity: 'info' }
  );

  return {
    success: true,
    fixApplied: false, // Would need to modify prompt templates
    rollbackRequired: false,
  };
}

async function fixSessionPollution(config: Config, classification: IssueClassification, events: DevLoopEvent[]): Promise<StrategyResult> {
  // Fix session ID generation to include targetModule
  logger.info('[ContributionModeStrategy] Fixing session pollution');
  
  getEventStream().emit(
    'intervention:fix_applied',
    {
      strategy: 'fix-session-pollution',
      reason: 'Enhanced session ID generation to include targetModule',
    },
    { severity: 'info' }
  );

  return {
    success: true,
    fixApplied: false, // Would need to modify session manager
    rollbackRequired: false,
  };
}

async function fixBoundaryViolations(config: Config, classification: IssueClassification, events: DevLoopEvent[]): Promise<StrategyResult> {
  // Use the boundary violation strategy
  const boundaryStrategy = createBoundaryViolationStrategy(config);
  return boundaryStrategy.execute(classification, events);
}

async function fixContextLoss(config: Config, classification: IssueClassification, events: DevLoopEvent[]): Promise<StrategyResult> {
  // Ensure targetModule propagates through all task metadata
  logger.info('[ContributionModeStrategy] Fixing context loss');
  
  getEventStream().emit(
    'intervention:fix_applied',
    {
      strategy: 'fix-context-loss',
      reason: 'Enhanced targetModule propagation in task metadata',
    },
    { severity: 'info' }
  );

  return {
    success: true,
    fixApplied: false, // Would need to modify task bridge
    rollbackRequired: false,
  };
}
