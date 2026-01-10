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
  
  // Code generation tracking
  private codeGenerationHistory: Array<{ timestamp: string; success: boolean; testPassed: boolean }> = [];
  private contextBuildHistory: Array<{ timestamp: string; contextSize: number; tokensUsed: number; success: boolean; missingFiles: number }> = [];
  
  // Task dependency tracking
  private blockedTasks: Map<string, { taskId: string; startTime: string; reason: string }> = new Map();
  private taskDependencies: Map<string, Set<string>> = new Map(); // taskId -> Set of dependency taskIds
  
  // Test generation tracking
  private testGenerationHistory: Array<{ timestamp: string; testPassed: boolean; immediateFailure: boolean }> = [];
  
  // Validation tracking
  private validationHistory: Array<{ timestamp: string; failed: boolean; retrySucceeded: boolean }> = [];
  
  // Provider tracking
  private providerHistory: Array<{ timestamp: string; error: boolean; timeout: boolean; qualityScore: number }> = [];
  
  // Phase progression tracking
  private phaseProgressHistory: Map<string, Array<{ timestamp: string; tasksCompleted: number }>> = new Map();
  
  // Pattern learning tracking
  private patternMatchHistory: Array<{ timestamp: string; matched: boolean; applied: boolean; succeeded: boolean; recurring: boolean }> = [];
  
  // Schema validation tracking
  private schemaValidationHistory: Array<{ timestamp: string; failed: boolean; falsePositive: boolean; duration: number }> = [];

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
          codeGenerationDegradation: {
            detected: false,
            successRateTrend: 0,
            testPassRateTrend: 0,
            degradationRate: 0,
            alertThreshold: 0.20,
            trendWindowHours: 24,
          },
          contextWindowInefficiency: {
            detected: false,
            avgContextSize: 0,
            tokensPerSuccess: 0,
            missingFileRate: 0,
            efficiencyRatio: 0,
            alertThreshold: 0.001,
          },
          taskDependencyDeadlock: {
            detected: false,
            blockedTasks: 0,
            circularDependencies: [],
            avgWaitTime: 0,
            alertThreshold: 30,
          },
          testGenerationQuality: {
            detected: false,
            successRate: 0,
            coverageGap: 0,
            immediateFailureRate: 0,
            alertThreshold: 0.70,
          },
          validationGateOverBlocking: {
            detected: false,
            falsePositiveRate: 0,
            blockedValidChanges: 0,
            retrySuccessRate: 0,
            alertThreshold: 0.30,
          },
          aiProviderInstability: {
            detected: false,
            errorRate: 0,
            timeoutRate: 0,
            qualityTrend: 0,
            alertThreshold: 0.10,
          },
          resourceExhaustion: {
            detected: false,
            memoryUsageTrend: 0,
            diskUsageTrend: 0,
            timeoutRate: 0,
            alertThreshold: 0.80,
          },
          phaseProgressionStalling: {
            detected: false,
            stalledPhases: [],
            avgProgressRate: 0,
            stallDuration: 0,
            alertThreshold: 60,
          },
          patternLearningInefficacy: {
            detected: false,
            matchToApplicationRate: 0,
            applicationSuccessRate: 0,
            recurringPatternRate: 0,
            alertThreshold: 0.50,
          },
          schemaValidationConsistency: {
            detected: false,
            falsePositiveRate: 0,
            validationTimeTrend: 0,
            inconsistencyRate: 0,
            alertThreshold: 0.20,
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
   * Check all issue types (called periodically or after significant events)
   */
  checkAllIssues(prdId: string): void {
    if (!prdId) return;

    this.checkCodeGenerationDegradation(prdId);
    this.checkContextWindowInefficiency(prdId);
    this.checkTaskDependencyDeadlock(prdId);
    this.checkTestGenerationQuality(prdId);
    this.checkValidationGateOverBlocking(prdId);
    this.checkAiProviderInstability(prdId);
    this.checkResourceExhaustion(prdId);
    this.checkPhaseProgressionStalling(prdId);
    this.checkPatternLearningInefficacy(prdId);
    this.checkSchemaValidationConsistency(prdId);
  }

  /**
   * Track code generation result for degradation detection
   */
  trackCodeGeneration(taskId: string, success: boolean, testPassed: boolean, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.codeGenerationHistory.push({ timestamp, success, testPassed });
    
    // Keep only last 100 entries (sliding window)
    if (this.codeGenerationHistory.length > 100) {
      this.codeGenerationHistory = this.codeGenerationHistory.slice(-100);
    }
    
    // Check for degradation
    this.checkCodeGenerationDegradation(prdId);
  }

  /**
   * Track context build for inefficiency detection
   */
  trackContextBuild(contextSize: number, tokensUsed: number, success: boolean, missingFiles: number, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.contextBuildHistory.push({ timestamp, contextSize, tokensUsed, success, missingFiles });
    
    // Keep only last 100 entries
    if (this.contextBuildHistory.length > 100) {
      this.contextBuildHistory = this.contextBuildHistory.slice(-100);
    }
    
    // Check for inefficiency
    this.checkContextWindowInefficiency(prdId);
  }

  /**
   * Track task dependency for deadlock detection
   */
  trackTaskDependency(taskId: string, dependencies: string[], prdId: string): void {
    this.taskDependencies.set(taskId, new Set(dependencies));
    
    // Check for circular dependencies
    this.checkTaskDependencyDeadlock(prdId);
  }

  /**
   * Track blocked task for deadlock detection
   */
  trackBlockedTask(taskId: string, reason: string, prdId: string): void {
    const startTime = new Date().toISOString();
    this.blockedTasks.set(taskId, { taskId, startTime, reason });
    
    // Check for deadlock
    this.checkTaskDependencyDeadlock(prdId);
  }

  /**
   * Mark task as unblocked
   */
  unblockTask(taskId: string): void {
    this.blockedTasks.delete(taskId);
  }

  /**
   * Track test generation result for quality detection
   */
  trackTestGeneration(testPassed: boolean, immediateFailure: boolean, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.testGenerationHistory.push({ timestamp, testPassed, immediateFailure });
    
    // Keep only last 100 entries
    if (this.testGenerationHistory.length > 100) {
      this.testGenerationHistory = this.testGenerationHistory.slice(-100);
    }
    
    // Check for quality issues
    this.checkTestGenerationQuality(prdId);
  }

  /**
   * Track validation result for over-blocking detection
   */
  trackValidation(failed: boolean, retrySucceeded: boolean, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.validationHistory.push({ timestamp, failed, retrySucceeded });
    
    // Keep only last 100 entries
    if (this.validationHistory.length > 100) {
      this.validationHistory = this.validationHistory.slice(-100);
    }
    
    // Check for over-blocking
    this.checkValidationGateOverBlocking(prdId);
  }

  /**
   * Track provider response for instability detection
   */
  trackProviderResponse(error: boolean, timeout: boolean, qualityScore: number, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.providerHistory.push({ timestamp, error, timeout, qualityScore });
    
    // Keep only last 100 entries
    if (this.providerHistory.length > 100) {
      this.providerHistory = this.providerHistory.slice(-100);
    }
    
    // Check for instability
    this.checkAiProviderInstability(prdId);
  }

  /**
   * Track phase progression for stalling detection
   */
  trackPhaseProgression(phaseId: string, tasksCompleted: number, prdId: string): void {
    const timestamp = new Date().toISOString();
    if (!this.phaseProgressHistory.has(phaseId)) {
      this.phaseProgressHistory.set(phaseId, []);
    }
    this.phaseProgressHistory.get(phaseId)!.push({ timestamp, tasksCompleted });
    
    // Keep only last 50 entries per phase
    const history = this.phaseProgressHistory.get(phaseId)!;
    if (history.length > 50) {
      this.phaseProgressHistory.set(phaseId, history.slice(-50));
    }
    
    // Check for stalling
    this.checkPhaseProgressionStalling(prdId);
  }

  /**
   * Track pattern learning for inefficacy detection
   */
  trackPatternLearning(matched: boolean, applied: boolean, succeeded: boolean, recurring: boolean, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.patternMatchHistory.push({ timestamp, matched, applied, succeeded, recurring });
    
    // Keep only last 100 entries
    if (this.patternMatchHistory.length > 100) {
      this.patternMatchHistory = this.patternMatchHistory.slice(-100);
    }
    
    // Check for inefficacy
    this.checkPatternLearningInefficacy(prdId);
  }

  /**
   * Track schema validation for consistency detection
   */
  trackSchemaValidation(failed: boolean, falsePositive: boolean, duration: number, prdId: string): void {
    const timestamp = new Date().toISOString();
    this.schemaValidationHistory.push({ timestamp, failed, falsePositive, duration });
    
    // Keep only last 100 entries
    if (this.schemaValidationHistory.length > 100) {
      this.schemaValidationHistory = this.schemaValidationHistory.slice(-100);
    }
    
    // Check for consistency issues
    this.checkSchemaValidationConsistency(prdId);
  }

  /**
   * Check for code generation degradation
   */
  private checkCodeGenerationDegradation(prdId: string): void {
    if (!this.prdMetrics || this.codeGenerationHistory.length < 20) return; // Need minimum data points

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.codeGenerationDegradation;
    const windowMs = metrics.trendWindowHours * 3600000;
    const cutoffTime = Date.now() - windowMs;

    // Filter recent history
    const recentHistory = this.codeGenerationHistory.filter(
      entry => new Date(entry.timestamp).getTime() >= cutoffTime
    );

    if (recentHistory.length < 10) return; // Need minimum recent data

    // Calculate success rate trend (split into two halves)
    const midPoint = Math.floor(recentHistory.length / 2);
    const firstHalf = recentHistory.slice(0, midPoint);
    const secondHalf = recentHistory.slice(midPoint);

    const firstHalfSuccessRate = firstHalf.filter(e => e.success).length / firstHalf.length;
    const secondHalfSuccessRate = secondHalf.filter(e => e.success).length / secondHalf.length;
    const successRateTrend = secondHalfSuccessRate - firstHalfSuccessRate; // Negative = degrading

    const firstHalfTestPassRate = firstHalf.filter(e => e.testPassed).length / firstHalf.length;
    const secondHalfTestPassRate = secondHalf.filter(e => e.testPassed).length / secondHalf.length;
    const testPassRateTrend = secondHalfTestPassRate - firstHalfTestPassRate; // Negative = degrading

    const degradationRate = Math.abs(successRateTrend);
    const wasDetected = metrics.detected;
    metrics.successRateTrend = successRateTrend;
    metrics.testPassRateTrend = testPassRateTrend;
    metrics.degradationRate = degradationRate;
    metrics.detected = degradationRate > metrics.alertThreshold || successRateTrend < -metrics.alertThreshold;

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'code-generation-degradation',
        degradationRate,
        successRateTrend,
        testPassRateTrend,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for context window inefficiency
   */
  private checkContextWindowInefficiency(prdId: string): void {
    if (!this.prdMetrics || this.contextBuildHistory.length < 20) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.contextWindowInefficiency;
    
    // Calculate averages
    const successfulBuilds = this.contextBuildHistory.filter(e => e.success);
    const failedBuilds = this.contextBuildHistory.filter(e => !e.success);

    if (successfulBuilds.length === 0) return;

    const avgContextSize = this.contextBuildHistory.reduce((sum, e) => sum + e.contextSize, 0) / this.contextBuildHistory.length;
    const avgTokensPerSuccess = successfulBuilds.reduce((sum, e) => sum + e.tokensUsed, 0) / successfulBuilds.length;
    const missingFileRate = this.contextBuildHistory.filter(e => e.missingFiles > 0).length / this.contextBuildHistory.length;

    // Calculate efficiency ratio (success rate / tokens per success)
    const successRate = successfulBuilds.length / this.contextBuildHistory.length;
    const efficiencyRatio = successRate / Math.max(avgTokensPerSuccess, 1); // Avoid division by zero

    const wasDetected = metrics.detected;
    metrics.avgContextSize = avgContextSize;
    metrics.tokensPerSuccess = avgTokensPerSuccess;
    metrics.missingFileRate = missingFileRate;
    metrics.efficiencyRatio = efficiencyRatio;
    metrics.detected = efficiencyRatio < metrics.alertThreshold || missingFileRate > 0.20; // >20% missing files

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'context-window-inefficiency',
        efficiencyRatio,
        avgContextSize,
        tokensPerSuccess: avgTokensPerSuccess,
        missingFileRate,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for task dependency deadlock
   */
  private checkTaskDependencyDeadlock(prdId: string): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.taskDependencyDeadlock;

    // Detect circular dependencies using DFS
    const circularDeps = this.detectCircularDependencies();
    
    // Check blocked tasks
    const now = Date.now();
    const longBlockedTasks: string[] = [];
    let totalWaitTime = 0;

    for (const taskId of Array.from(this.blockedTasks.keys())) {
      const blockInfo = this.blockedTasks.get(taskId);
      if (!blockInfo) continue;
      const waitTime = (now - new Date(blockInfo.startTime).getTime()) / 60000; // minutes
      totalWaitTime += waitTime;
      if (waitTime > metrics.alertThreshold) {
        longBlockedTasks.push(taskId);
      }
    }

    const avgWaitTime = this.blockedTasks.size > 0 ? totalWaitTime / this.blockedTasks.size : 0;

    const wasDetected = metrics.detected;
    metrics.blockedTasks = this.blockedTasks.size;
    metrics.circularDependencies = circularDeps;
    metrics.avgWaitTime = avgWaitTime;
    metrics.detected = circularDeps.length > 0 || longBlockedTasks.length > 0 || avgWaitTime > metrics.alertThreshold;

    // Emit alert if deadlock detected (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'task-dependency-deadlock',
        blockedTasks: this.blockedTasks.size,
        circularDependencies: circularDeps,
        avgWaitTime,
        longBlockedTasks,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCircularDependencies(): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (taskId: string, path: string[]): void => {
      if (recursionStack.has(taskId)) {
        // Found cycle
        const cycleStart = path.indexOf(taskId);
        cycles.push(path.slice(cycleStart).join(' -> ') + ' -> ' + taskId);
        return;
      }

      if (visited.has(taskId)) return;

      visited.add(taskId);
      recursionStack.add(taskId);

      const dependencies = this.taskDependencies.get(taskId);
      if (dependencies) {
        for (const dep of Array.from(dependencies)) {
          dfs(dep, [...path, taskId]);
        }
      }

      recursionStack.delete(taskId);
    };

    for (const taskId of Array.from(this.taskDependencies.keys())) {
      if (!visited.has(taskId)) {
        dfs(taskId, []);
      }
    }

    return cycles;
  }

  /**
   * Check for test generation quality issues
   */
  private checkTestGenerationQuality(prdId: string): void {
    if (!this.prdMetrics || this.testGenerationHistory.length < 10) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.testGenerationQuality;

    const successRate = this.testGenerationHistory.filter(e => e.testPassed).length / this.testGenerationHistory.length;
    const immediateFailureRate = this.testGenerationHistory.filter(e => e.immediateFailure).length / this.testGenerationHistory.length;

    const wasDetected = metrics.detected;
    metrics.successRate = successRate;
    metrics.immediateFailureRate = immediateFailureRate;
    metrics.coverageGap = 0; // TODO: Calculate from test coverage vs requirements coverage
    metrics.detected = successRate < metrics.alertThreshold || immediateFailureRate > 0.30; // >30% immediate failures

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'test-generation-quality',
        successRate,
        immediateFailureRate,
        coverageGap: metrics.coverageGap,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for validation gate over-blocking
   */
  private checkValidationGateOverBlocking(prdId: string): void {
    if (!this.prdMetrics || this.validationHistory.length < 10) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.validationGateOverBlocking;

    const failedValidations = this.validationHistory.filter(e => e.failed);
    const falsePositives = failedValidations.filter(e => e.retrySucceeded);
    const falsePositiveRate = failedValidations.length > 0 ? falsePositives.length / failedValidations.length : 0;
    const retrySuccessRate = failedValidations.length > 0 ? falsePositives.length / failedValidations.length : 0;

    const wasDetected = metrics.detected;
    metrics.falsePositiveRate = falsePositiveRate;
    metrics.blockedValidChanges = falsePositives.length;
    metrics.retrySuccessRate = retrySuccessRate;
    metrics.detected = falsePositiveRate > metrics.alertThreshold;

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'validation-gate-over-blocking',
        falsePositiveRate,
        blockedValidChanges: falsePositives.length,
        retrySuccessRate,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for AI provider instability
   */
  private checkAiProviderInstability(prdId: string): void {
    if (!this.prdMetrics || this.providerHistory.length < 20) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.aiProviderInstability;

    const errorRate = this.providerHistory.filter(e => e.error).length / this.providerHistory.length;
    const timeoutRate = this.providerHistory.filter(e => e.timeout).length / this.providerHistory.length;

    // Calculate quality trend (split into two halves)
    const midPoint = Math.floor(this.providerHistory.length / 2);
    const firstHalf = this.providerHistory.slice(0, midPoint);
    const secondHalf = this.providerHistory.slice(midPoint);

    const firstHalfAvgQuality = firstHalf.reduce((sum, e) => sum + e.qualityScore, 0) / firstHalf.length;
    const secondHalfAvgQuality = secondHalf.reduce((sum, e) => sum + e.qualityScore, 0) / secondHalf.length;
    const qualityTrend = secondHalfAvgQuality - firstHalfAvgQuality; // Negative = degrading

    const wasDetected = metrics.detected;
    metrics.errorRate = errorRate;
    metrics.timeoutRate = timeoutRate;
    metrics.qualityTrend = qualityTrend;
    metrics.detected = errorRate > metrics.alertThreshold || timeoutRate > metrics.alertThreshold || qualityTrend < -0.10;

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'ai-provider-instability',
        errorRate,
        timeoutRate,
        qualityTrend,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for resource exhaustion (placeholder - would need system metrics)
   */
  private checkResourceExhaustion(prdId: string): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.resourceExhaustion;

    // TODO: Integrate with system metrics to track memory/disk usage
    // For now, this is a placeholder
    metrics.memoryUsageTrend = 0;
    metrics.diskUsageTrend = 0;
    metrics.timeoutRate = 0;
    metrics.detected = false;
  }

  /**
   * Check for phase progression stalling
   */
  private checkPhaseProgressionStalling(prdId: string): void {
    if (!this.prdMetrics || this.phaseProgressHistory.size === 0) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.phaseProgressionStalling;

    const now = Date.now();
    const stalledPhases: string[] = [];
    let totalProgressRate = 0;
    let totalStallDuration = 0;

    for (const phaseId of Array.from(this.phaseProgressHistory.keys())) {
      const history = this.phaseProgressHistory.get(phaseId);
      if (!history || history.length < 2) continue;

      // Calculate progress rate (tasks completed per hour)
      const firstEntry = history[0];
      const lastEntry = history[history.length - 1];
      const timeDiffHours = (new Date(lastEntry.timestamp).getTime() - new Date(firstEntry.timestamp).getTime()) / 3600000;
      const tasksDiff = lastEntry.tasksCompleted - firstEntry.tasksCompleted;
      const progressRate = timeDiffHours > 0 ? tasksDiff / timeDiffHours : 0;

      // Check if phase is stalled (no progress in last hour)
      const lastEntryTime = new Date(lastEntry.timestamp).getTime();
      const stallDurationMinutes = (now - lastEntryTime) / 60000;

      if (progressRate < 0.1 || stallDurationMinutes > metrics.alertThreshold) {
        stalledPhases.push(phaseId);
        totalStallDuration += stallDurationMinutes;
      }

      totalProgressRate += progressRate;
    }

    const avgProgressRate = this.phaseProgressHistory.size > 0 ? totalProgressRate / this.phaseProgressHistory.size : 0;
    const avgStallDuration = stalledPhases.length > 0 ? totalStallDuration / stalledPhases.length : 0;

    const wasDetected = metrics.detected;
    const previousStalledPhases = metrics.stalledPhases || [];
    metrics.stalledPhases = stalledPhases;
    metrics.avgProgressRate = avgProgressRate;
    metrics.stallDuration = avgStallDuration;
    metrics.detected = stalledPhases.length > 0 || avgProgressRate < 0.1 || avgStallDuration > metrics.alertThreshold;

    // Emit alert if stalling detected (only on first detection or when new phases stall)
    if (metrics.detected && (!wasDetected || (stalledPhases.length > 0 && stalledPhases.length > previousStalledPhases.length))) {
      emitEvent('contribution:issue_detected', {
        issueType: 'phase-progression-stalling',
        stalledPhases,
        avgProgressRate,
        stallDuration: avgStallDuration,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for pattern learning inefficacy
   */
  private checkPatternLearningInefficacy(prdId: string): void {
    if (!this.prdMetrics || this.patternMatchHistory.length < 20) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.patternLearningInefficacy;

    const matchedPatterns = this.patternMatchHistory.filter(e => e.matched);
    const appliedPatterns = matchedPatterns.filter(e => e.applied);
    const successfulApplications = appliedPatterns.filter(e => e.succeeded);
    const recurringPatterns = this.patternMatchHistory.filter(e => e.recurring);

    const matchToApplicationRate = matchedPatterns.length > 0 ? appliedPatterns.length / matchedPatterns.length : 0;
    const applicationSuccessRate = appliedPatterns.length > 0 ? successfulApplications.length / appliedPatterns.length : 0;
    const recurringPatternRate = this.patternMatchHistory.length > 0 ? recurringPatterns.length / this.patternMatchHistory.length : 0;

    const wasDetected = metrics.detected;
    metrics.matchToApplicationRate = matchToApplicationRate;
    metrics.applicationSuccessRate = applicationSuccessRate;
    metrics.recurringPatternRate = recurringPatternRate;
    metrics.detected = matchToApplicationRate < metrics.alertThreshold || recurringPatternRate > 0.30; // >30% recurring

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'pattern-learning-inefficacy',
        matchToApplicationRate,
        applicationSuccessRate,
        recurringPatternRate,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
  }

  /**
   * Check for schema validation consistency issues
   */
  private checkSchemaValidationConsistency(prdId: string): void {
    if (!this.prdMetrics || this.schemaValidationHistory.length < 10) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric || !prdMetric.contributionMode) return;

    const metrics = prdMetric.contributionMode.issues.schemaValidationConsistency;

    const failedValidations = this.schemaValidationHistory.filter(e => e.failed);
    const falsePositives = failedValidations.filter(e => e.falsePositive);
    const falsePositiveRate = failedValidations.length > 0 ? falsePositives.length / failedValidations.length : 0;

    // Calculate validation time trend
    const midPoint = Math.floor(this.schemaValidationHistory.length / 2);
    const firstHalf = this.schemaValidationHistory.slice(0, midPoint);
    const secondHalf = this.schemaValidationHistory.slice(midPoint);

    const firstHalfAvgTime = firstHalf.reduce((sum, e) => sum + e.duration, 0) / firstHalf.length;
    const secondHalfAvgTime = secondHalf.reduce((sum, e) => sum + e.duration, 0) / secondHalf.length;
    const validationTimeTrend = secondHalfAvgTime - firstHalfAvgTime; // Positive = increasing

    // Calculate inconsistency rate (same schema validated differently)
    // TODO: Group by schema type and detect inconsistencies
    const inconsistencyRate = 0; // Placeholder

    const wasDetected = metrics.detected;
    metrics.falsePositiveRate = falsePositiveRate;
    metrics.validationTimeTrend = validationTimeTrend;
    metrics.inconsistencyRate = inconsistencyRate;
    metrics.detected = falsePositiveRate > metrics.alertThreshold || validationTimeTrend > 1000; // >1 second increase

    // Emit alert if threshold exceeded (only on first detection)
    if (metrics.detected && !wasDetected) {
      emitEvent('contribution:issue_detected', {
        issueType: 'schema-validation-consistency',
        falsePositiveRate,
        validationTimeTrend,
        inconsistencyRate,
        alertThreshold: metrics.alertThreshold,
      }, {
        severity: 'warn',
        prdId,
      });
    }
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
      
      // Reset new tracking state
      this.codeGenerationHistory = [];
      this.contextBuildHistory = [];
      this.blockedTasks.clear();
      this.taskDependencies.clear();
      this.testGenerationHistory = [];
      this.validationHistory = [];
      this.providerHistory = [];
      this.phaseProgressHistory.clear();
      this.patternMatchHistory = [];
      this.schemaValidationHistory = [];
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
