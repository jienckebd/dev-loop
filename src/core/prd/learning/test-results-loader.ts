/**
 * Test Results Loader
 *
 * Loads test execution history from test-results.json with filtering to prevent stale data from interfering.
 * Filters by timestamp, prdId, phaseId, and optional PRD status.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { SchemaValidator } from './schema-validator';
import { TestResultsFile, TestResultExecution, TestResultsFilterOptions, PrdSetStateFile } from './types';

/**
 * Test Results Loader Configuration
 */
export interface TestResultsLoaderConfig {
  filePath: string;
  prdSetStatePath?: string; // Optional path to prd-set-state.json for filtering by PRD status
  filterOptions?: TestResultsFilterOptions;
  autoPrune?: boolean; // Auto-prune old entries when loading (default: true)
  validateOnLoad?: boolean; // Validate schema on load (default: true)
  debug?: boolean;
}

/**
 * Loads test results from JSON file with filtering
 */
export class TestResultsLoader {
  private config: Required<TestResultsLoaderConfig>;
  private validator: SchemaValidator;
  private debug: boolean;
  private lastPruneTime: number = 0;
  private readonly PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private prdStates: Map<string, string> = new Map(); // Cache of PRD statuses

  constructor(config: TestResultsLoaderConfig) {
    this.config = {
      filePath: config.filePath,
      prdSetStatePath: config.prdSetStatePath || path.join(path.dirname(config.filePath), '../../prd-set-state.json'),
      filterOptions: {
        retentionDays: config.filterOptions?.retentionDays || 180,
        relevanceThreshold: config.filterOptions?.relevanceThreshold || 0.5,
        prdId: config.filterOptions?.prdId,
        phaseId: config.filterOptions?.phaseId,
        framework: config.filterOptions?.framework,
        excludeExpired: config.filterOptions?.excludeExpired !== false,
        autoPrune: config.filterOptions?.autoPrune !== false,
        status: config.filterOptions?.status,
        prdStatus: config.filterOptions?.prdStatus,
      },
      autoPrune: config.autoPrune !== false,
      validateOnLoad: config.validateOnLoad !== false,
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
    this.validator = new SchemaValidator({
      autoFix: true,
      autoMigrate: false, // Test results may not need migration
      backup: true,
      debug: this.debug,
    });
  }

  /**
   * Load test results with filtering
   */
  async load(): Promise<TestResultExecution[]> {
    logger.debug(`[TestResultsLoader] Loading test results from: ${this.config.filePath}`);

    try {
      // Validate schema (auto-fixes if needed)
      if (this.config.validateOnLoad) {
        const validationResult = await this.validator.validateTestResultsFile(this.config.filePath);
        if (!validationResult.valid && validationResult.errors.length > 0) {
          logger.warn(`[TestResultsLoader] Schema validation errors (some may have been auto-fixed): ${validationResult.errors.join('; ')}`);
        }
        if (validationResult.warnings.length > 0 && this.debug) {
          logger.debug(`[TestResultsLoader] Schema validation warnings: ${validationResult.warnings.join('; ')}`);
        }
      }

      // Load PRD states for filtering (if prdStatus filter is specified)
      if (this.config.filterOptions.prdStatus && this.config.prdSetStatePath) {
        await this.loadPrdStates();
      }

      // Check if file exists
      if (!(await fs.pathExists(this.config.filePath))) {
        logger.debug(`[TestResultsLoader] Test results file does not exist: ${this.config.filePath}`);
        return [];
      }

      // Read file
      const data: TestResultsFile = await fs.readJson(this.config.filePath);

      // Auto-prune old entries if enabled and interval has passed
      let executions = data.executions || [];
      if (this.config.autoPrune && this.shouldPruneNow()) {
        const beforeCount = executions.length;
        executions = await this.pruneOldEntries(executions, data);
        if (executions.length < beforeCount) {
          // Save pruned file
          data.executions = executions;
          await fs.writeJson(this.config.filePath, data, { spaces: 2 });
          logger.debug(`[TestResultsLoader] Auto-pruned ${beforeCount - executions.length} old test results`);
        }
        this.lastPruneTime = Date.now();
      }

      // Filter test results
      const filtered = this.filterTestResults(executions);

      logger.debug(`[TestResultsLoader] Loaded ${filtered.length} test results (from ${executions.length} total after pruning)`);
      return filtered;
    } catch (error) {
      logger.error(`[TestResultsLoader] Failed to load test results: ${error}`);
      return [];
    }
  }

  /**
   * Load PRD states from prd-set-state.json for filtering
   */
  private async loadPrdStates(): Promise<void> {
    try {
      if (!(await fs.pathExists(this.config.prdSetStatePath))) {
        return;
      }

      const data: PrdSetStateFile = await fs.readJson(this.config.prdSetStatePath);
      
      // Filter PRD states by retention days and status
      const now = new Date();
      const retentionDays = 90; // Keep PRD states for completed/cancelled PRDs for 90 days
      
      for (const [prdId, state] of Object.entries(data.prdStates || {})) {
        const updatedAt = new Date(state.updatedAt);
        const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
        
        // Filter out old completed/cancelled states
        if ((state.status === 'cancelled' && daysSinceUpdate > 30) ||
            (state.status === 'done' && daysSinceUpdate > retentionDays)) {
          continue; // Skip old completed/cancelled states
        }
        
        // Keep all running/pending states
        this.prdStates.set(prdId, state.status);
      }
    } catch (error) {
      logger.warn(`[TestResultsLoader] Failed to load PRD states: ${error}`);
    }
  }

  /**
   * Filter test results based on filter options
   */
  private filterTestResults(executions: TestResultExecution[]): TestResultExecution[] {
    const now = new Date();
    const filterOpts = this.config.filterOptions;

    return executions.filter(execution => {
      // Filter by timestamp (only load recent test results)
      const timestamp = new Date(execution.timestamp);
      const daysSinceExecution = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceExecution > filterOpts.retentionDays) {
        return false; // Too old
      }

      // Filter by prdId if specified
      if (filterOpts.prdId && execution.prdId !== filterOpts.prdId) {
        return false; // Different PRD
      }

      // Filter by phaseId if specified
      if (filterOpts.phaseId !== undefined && execution.phaseId !== filterOpts.phaseId) {
        return false; // Different phase
      }

      // Filter by test result status if specified
      if (filterOpts.status && filterOpts.status.length > 0) {
        const executionStatus = execution.status || (execution.flaky ? 'flaky' : (execution.failing === 0 ? 'passing' : 'failing'));
        if (!filterOpts.status.includes(executionStatus)) {
          return false; // Status not in filter list
        }
      }

      // Filter by PRD status if specified (exclude running/pending unless explicitly requested)
      if (filterOpts.prdStatus && filterOpts.prdStatus.length > 0) {
        const prdStatus = this.prdStates.get(execution.prdId);
        if (prdStatus && !filterOpts.prdStatus.includes(prdStatus as any)) {
          return false; // PRD status not in filter list
        }
        // If PRD status is not in cache and filter doesn't include unknown, exclude it
        if (!prdStatus && !filterOpts.prdStatus.includes('unknown' as any)) {
          // Default: exclude results for PRDs with unknown status (likely running/pending)
          if (!filterOpts.prdStatus.includes('running' as any) && !filterOpts.prdStatus.includes('pending' as any)) {
            return false;
          }
        }
      } else {
        // Default behavior: exclude results for PRDs with 'running' or 'pending' status
        const prdStatus = this.prdStates.get(execution.prdId);
        if (prdStatus === 'running' || prdStatus === 'pending') {
          return false; // Exclude results for active PRDs (they may not be final)
        }
      }

      // Filter by framework if specified
      if (filterOpts.framework && execution.framework && execution.framework !== filterOpts.framework) {
        return false; // Different framework
      }

      return true;
    });
  }

  /**
   * Prune old entries (remove test results older than retentionDays, keep aggregated stats)
   */
  private async pruneOldEntries(executions: TestResultExecution[], data: TestResultsFile): Promise<TestResultExecution[]> {
    const now = new Date();
    const retentionDays = this.config.filterOptions.retentionDays;

    return executions.filter(execution => {
      const timestamp = new Date(execution.timestamp);
      const daysSinceExecution = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
      
      return daysSinceExecution <= retentionDays;
    });
  }

  /**
   * Check if we should prune now (based on interval)
   */
  private shouldPruneNow(): boolean {
    if (!this.config.autoPrune) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastPruneTime > this.PRUNE_INTERVAL_MS) {
      // Check file mtime to avoid pruning on every load (use sync since this is called during load)
      try {
        if (fs.existsSync(this.config.filePath)) {
          const stats = fs.statSync(this.config.filePath);
          const fileMtime = stats.mtimeMs;
          // Only prune if file hasn't been modified recently (prevents pruning on every read)
          return now - fileMtime > this.PRUNE_INTERVAL_MS;
        }
      } catch {
        // File might not exist yet
        return false;
      }
    }

    return false;
  }
}
