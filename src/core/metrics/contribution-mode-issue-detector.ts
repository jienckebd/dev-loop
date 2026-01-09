/**
 * Contribution Mode Issue Detector
 * 
 * Detects contribution mode specific issues:
 * - Module confusion (agents targeting wrong modules)
 * - Session pollution (sessions shared across PRD sets with different target modules)
 * - Boundary violations (repeated boundary violations)
 * - Target module context loss (tasks without target module context)
 */

import { ContributionModeMetrics } from './types';
import { PrdMetrics } from './prd';
import { emitEvent } from '../utils/event-stream';
import { logger } from '../utils/logger';

export interface ModuleConfusionIncident {
  taskId: string;
  targetModule: string;
  wrongModule: string;
  timestamp: string;
}

export interface SessionPollutionIncident {
  sessionId: string;
  modules: string[];
  taskIds: string[];
  timestamp: string;
}

export class ContributionModeIssueDetector {
  private prdMetrics?: PrdMetrics;
  private debug: boolean;
  
  // Tracking state
  private fileOperationsByModule: Map<string, { total: number; filtered: number; violations: number }> = new Map();
  private sessionsByModule: Map<string, Set<string>> = new Map(); // module -> Set of session IDs
  private moduleBySession: Map<string, string> = new Map(); // session ID -> module
  private tasksWithoutTargetModule: number = 0;
  private totalTasks: number = 0;

  constructor(prdMetrics?: PrdMetrics, debug: boolean = false) {
    this.prdMetrics = prdMetrics;
    this.debug = debug;
  }

  /**
   * Track a file filtering event for module confusion detection
   */
  trackFileFiltered(taskId: string, targetModule: string, wrongModule: string, prdId: string): void {
    if (!targetModule) return;

    // Initialize tracking for target module
    if (!this.fileOperationsByModule.has(targetModule)) {
      this.fileOperationsByModule.set(targetModule, { total: 0, filtered: 0, violations: 0 });
    }

    const stats = this.fileOperationsByModule.get(targetModule)!;
    stats.total++;
    stats.filtered++;
    
    // Detect module confusion
    if (wrongModule && wrongModule !== targetModule) {
      stats.violations++;
      
      // Record incident
      this.recordModuleConfusionIncident(taskId, targetModule, wrongModule, prdId);
      
      if (this.debug) {
        logger.debug(`[IssueDetector] Module confusion detected: task ${taskId} targeted ${wrongModule} instead of ${targetModule}`);
      }
    }
  }

  /**
   * Track a file operation (allowed or filtered) for boundary violation rate calculation
   */
  trackFileOperation(targetModule: string, allowed: boolean, violation: boolean = false): void {
    if (!targetModule) return;

    if (!this.fileOperationsByModule.has(targetModule)) {
      this.fileOperationsByModule.set(targetModule, { total: 0, filtered: 0, violations: 0 });
    }

    const stats = this.fileOperationsByModule.get(targetModule)!;
    stats.total++;
    
    if (!allowed) {
      stats.filtered++;
    }
    
    if (violation) {
      stats.violations++;
    }
  }

  /**
   * Track session usage for session pollution detection
   */
  trackSessionUsage(sessionId: string, targetModule: string, taskId: string, prdId: string): void {
    if (!targetModule || !sessionId) return;

    // Track which modules use which sessions
    if (!this.sessionsByModule.has(targetModule)) {
      this.sessionsByModule.set(targetModule, new Set());
    }
    this.sessionsByModule.get(targetModule)!.add(sessionId);

    // Check if session was previously used for different module
    const previousModule = this.moduleBySession.get(sessionId);
    if (previousModule && previousModule !== targetModule) {
      // Session pollution detected
      this.recordSessionPollutionIncident(sessionId, [previousModule, targetModule], [taskId], prdId);
      
      if (this.debug) {
        logger.warn(`[IssueDetector] Session pollution detected: session ${sessionId} used for ${previousModule} and ${targetModule}`);
      }
    }

    // Update session -> module mapping
    this.moduleBySession.set(sessionId, targetModule);
  }

  /**
   * Track task execution for context loss detection
   */
  trackTaskExecution(hasTargetModule: boolean): void {
    this.totalTasks++;
    
    if (!hasTargetModule) {
      this.tasksWithoutTargetModule++;
    }
  }

  /**
   * Record module confusion incident
   */
  private recordModuleConfusionIncident(taskId: string, targetModule: string, wrongModule: string, prdId: string): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric) return;

    // Ensure contribution mode metrics exist
    if (!prdMetric.contributionMode) {
      prdMetric.contributionMode = {
        outerAgentObservations: 0,
        devLoopFixesApplied: 0,
        fixesByCategory: {},
        rootCauseFixes: 0,
        workaroundFixes: 0,
        sessionDuration: 0,
        improvementsIdentified: 0,
        issues: {
          moduleConfusion: {
            detected: false,
            filteredFileRate: 0,
            totalFileOperations: 0,
            incidents: [],
            alertThreshold: 0.10,
          },
          sessionPollution: {
            detected: false,
            sessionsWithMultipleModules: 0,
            incidents: [],
          },
          boundaryViolations: {
            total: 0,
            rate: 0,
            byPattern: {},
            alertThreshold: 0.05,
          },
          targetModuleContextLoss: {
            detected: false,
            tasksWithoutTargetModule: 0,
            totalTasks: 0,
            rate: 0,
            alertThreshold: 0.01,
          },
        },
      };
    }

    const metrics = prdMetric.contributionMode.issues.moduleConfusion;
    
    // Record incident
    const incident: ModuleConfusionIncident = {
      taskId,
      targetModule,
      wrongModule,
      timestamp: new Date().toISOString(),
    };
    metrics.incidents.push(incident);
    
    // Keep only last 100 incidents
    if (metrics.incidents.length > 100) {
      metrics.incidents = metrics.incidents.slice(-100);
    }

    // Update stats
    const stats = this.fileOperationsByModule.get(targetModule) || { total: 0, filtered: 0, violations: 0 };
    metrics.totalFileOperations = stats.total;
    metrics.filteredFileRate = stats.total > 0 ? stats.filtered / stats.total : 0;
    metrics.detected = metrics.filteredFileRate > metrics.alertThreshold;

    // Emit alert if threshold exceeded
    if (metrics.detected && metrics.incidents.length === 1) {
      emitEvent('contribution:issue_detected', {
        issueType: 'module-confusion',
        targetModule,
        filteredFileRate: metrics.filteredFileRate,
        alertThreshold: metrics.alertThreshold,
        totalOperations: stats.total,
        filteredOperations: stats.filtered,
      }, {
        severity: 'warn',
        prdId,
        targetModule,
      });
    }
  }

  /**
   * Record session pollution incident
   */
  private recordSessionPollutionIncident(sessionId: string, modules: string[], taskIds: string[], prdId: string): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.sessionPollution;
    
    // Record incident
    const incident: SessionPollutionIncident = {
      sessionId,
      modules,
      taskIds,
      timestamp: new Date().toISOString(),
    };
    metrics.incidents.push(incident);
    
    // Keep only last 50 incidents
    if (metrics.incidents.length > 50) {
      metrics.incidents = metrics.incidents.slice(-50);
    }

    // Update stats
    metrics.sessionsWithMultipleModules = metrics.incidents.length;
    metrics.detected = metrics.sessionsWithMultipleModules > 0;

    // Emit alert on first detection
    if (metrics.detected && metrics.incidents.length === 1) {
      emitEvent('contribution:issue_detected', {
        issueType: 'session-pollution',
        sessionId,
        modules,
        taskIds,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Update boundary violation tracking
   */
  updateBoundaryViolations(targetModule: string, prdId: string): void {
    if (!this.prdMetrics || !targetModule) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const stats = this.fileOperationsByModule.get(targetModule) || { total: 0, filtered: 0, violations: 0 };
    const metrics = prdMetric.contributionMode.issues.boundaryViolations;
    
    metrics.total = stats.violations;
    metrics.rate = stats.total > 0 ? stats.violations / stats.total : 0;
    
    // Emit alert if threshold exceeded
    if (metrics.rate > metrics.alertThreshold && stats.violations === 1) {
      emitEvent('contribution:issue_detected', {
        issueType: 'boundary-violations',
        targetModule,
        violationRate: metrics.rate,
        alertThreshold: metrics.alertThreshold,
        totalViolations: stats.violations,
        totalOperations: stats.total,
      }, {
        severity: 'warn',
        prdId,
        targetModule,
      });
    }
  }

  /**
   * Update target module context loss tracking
   */
  updateContextLossTracking(prdId: string): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.targetModuleContextLoss;
    
    metrics.totalTasks = this.totalTasks;
    metrics.tasksWithoutTargetModule = this.tasksWithoutTargetModule;
    metrics.rate = this.totalTasks > 0 ? this.tasksWithoutTargetModule / this.totalTasks : 0;
    metrics.detected = metrics.rate > metrics.alertThreshold;

    // Emit alert if threshold exceeded
    if (metrics.detected && this.tasksWithoutTargetModule === 1) {
      emitEvent('contribution:issue_detected', {
        issueType: 'target-module-context-loss',
        rate: metrics.rate,
        alertThreshold: metrics.alertThreshold,
        tasksWithoutTargetModule: this.tasksWithoutTargetModule,
        totalTasks: this.totalTasks,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Get current contribution mode metrics for a PRD
   */
  getMetrics(prdId: string): ContributionModeMetrics['issues'] | null {
    if (!this.prdMetrics) return null;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return null;

    return prdMetric.contributionMode.issues;
  }

  /**
   * Reset tracking for a new PRD execution
   */
  reset(prdId?: string): void {
    if (prdId) {
      // Reset per-PRD state
      this.fileOperationsByModule.clear();
      this.sessionsByModule.clear();
      this.moduleBySession.clear();
      this.tasksWithoutTargetModule = 0;
      this.totalTasks = 0;
    }
  }
}

// Global instance (will be initialized by workflow)
let globalDetector: ContributionModeIssueDetector | null = null;

/**
 * Initialize the global contribution mode issue detector
 */
export function initializeContributionModeIssueDetector(prdMetrics?: PrdMetrics, debug: boolean = false): ContributionModeIssueDetector {
  globalDetector = new ContributionModeIssueDetector(prdMetrics, debug);
  return globalDetector;
}

/**
 * Get the global contribution mode issue detector
 */
export function getContributionModeIssueDetector(): ContributionModeIssueDetector | null {
  return globalDetector;
}
