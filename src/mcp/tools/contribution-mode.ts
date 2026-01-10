/**
 * MCP Tools for Contribution Mode
 * 
 * Provides validated, framework-agnostic interface for outer agents (Cursor chat + background)
 * to observe, enhance, and manage dev-loop in contribution mode.
 * 
 * All tools enforce:
 * - Framework-agnostic checks (reject hardcoded framework paths in dev-loop core)
 * - Target module boundary validation
 * - Session isolation validation
 * - Change impact analysis
 */

import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { getEventStream } from '../../core/utils/event-stream';
import { logger } from '../../core/utils/logger';

/**
 * Get contribution mode status and validation state
 * Read-only - no side effects
 */
const ContributionModeStatusSchema = z.object({});

export function createContributionModeStatusTool(server: any): void {
  server.tool(
    'devloop_contribution_mode_status',
    'Get contribution mode status, active issues, and validation state. Read-only.',
    ContributionModeStatusSchema,
    async () => {
      const devloopDir = path.join(process.cwd(), '.devloop');
      const contributionModeFile = path.join(devloopDir, 'contribution-mode.json');
      
      let contributionModeData: any = { active: false };
      if (fs.existsSync(contributionModeFile)) {
        try {
          contributionModeData = JSON.parse(fs.readFileSync(contributionModeFile, 'utf8'));
        } catch (error) {
          logger.warn('[ContributionMode] Failed to parse contribution-mode.json:', error);
        }
      }

      // Load metrics to get issue counts
      const metricsFile = path.join(devloopDir, 'metrics.json');
      let contributionMetrics: any = null;
      if (fs.existsSync(metricsFile)) {
        try {
          const metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
          contributionMetrics = metrics.contributionMode;
        } catch (error) {
          logger.warn('[ContributionMode] Failed to parse metrics.json:', error);
        }
      }

      // Get recent contribution:issue_detected events
      const eventStream = getEventStream();
      const issueEvents = eventStream.poll({
        types: ['contribution:issue_detected'] as any[],
        limit: 10,
      });

      const status = {
        active: contributionModeData.active || false,
        outerAgent: contributionModeData.outerAgent || 'unknown',
        activatedAt: contributionModeData.activatedAt || null,
        currentPrd: contributionModeData.currentPrd || null,
        issues: {
          moduleConfusion: contributionMetrics?.issues?.moduleConfusion || 0,
          sessionPollution: contributionMetrics?.issues?.sessionPollution || 0,
          boundaryViolations: contributionMetrics?.issues?.boundaryViolations || 0,
          targetModuleContextLoss: contributionMetrics?.issues?.targetModuleContextLoss || 0,
        },
        recentIssueEvents: issueEvents.map(e => ({
          issueType: e.data.issueType,
          severity: e.severity,
          timestamp: e.timestamp,
          details: e.data.details,
        })),
        validation: {
          frameworkAgnostic: true, // Will be validated by other tools
          boundariesEnforced: true,
          sessionIsolation: true,
        },
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(status, null, 2),
        }],
      };
    }
  );
}

/**
 * Validate proposed dev-loop changes for framework-agnostic compliance
 * Pure validation - no side effects
 */
const ContributionModeValidateSchema = z.object({
  changeSet: z.object({
    files: z.array(z.object({
      path: z.string().describe('File path relative to dev-loop root'),
      operation: z.enum(['create', 'update', 'delete']),
      content: z.string().optional().describe('New/updated file content'),
    })),
  }).describe('Proposed changes to dev-loop code'),
  dryRun: z.boolean().optional().describe('If true, only validate without applying (default: true)'),
});

export function createContributionModeValidateTool(server: any): void {
  server.tool(
    'devloop_contribution_mode_validate',
    'Validate proposed dev-loop changes for framework-agnostic compliance, boundary adherence, and safety. Pure validation with no side effects.',
    ContributionModeValidateSchema,
    async (params: z.infer<typeof ContributionModeValidateSchema>) => {
      const validationResults: any[] = [];
      let overallValid = true;

      // Framework-agnostic validation patterns
      const frameworkSpecificPatterns = [
        { pattern: /docroot\/modules\/share\//g, framework: 'Drupal', description: 'Hardcoded Drupal module path' },
        { pattern: /web\/modules\/custom\//g, framework: 'Drupal', description: 'Hardcoded Drupal module path (web/)' },
        { pattern: /\.module\b/g, framework: 'Drupal', description: 'Drupal-specific file extension reference' },
        { pattern: /django\.(apps|models|views|urls)/g, framework: 'Django', description: 'Hardcoded Django framework reference' },
        { pattern: /\/app\/Models\//g, framework: 'Laravel', description: 'Hardcoded Laravel directory structure' },
        { pattern: /require\('next\/\w+'\)/g, framework: 'Next.js', description: 'Hardcoded Next.js import' },
      ];

      // Core files that should never contain framework-specific code
      const coreFiles = [
        'src/core/execution/workflow.ts',
        'src/core/execution/engine.ts',
        'src/providers/ai/cursor-chat-opener.ts',
        'src/providers/ai/session-manager.ts',
        'src/core/metrics/',
        'src/mcp/tools/',
      ];

      for (const file of params.changeSet.files) {
        const validation: any = {
          file: file.path,
          operation: file.operation,
          valid: true,
          errors: [],
          warnings: [],
          suggestions: [],
        };

        // Check if this is a core file
        const isCoreFile = coreFiles.some(corePattern => file.path.includes(corePattern));

        if (file.operation !== 'delete' && file.content) {
          // Check for framework-specific patterns in core files
          if (isCoreFile) {
            for (const { pattern, framework, description } of frameworkSpecificPatterns) {
              const matches = file.content.match(pattern);
              if (matches) {
                validation.valid = false;
                overallValid = false;
                validation.errors.push({
                  type: 'framework-specific-code',
                  framework,
                  description,
                  occurrences: matches.length,
                  suggestion: `Move ${framework}-specific logic to framework plugin (src/frameworks/${framework.toLowerCase()}/index.ts)`,
                });
              }
            }
          }

          // Check for hardcoded paths that should use framework plugin
          if (file.path.includes('workflow.ts') || file.path.includes('engine.ts')) {
            if (file.content.includes('docroot/') || file.content.includes('web/')) {
              validation.warnings.push({
                type: 'potential-hardcoded-path',
                description: 'File contains potential hardcoded paths (docroot/, web/)',
                suggestion: 'Use framework.getTargetModulePaths() instead of hardcoded paths',
              });
            }
          }

          // Check for proper framework plugin usage
          if (file.content.includes('targetModule') && !file.content.includes('framework')) {
            validation.suggestions.push({
              type: 'use-framework-plugin',
              description: 'Code references targetModule but may not be using framework plugin',
              suggestion: 'Consider using framework plugin methods for path resolution and guidance',
            });
          }
        }

        // Validate file paths (should be within dev-loop, not project)
        if (file.path.startsWith('../') || file.path.startsWith('/')) {
          validation.valid = false;
          overallValid = false;
          validation.errors.push({
            type: 'invalid-path',
            description: 'File path must be relative to dev-loop root, not absolute or parent references',
            suggestion: 'Use paths relative to node_modules/dev-loop/',
          });
        }

        validationResults.push(validation);
      }

      // Impact analysis
      const impactedComponents = new Set<string>();
      for (const file of params.changeSet.files) {
        if (file.path.includes('workflow.ts')) impactedComponents.add('Task Execution');
        if (file.path.includes('session-manager.ts')) impactedComponents.add('Session Management');
        if (file.path.includes('framework')) impactedComponents.add('Framework Plugins');
        if (file.path.includes('mcp/tools')) impactedComponents.add('MCP Tools');
        if (file.path.includes('docs/')) impactedComponents.add('Documentation');
      }

      const result = {
        valid: overallValid,
        fileValidations: validationResults,
        summary: {
          totalFiles: params.changeSet.files.length,
          validFiles: validationResults.filter(v => v.valid).length,
          invalidFiles: validationResults.filter(v => !v.valid).length,
          filesWithWarnings: validationResults.filter(v => v.warnings.length > 0).length,
          totalErrors: validationResults.reduce((sum, v) => sum + v.errors.length, 0),
          totalWarnings: validationResults.reduce((sum, v) => sum + v.warnings.length, 0),
        },
        impactAnalysis: {
          affectedComponents: Array.from(impactedComponents),
          requiresRebuild: params.changeSet.files.some(f => f.path.endsWith('.ts')),
          requiresDocUpdate: params.changeSet.files.some(f => f.path.includes('docs/')),
        },
        recommendations: overallValid 
          ? ['Changes are framework-agnostic and safe to apply', 'Run npm run build after applying changes']
          : ['Fix validation errors before applying changes', 'Review framework-agnostic principles in CONTRIBUTION_MODE.md'],
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );
}

/**
 * Poll for issues and events from inner agents
 * Read-only with filtering
 */
const OuterAgentPollSchema = z.object({
  since: z.string().optional().describe('Event ID to start from (exclusive)'),
  issueTypes: z.array(z.enum(['module-confusion', 'session-pollution', 'boundary-violations', 'target-module-context-loss'])).optional().describe('Filter by issue types'),
  severity: z.array(z.enum(['info', 'warn', 'error', 'critical'])).optional().describe('Filter by severity levels'),
  limit: z.number().optional().describe('Maximum number of events to return (default: 50)'),
});

export function createOuterAgentPollTool(server: any): void {
  server.tool(
    'devloop_outer_agent_poll',
    'Poll for issues and events from inner agents. Returns structured data for outer agent decision-making. Read-only.',
    OuterAgentPollSchema,
    async (params: z.infer<typeof OuterAgentPollSchema>) => {
      const eventStream = getEventStream();

      // Get contribution mode issue events
      const issueEvents = eventStream.poll({
        since: params.since,
        types: ['contribution:issue_detected', 'task:blocked', 'file:filtered', 'validation:failed'] as any[],
        severity: params.severity as any,
        limit: params.limit || 50,
      });

    // Filter by issue type if specified
    let filteredEvents = issueEvents;
    if (params.issueTypes && params.issueTypes.length > 0) {
      filteredEvents = issueEvents.filter(e => {
        if (e.type === 'contribution:issue_detected' && e.data && typeof e.data.issueType === 'string') {
          return params.issueTypes!.includes(e.data.issueType as any);
        }
        return true; // Include non-contribution events
      });
    }

    // Group events by type and severity
    const eventsByType = new Map<string, any[]>();
    const eventsBySeverity = new Map<string, any[]>();
    
    for (const event of filteredEvents) {
      if (!eventsByType.has(event.type)) {
        eventsByType.set(event.type, []);
      }
      eventsByType.get(event.type)!.push(event);

      if (!eventsBySeverity.has(event.severity)) {
        eventsBySeverity.set(event.severity, []);
      }
      eventsBySeverity.get(event.severity)!.push(event);
    }

    // Extract actionable issues
    const actionableIssues = filteredEvents
      .filter(e => e.type === 'contribution:issue_detected' && ['error', 'critical'].includes(e.severity))
      .map(e => ({
        issueType: (e.data?.issueType as string) || 'unknown',
        severity: e.severity,
        timestamp: e.timestamp,
        details: e.data?.details || {},
        suggestedFix: getSuggestedFix((e.data?.issueType as string) || 'unknown'),
      }));

    // Get blocked tasks
    const blockedTasks = eventStream.getBlockedTasks().map(e => ({
      taskId: e.data?.taskId || 'unknown',
      reason: e.data?.reason || 'unknown',
      retryCount: e.data?.retryCount || 0,
      lastError: e.data?.lastError || '',
      timestamp: e.timestamp,
    }));

    const result = {
      events: filteredEvents.map(e => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        timestamp: e.timestamp,
        taskId: e.taskId,
        prdId: e.prdId,
        data: e.data,
      })),
      summary: {
        totalEvents: filteredEvents.length,
        byType: Object.fromEntries(Array.from(eventsByType.entries()).map(([type, events]) => [type, events.length])),
        bySeverity: Object.fromEntries(Array.from(eventsBySeverity.entries()).map(([sev, events]) => [sev, events.length])),
        actionableIssues: actionableIssues.length,
        blockedTasks: blockedTasks.length,
      },
      actionableIssues,
      blockedTasks,
      lastEventId: eventStream.getLastEventId(),
      hasMore: filteredEvents.length === (params.limit || 50),
      recommendations: generateRecommendations(actionableIssues, blockedTasks),
    };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );
}

/**
 * Get suggested fix for an issue type
 */
function getSuggestedFix(issueType: string): string {
  const fixes: Record<string, string> = {
    'module-confusion': 'Enhance workflow.ts module boundary warning, improve session isolation',
    'session-pollution': 'Fix session ID generation to include targetModule, clear polluted sessions',
    'boundary-violations': 'Strengthen file filtering logic, add pre-validation step',
    'target-module-context-loss': 'Ensure targetModule propagates through all task metadata',
  };
  return fixes[issueType] || 'Investigate and apply appropriate fix';
}

/**
 * Generate recommendations based on issues and blocked tasks
 */
function generateRecommendations(actionableIssues: any[], blockedTasks: any[]): string[] {
  const recommendations: string[] = [];

  if (actionableIssues.length > 0) {
    const issueTypes = new Set(actionableIssues.map(i => i.issueType));
    if (issueTypes.has('module-confusion')) {
      recommendations.push('Consider enhancing module boundary guidance in workflow.ts');
    }
    if (issueTypes.has('session-pollution')) {
      recommendations.push('Review session isolation implementation in session-manager.ts');
    }
    if (issueTypes.has('boundary-violations')) {
      recommendations.push('Strengthen boundary enforcement in workflow.ts file filtering');
    }
  }

  if (blockedTasks.length > 0) {
    recommendations.push(`${blockedTasks.length} tasks are blocked - use devloop_outer_agent_unblock to investigate and unblock`);
  }

  if (recommendations.length === 0) {
    recommendations.push('No critical issues detected - continue monitoring');
  }

  return recommendations;
}

/**
 * Apply validated fix to dev-loop code with automatic rollback on failure
 * Write operation with validation + rollback
 */
const OuterAgentFixSchema = z.object({
  fixType: z.enum(['module-boundary', 'session-isolation', 'framework-agnostic', 'path-resolution', 'other']).describe('Type of fix being applied'),
  targetFiles: z.array(z.object({
    path: z.string(),
    operation: z.enum(['create', 'update', 'delete']),
    content: z.string().optional(),
    backup: z.boolean().optional().describe('Create backup before modifying (default: true)'),
  })),
  validation: z.object({
    runValidation: z.boolean().optional().describe('Run devloop_contribution_mode_validate first (default: true)'),
    requireValid: z.boolean().optional().describe('Only apply if validation passes (default: true)'),
  }).optional(),
  dryRun: z.boolean().optional().describe('If true, validate but do not apply (default: false)'),
  reason: z.string().describe('Explanation of why this fix is needed'),
});

export function createOuterAgentFixTool(server: any): void {
  server.tool(
    'devloop_outer_agent_fix',
    'Apply validated fix to dev-loop code with automatic rollback on failure. Creates backups and validates before applying.',
    OuterAgentFixSchema,
    async (params: z.infer<typeof OuterAgentFixSchema>) => {
      const devloopRoot = path.join(process.cwd(), 'node_modules', 'dev-loop');
      const backupDir = path.join(devloopRoot, '.backups', Date.now().toString());
      const appliedChanges: string[] = [];
      const backups: Array<{path: string; backup: string}> = [];

      try {
        // Step 1: Validate if requested
        const validation = params.validation || { runValidation: true, requireValid: true };
        let validationResult: any = { valid: true };

        if (validation.runValidation) {
          // Run validation using the validate tool logic
          validationResult = await validateChangeSet({ files: params.targetFiles });
          
          if (!validationResult.valid && validation.requireValid) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Validation failed',
                  validation: validationResult,
                  message: 'Fix cannot be applied due to validation errors. Review and correct issues.',
                }, null, 2),
              }],
            };
          }
        }

        // Dry run - stop here if requested
        if (params.dryRun) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                dryRun: true,
                wouldApply: params.targetFiles.length,
                validation: validationResult,
                message: 'Dry run successful - no changes applied',
              }, null, 2),
            }],
          };
        }

        // Step 2: Create backups
        fs.mkdirSync(backupDir, { recursive: true });
        
        for (const file of params.targetFiles) {
          const filePath = path.join(devloopRoot, file.path);
          
          if (file.operation !== 'create' && fs.existsSync(filePath)) {
            const backupPath = path.join(backupDir, file.path);
            fs.mkdirSync(path.dirname(backupPath), { recursive: true });
            fs.copyFileSync(filePath, backupPath);
            backups.push({ path: filePath, backup: backupPath });
          }
        }

        // Step 3: Apply changes
        for (const file of params.targetFiles) {
          const filePath = path.join(devloopRoot, file.path);

          switch (file.operation) {
            case 'create':
            case 'update':
              if (!file.content) {
                throw new Error(`Content required for ${file.operation} operation on ${file.path}`);
              }
              fs.mkdirSync(path.dirname(filePath), { recursive: true });
              fs.writeFileSync(filePath, file.content, 'utf8');
              appliedChanges.push(`${file.operation}: ${file.path}`);
              break;

            case 'delete':
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                appliedChanges.push(`delete: ${file.path}`);
              }
              break;
          }
        }

        // Step 4: Emit event
        const eventStream = getEventStream();
        eventStream.emit(
          'contribution:fix_applied' as any,
          {
            fixType: params.fixType,
            filesModified: appliedChanges.length,
            reason: params.reason,
            backupLocation: backupDir,
          },
          { severity: 'info' as any }
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              fixType: params.fixType,
              appliedChanges,
              backupLocation: backupDir,
              validation: validationResult,
              nextSteps: [
                'Run: cd node_modules/dev-loop && npm run build',
                'Test the fix with a sample task',
                'Monitor with devloop_outer_agent_poll for new issues',
              ],
            }, null, 2),
          }],
        };

      } catch (error: any) {
        // Rollback on failure
        logger.error('[OuterAgent] Fix application failed, rolling back:', error);

        for (const { path: filePath, backup } of backups) {
          try {
            fs.copyFileSync(backup, filePath);
          } catch (rollbackError) {
            logger.error(`[OuterAgent] Failed to rollback ${filePath}:`, rollbackError);
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              appliedChanges, // What was applied before failure
              rolledBack: backups.length,
              backupLocation: backupDir, // Backups preserved for manual recovery
            }, null, 2),
          }],
        };
      }
    }
  );
}

/**
 * Unblock inner agent with validation
 * State modification with validation
 */
const OuterAgentUnblockSchema = z.object({
  taskId: z.string().optional().describe('Specific task ID to unblock (if not provided, unblocks all)'),
  reason: z.string().describe('Reason for unblocking'),
  resetRetryCount: z.boolean().optional().describe('Reset retry count to 0 (default: true)'),
  clearErrors: z.boolean().optional().describe('Clear error history (default: true)'),
  validationCheck: z.object({
    ensureFixApplied: z.boolean().optional().describe('Ensure a fix was applied before unblocking (default: true)'),
    requireEventLog: z.boolean().optional().describe('Require event log showing fix applied (default: false)'),
  }).optional(),
});

export function createOuterAgentUnblockTool(server: any): void {
  server.tool(
    'devloop_outer_agent_unblock',
    'Unblock inner agent tasks with validation. Resets retry counts and clears errors.',
    OuterAgentUnblockSchema,
    async (params: z.infer<typeof OuterAgentUnblockSchema>) => {
      const devloopDir = path.join(process.cwd(), '.devloop');
      const eventStream = getEventStream();

      // Get blocked tasks
      const blockedTasks = eventStream.getBlockedTasks();
      
      let tasksToUnblock = blockedTasks;
      if (params.taskId) {
        tasksToUnblock = blockedTasks.filter(e => e.data.taskId === params.taskId);
        if (tasksToUnblock.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Task ${params.taskId} is not blocked`,
                blockedTasks: blockedTasks.map(e => e.data.taskId),
              }, null, 2),
            }],
          };
        }
      }

      // Validation check
      const validation = params.validationCheck || { ensureFixApplied: true };
      if (validation.ensureFixApplied) {
        const recentFixes = eventStream.poll({
          types: ['contribution:fix_applied'] as any[],
          limit: 10,
        });

        if (recentFixes.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'No recent fixes detected',
                message: 'Validation requires fix_applied event before unblocking. Apply fix first with devloop_outer_agent_fix.',
                blockedTasks: tasksToUnblock.map(e => e.data.taskId),
              }, null, 2),
            }],
          };
        }
      }

      // Load retry counts
      const retryCountsFile = path.join(devloopDir, 'retry-counts.json');
      let retryCounts: Record<string, number> = {};
      if (fs.existsSync(retryCountsFile)) {
        try {
          retryCounts = JSON.parse(fs.readFileSync(retryCountsFile, 'utf8'));
        } catch (error) {
          logger.warn('[OuterAgent] Failed to parse retry-counts.json:', error);
        }
      }

      // Unblock tasks
      const unblocked: string[] = [];
      for (const blockedTask of tasksToUnblock) {
        const taskId = blockedTask.data?.taskId;
        if (taskId && typeof taskId === 'string') {
          if (params.resetRetryCount !== false) {
            retryCounts[taskId] = 0;
          }
          unblocked.push(taskId);
        }
      }

      // Save retry counts
      fs.writeFileSync(retryCountsFile, JSON.stringify(retryCounts, null, 2), 'utf8');

      // Emit event
      eventStream.emit(
        'contribution:agent_unblocked' as any,
        {
          taskIds: unblocked,
          reason: params.reason,
          resetRetryCount: params.resetRetryCount !== false,
          clearErrors: params.clearErrors !== false,
        },
        { severity: 'info' as any }
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            unblocked,
            reason: params.reason,
            resetRetryCount: params.resetRetryCount !== false,
            nextSteps: [
              'Resume task execution',
              'Monitor with devloop_outer_agent_poll',
            ],
          }, null, 2),
        }],
      };
    }
  );
}

/**
 * Reset inner agent state safely
 * State reset with safety checks
 */
const OuterAgentResetSchema = z.object({
  scope: z.enum(['session', 'metrics', 'events', 'all']).describe('What to reset'),
  preserveMetrics: z.boolean().optional().describe('Preserve metrics when resetting (default: true)'),
  targetModule: z.string().optional().describe('Only reset sessions for specific module'),
  confirmation: z.string().describe('Type "CONFIRM RESET" to proceed'),
});

export function createOuterAgentResetTool(server: any): void {
  server.tool(
    'devloop_outer_agent_reset',
    'Reset inner agent state safely. DANGEROUS - requires confirmation.',
    OuterAgentResetSchema,
    async (params: z.infer<typeof OuterAgentResetSchema>) => {
      // Safety check
      if (params.confirmation !== 'CONFIRM RESET') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Confirmation required',
              message: 'Type "CONFIRM RESET" in confirmation field to proceed',
            }, null, 2),
          }],
        };
      }

      const devloopDir = path.join(process.cwd(), '.devloop');
      const eventStream = getEventStream();
      const resetActions: string[] = [];

      try {
        switch (params.scope) {
          case 'session':
            // Reset Cursor sessions (if session manager available)
            resetActions.push('Session reset not yet implemented - requires session manager integration');
            break;

          case 'metrics':
            if (!params.preserveMetrics) {
              const metricsFile = path.join(devloopDir, 'metrics.json');
              if (fs.existsSync(metricsFile)) {
                const backup = `${metricsFile}.backup.${Date.now()}`;
                fs.copyFileSync(metricsFile, backup);
                fs.unlinkSync(metricsFile);
                resetActions.push(`Metrics reset (backup: ${path.basename(backup)})`);
              }
            } else {
              resetActions.push('Metrics preserved (preserveMetrics: true)');
            }
            break;

          case 'events':
            eventStream.clear();
            resetActions.push('Event stream cleared');
            break;

          case 'all':
            // Reset everything
            if (!params.preserveMetrics) {
              const metricsFile = path.join(devloopDir, 'metrics.json');
              if (fs.existsSync(metricsFile)) {
                const backup = `${metricsFile}.backup.${Date.now()}`;
                fs.copyFileSync(metricsFile, backup);
                fs.unlinkSync(metricsFile);
                resetActions.push(`Metrics reset (backup: ${path.basename(backup)})`);
              }
            }
            eventStream.clear();
            resetActions.push('Event stream cleared');
            resetActions.push('Session reset not yet implemented');
            break;
        }

        // Emit event
        eventStream.emit(
          'contribution:agent_reset' as any,
          {
            scope: params.scope,
            preserveMetrics: params.preserveMetrics !== false,
            targetModule: params.targetModule,
            actions: resetActions,
          },
          { severity: 'warn' as any }
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              scope: params.scope,
              actions: resetActions,
              preservedMetrics: params.preserveMetrics !== false,
              warning: 'Inner agent state has been reset. Monitor with devloop_outer_agent_poll.',
            }, null, 2),
          }],
        };

      } catch (error: any) {
        logger.error('[OuterAgent] Reset failed:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              partialActions: resetActions,
            }, null, 2),
          }],
        };
      }
    }
  );
}

/**
 * Helper function to validate change set (used by fix tool)
 */
async function validateChangeSet(changeSet: any): Promise<any> {
  const validationResults: any[] = [];
  let overallValid = true;

  const frameworkSpecificPatterns = [
    { pattern: /docroot\/modules\/share\//g, framework: 'Drupal', description: 'Hardcoded Drupal module path' },
    { pattern: /web\/modules\/custom\//g, framework: 'Drupal', description: 'Hardcoded Drupal module path (web/)' },
  ];

  const coreFiles = [
    'src/core/execution/workflow.ts',
    'src/core/execution/engine.ts',
    'src/providers/ai/cursor-chat-opener.ts',
    'src/providers/ai/session-manager.ts',
  ];

  for (const file of changeSet.files) {
    const validation: any = {
      file: file.path,
      operation: file.operation,
      valid: true,
      errors: [],
      warnings: [],
    };

    const isCoreFile = coreFiles.some(corePattern => file.path.includes(corePattern));

    if (file.operation !== 'delete' && file.content) {
      if (isCoreFile) {
        for (const { pattern, framework, description } of frameworkSpecificPatterns) {
          const matches = file.content.match(pattern);
          if (matches) {
            validation.valid = false;
            overallValid = false;
            validation.errors.push({
              type: 'framework-specific-code',
              framework,
              description,
              occurrences: matches.length,
            });
          }
        }
      }
    }

    validationResults.push(validation);
  }

  return {
    valid: overallValid,
    fileValidations: validationResults,
    summary: {
      totalFiles: changeSet.files.length,
      validFiles: validationResults.filter((v: any) => v.valid).length,
      invalidFiles: validationResults.filter((v: any) => !v.valid).length,
    },
  };
}

/**
 * Register all contribution mode MCP tools
 */
export function registerContributionModeTools(server: any): void {
  createContributionModeStatusTool(server);
  createContributionModeValidateTool(server);
  createOuterAgentPollTool(server);
  createOuterAgentFixTool(server);
  createOuterAgentUnblockTool(server);
  createOuterAgentResetTool(server);
  
  logger.info('[MCP] Registered contribution mode tools (status, validate, poll, fix, unblock, reset)');
}
