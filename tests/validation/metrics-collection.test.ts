/**
 * Metrics Collection Integration Tests
 * 
 * Tests for hierarchical metrics collection using UnifiedStateManager,
 * including metrics recording at all levels, aggregation, insights calculation,
 * and persistence in unified metrics.json.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { UnifiedStateManager } from '../../src/core/state/StateManager';

describe('Metrics Collection Integration', () => {
  let testDir: string;
  let stateManager: UnifiedStateManager;

  beforeEach(async () => {
    testDir = path.join(__dirname, '../../.test-metrics');
    await fs.ensureDir(testDir);
    stateManager = new UnifiedStateManager(testDir);
    await stateManager.initialize();
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Hierarchical Metrics Recording', () => {
    it('should record PRD set metrics', async () => {
      await stateManager.recordMetrics('prdSet', 'set-1', {
        setId: 'set-1',
        status: 'in-progress',
        startTime: new Date().toISOString(),
        prdIds: ['prd-1', 'prd-2'],
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.prdSets['set-1']).toBeDefined();
      expect(metrics.prdSets['set-1'].setId).toBe('set-1');
      expect(metrics.prdSets['set-1'].status).toBe('in-progress');
    });

    it('should record PRD metrics', async () => {
      await stateManager.recordMetrics('prd', 'prd-1', {
        prdId: 'prd-1',
        status: 'running',
        startTime: new Date().toISOString(),
        phases: [1, 2],
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.prds['prd-1']).toBeDefined();
      expect(metrics.prds['prd-1'].prdId).toBe('prd-1');
      expect(metrics.prds['prd-1'].status).toBe('running');
    });

    it('should record phase metrics', async () => {
      await stateManager.recordMetrics('phase', 'prd-1:1', {
        phaseId: 1,
        prdId: 'prd-1',
        status: 'in-progress',
        startTime: new Date().toISOString(),
        tasks: {
          total: 5,
          completed: 2,
        },
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.phases['prd-1']?.['1']).toBeDefined();
      expect(metrics.phases['prd-1']?.['1'].phaseId).toBe(1);
      expect(metrics.phases['prd-1']?.['1'].prdId).toBe('prd-1');
    });

    it('should record run metrics', async () => {
      await stateManager.recordMetrics('run', 'run-1', {
        timestamp: new Date().toISOString(),
        taskId: 'task-1',
        status: 'completed',
        timing: {
          totalMs: 1500,
          aiCallMs: 1000,
        },
        tokens: {
          input: 5000,
          output: 1000,
        },
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.runs.length).toBeGreaterThan(0);
      const run = metrics.runs[metrics.runs.length - 1];
      expect(run.status).toBe('completed');
      expect(run.timing?.totalMs).toBe(1500);
    });
  });

  describe('Metrics Aggregation', () => {
    it('should aggregate metrics across multiple runs', async () => {
      for (let i = 0; i < 5; i++) {
        await stateManager.recordMetrics('run', `run-${i}`, {
          timestamp: new Date().toISOString(),
          status: i < 3 ? 'completed' : 'failed',
          tokens: {
            input: 5000 + i * 100,
            output: 1000 + i * 50,
          },
        });
      }
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.runs.length).toBe(5);
      
      const completed = metrics.runs.filter(r => r.status === 'completed');
      const failed = metrics.runs.filter(r => r.status === 'failed');
      expect(completed.length).toBe(3);
      expect(failed.length).toBe(2);
    });

    it('should store metrics in unified metrics.json structure', async () => {
      await stateManager.recordMetrics('prdSet', 'set-1', { setId: 'set-1', status: 'in-progress' });
      await stateManager.recordMetrics('prd', 'prd-1', { prdId: 'prd-1', status: 'running' });
      await stateManager.recordMetrics('phase', 'prd-1:1', { phaseId: 1, prdId: 'prd-1', status: 'in-progress' });
      
      const metricsFile = path.join(testDir, '.devloop/metrics.json');
      expect(await fs.pathExists(metricsFile)).toBe(true);
      
      const metricsData = await fs.readJson(metricsFile);
      expect(metricsData.prdSets).toBeDefined();
      expect(metricsData.prds).toBeDefined();
      expect(metricsData.phases).toBeDefined();
      expect(metricsData.runs).toBeDefined();
    });
  });

  describe('Metrics Update with Producer', () => {
    it('should update metrics with Immer producer', async () => {
      await stateManager.updateMetrics((draft) => {
        if (!draft.insights) draft.insights = {};
        if (!draft.insights.efficiency) draft.insights.efficiency = {};
        
        const successfulRuns = draft.runs.filter(r => r.status === 'completed');
        const totalTokens = successfulRuns.reduce((sum, r) => sum + (r.tokens?.input || 0), 0);
        draft.insights.efficiency.tokensPerSuccess = successfulRuns.length > 0 
          ? totalTokens / successfulRuns.length 
          : 0;
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.insights?.efficiency).toBeDefined();
      expect(metrics.insights?.efficiency?.tokensPerSuccess).toBeDefined();
    });

    it('should calculate insights from metrics', async () => {
      // Add some runs
      await stateManager.updateMetrics((draft) => {
        draft.runs.push(
          { timestamp: new Date().toISOString(), status: 'completed', tokens: { input: 5000, output: 1000 } },
          { timestamp: new Date().toISOString(), status: 'completed', tokens: { input: 6000, output: 1200 } },
          { timestamp: new Date().toISOString(), status: 'failed', tokens: { input: 4000, output: 800 } }
        );
      });
      
      // Calculate insights
      await stateManager.updateMetrics((draft) => {
        if (!draft.insights) draft.insights = {};
        
        const successfulRuns = draft.runs.filter(r => r.status === 'completed');
        const totalTokens = successfulRuns.reduce((sum, r) => sum + (r.tokens?.input || 0), 0);
        
        if (!draft.insights.efficiency) draft.insights.efficiency = {};
        draft.insights.efficiency.tokensPerSuccess = successfulRuns.length > 0 
          ? totalTokens / successfulRuns.length 
          : 0;
        
        if (!draft.insights.quality) draft.insights.quality = {};
        draft.insights.quality.firstTimeSuccessRate = draft.runs.length > 0
          ? successfulRuns.length / draft.runs.length
          : 0;
      });
      
      const metrics = await stateManager.getMetrics();
      expect(metrics.insights?.efficiency?.tokensPerSuccess).toBe(5500); // (5000 + 6000) / 2
      expect(metrics.insights?.quality?.firstTimeSuccessRate).toBeCloseTo(0.667, 2); // 2/3
    });
  });

  describe('Metrics Persistence', () => {
    it('should persist metrics across state manager instances', async () => {
      await stateManager.recordMetrics('prdSet', 'set-1', {
        setId: 'set-1',
        status: 'in-progress',
      });
      
      // Create new state manager instance
      const stateManager2 = new UnifiedStateManager(testDir);
      await stateManager2.initialize();
      
      const metrics = await stateManager2.getMetrics();
      expect(metrics.prdSets['set-1']).toBeDefined();
      expect(metrics.prdSets['set-1'].setId).toBe('set-1');
    });
  });
});
