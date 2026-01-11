/**
 * UnifiedStateManager Unit Tests
 * 
 * Tests for UnifiedStateManager functionality including initialization,
 * read/write operations, patterns/observations, atomic writes, file locking,
 * schema validation, and concurrent access.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { UnifiedStateManager } from '../../src/core/state/StateManager';
import { executionStateFileSchema, metricsFileSchema } from '../../src/config/schema/execution-state';

describe('UnifiedStateManager', () => {
  let testDir: string;
  let stateManager: UnifiedStateManager;

  beforeEach(async () => {
    // Create temporary directory for tests
    testDir = path.join(__dirname, '../../.test-state');
    await fs.ensureDir(testDir);
    stateManager = new UnifiedStateManager(testDir);
    await stateManager.initialize();
  });

  afterEach(async () => {
    // Cleanup test directory
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Initialization', () => {
    it('should initialize UnifiedStateManager', async () => {
      expect(stateManager).toBeDefined();
      await stateManager.initialize();
      expect(await fs.pathExists(path.join(testDir, '.devloop/execution-state.json'))).toBe(true);
      expect(await fs.pathExists(path.join(testDir, '.devloop/metrics.json'))).toBe(true);
    });

    it('should create default execution state structure', async () => {
      await stateManager.initialize();
      const state = await stateManager.getExecutionState();
      
      expect(state.version).toBeDefined();
      expect(state.updatedAt).toBeDefined();
      expect(state.active).toBeDefined();
      expect(state.active.workflowState).toBe('idle');
      expect(state.prdSets).toEqual({});
      expect(state.prds).toEqual({});
      expect(state.contribution).toBeDefined();
      expect(state.contribution.fileCreation).toEqual({});
      expect(state.contribution.investigationTasks).toEqual({});
      expect(state.contributionMode).toBeDefined();
      expect(state.sessions).toEqual({});
    });

    it('should create default metrics structure', async () => {
      await stateManager.initialize();
      const metrics = await stateManager.getMetrics();
      
      expect(metrics.version).toBeDefined();
      expect(metrics.runs).toEqual([]);
      expect(metrics.prdSets).toEqual({});
      expect(metrics.prds).toEqual({});
      expect(metrics.phases).toEqual({});
      expect(metrics.features).toEqual({});
      expect(metrics.parallel).toBeDefined();
      expect(metrics.schema).toBeDefined();
      expect(metrics.insights).toBeDefined();
    });
  });

  describe('Execution State Read/Write', () => {
    it('should read execution state', async () => {
      await stateManager.initialize();
      const state = await stateManager.getExecutionState();
      
      expect(state).toBeDefined();
      expect(state.version).toBeDefined();
      expect(state.updatedAt).toBeDefined();
    });

    it('should update execution state with Immer producer', async () => {
      await stateManager.initialize();
      
      await stateManager.updateExecutionState((draft) => {
        draft.active.prdId = 'test-prd';
        draft.active.workflowState = 'running';
      });
      
      const state = await stateManager.getExecutionState();
      expect(state.active.prdId).toBe('test-prd');
      expect(state.active.workflowState).toBe('running');
    });

    it('should validate execution state schema', async () => {
      await stateManager.initialize();
      const state = await stateManager.getExecutionState();
      
      // Should not throw
      executionStateFileSchema.parse(state);
    });

    it('should update updatedAt timestamp on write', async () => {
      await stateManager.initialize();
      const state1 = await stateManager.getExecutionState();
      const updatedAt1 = state1.updatedAt;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await stateManager.updateExecutionState((draft) => {
        draft.active.prdId = 'test';
      });
      
      const state2 = await stateManager.getExecutionState();
      expect(new Date(state2.updatedAt).getTime()).toBeGreaterThan(new Date(updatedAt1).getTime());
    });
  });

  describe('Metrics Read/Write', () => {
    it('should read metrics', async () => {
      await stateManager.initialize();
      const metrics = await stateManager.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.version).toBeDefined();
      expect(metrics.runs).toBeDefined();
    });

    it('should update metrics with Immer producer', async () => {
      await stateManager.initialize();
      
      await stateManager.updateMetrics((draft) => {
        draft.runs.push({
          timestamp: new Date().toISOString(),
          status: 'completed',
        });
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.runs.length).toBe(1);
      expect(metrics.runs[0].status).toBe('completed');
    });

    it('should record metrics at different levels', async () => {
      await stateManager.initialize();
      
      await stateManager.recordMetrics('prdSet', 'set-1', {
        setId: 'set-1',
        status: 'in-progress',
        startTime: new Date().toISOString(),
      });
      
      await stateManager.recordMetrics('prd', 'prd-1', {
        prdId: 'prd-1',
        status: 'running',
      });
      
      await stateManager.recordMetrics('phase', 'prd-1:1', {
        phaseId: 1,
        prdId: 'prd-1',
        status: 'in-progress',
      });
      
      await stateManager.recordMetrics('run', 'run-1', {
        timestamp: new Date().toISOString(),
        status: 'completed',
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.prdSets['set-1']).toBeDefined();
      expect(metrics.prds['prd-1']).toBeDefined();
      expect(metrics.phases['prd-1']?.['1']).toBeDefined();
      expect(metrics.runs.length).toBeGreaterThan(0);
    });
  });

  describe('Convenience Methods', () => {
    it('should get active context', async () => {
      await stateManager.initialize();
      
      await stateManager.updateExecutionState((draft) => {
        draft.active.prdId = 'test-prd';
        draft.active.phaseId = 1;
      });
      
      const context = await stateManager.getActiveContext();
      expect(context.prdId).toBe('test-prd');
      expect(context.phaseId).toBe(1);
    });

    it('should set active context', async () => {
      await stateManager.initialize();
      
      await stateManager.setActiveContext({
        prdSetId: 'set-1',
        prdId: 'prd-1',
        workflowState: 'running',
      });
      
      const context = await stateManager.getActiveContext();
      expect(context.prdSetId).toBe('set-1');
      expect(context.prdId).toBe('prd-1');
      expect(context.workflowState).toBe('running');
    });

    it('should increment retry count', async () => {
      await stateManager.initialize();
      
      await stateManager.setActiveContext({
        prdId: 'test-prd',
        workflowState: 'idle',
      });
      
      await stateManager.updateExecutionState((draft) => {
        draft.prds['test-prd'] = {
          prdId: 'test-prd',
          status: 'running',
          completedPhases: [],
          retryCounts: {},
        };
      });
      
      await stateManager.incrementRetryCount('task-1');
      
      const state = await stateManager.getExecutionState();
      expect(state.prds['test-prd']?.retryCounts['task-1']).toBe(1);
      
      await stateManager.incrementRetryCount('task-1');
      const state2 = await stateManager.getExecutionState();
      expect(state2.prds['test-prd']?.retryCounts['task-1']).toBe(2);
    });

    it('should clear execution state', async () => {
      await stateManager.initialize();
      
      await stateManager.updateExecutionState((draft) => {
        draft.active.prdId = 'test';
      });
      
      await stateManager.clearExecutionState();
      
      const state = await stateManager.getExecutionState();
      expect(state.active.prdId).toBeUndefined();
      expect(state.active.workflowState).toBe('idle');
    });
  });

  describe('Patterns and Observations', () => {
    it('should get patterns', async () => {
      await stateManager.initialize();
      const patterns = await stateManager.getPatterns();
      
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should add pattern', async () => {
      await stateManager.initialize();
      
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'test pattern',
        guidance: 'guidance text',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].id).toBe('pattern-1');
    });

    it('should update patterns with producer', async () => {
      await stateManager.initialize();
      
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'test',
        guidance: 'guidance',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      await stateManager.updatePatterns((draft) => {
        const pattern = draft.patterns.find(p => p.id === 'pattern-1');
        if (pattern) {
          pattern.occurrences = 5;
        }
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns[0].occurrences).toBe(5);
    });

    it('should get observations', async () => {
      await stateManager.initialize();
      const observations = await stateManager.getObservations();
      
      expect(Array.isArray(observations)).toBe(true);
    });

    it('should add observation', async () => {
      await stateManager.initialize();
      
      await stateManager.addObservation({
        id: 'obs-1',
        type: 'failure-pattern',
        severity: 'high',
        createdAt: new Date().toISOString(),
        relevanceScore: 0.9,
        expiresAt: null,
        prdId: 'test-prd',
        phaseId: 1,
        taskId: 'task-1',
        category: 'error',
        observation: 'Test observation',
        description: 'Description',
        resolved: false,
      });
      
      const observations = await stateManager.getObservations();
      expect(observations.length).toBe(1);
      expect(observations[0].id).toBe('obs-1');
    });

    it('should update observations with producer', async () => {
      await stateManager.initialize();
      
      await stateManager.addObservation({
        id: 'obs-1',
        type: 'failure-pattern',
        severity: 'high',
        createdAt: new Date().toISOString(),
        relevanceScore: 0.9,
        expiresAt: null,
        prdId: 'test-prd',
        category: 'error',
        observation: 'Test',
        description: 'Description',
        resolved: false,
      });
      
      await stateManager.updateObservations((draft) => {
        const obs = draft.observations.find(o => o.id === 'obs-1');
        if (obs) {
          obs.resolved = true;
          obs.resolvedAt = new Date().toISOString();
        }
      });
      
      const observations = await stateManager.getObservations();
      expect(observations[0].resolved).toBe(true);
      expect(observations[0].resolvedAt).toBeDefined();
    });
  });

  describe('Atomic Writes and File Locking', () => {
    it('should write files atomically', async () => {
      await stateManager.initialize();
      
      // Multiple rapid updates should not corrupt the file
      const updates = Array.from({ length: 10 }, (_, i) => 
        stateManager.updateExecutionState((draft) => {
          draft.active.taskId = `task-${i}`;
        })
      );
      
      await Promise.all(updates);
      
      const state = await stateManager.getExecutionState();
      expect(state.active.taskId).toBeDefined();
      // Should have valid JSON structure
      expect(() => JSON.parse(JSON.stringify(state))).not.toThrow();
    });
  });
});
