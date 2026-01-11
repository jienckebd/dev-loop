/**
 * Session Management Integration Tests
 * 
 * Tests for session management functionality using UnifiedStateManager,
 * including session creation, persistence, history tracking, expiration,
 * and parallel session isolation.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { UnifiedStateManager } from '../../src/core/state/StateManager';

describe('Session Management Integration', () => {
  let testDir: string;
  let stateManager: UnifiedStateManager;

  beforeEach(async () => {
    testDir = path.join(__dirname, '../../.test-sessions');
    await fs.ensureDir(testDir);
    stateManager = new UnifiedStateManager(testDir);
    await stateManager.initialize();
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Session Storage in execution-state.json', () => {
    it('should store sessions in execution-state.json.sessions', async () => {
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['session-1'] = {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'test-prd',
            taskIds: [],
          },
          history: [],
        };
      });
      
      const state = await stateManager.getExecutionState();
      expect(state.sessions['session-1']).toBeDefined();
      expect(state.sessions['session-1'].sessionId).toBe('session-1');
      expect(state.sessions['session-1'].context.prdId).toBe('test-prd');
    });

    it('should persist sessions across state reads', async () => {
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['session-1'] = {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'test-prd',
            taskIds: ['task-1'],
          },
          history: [],
        };
      });
      
      // Create new state manager instance to simulate restart
      const stateManager2 = new UnifiedStateManager(testDir);
      await stateManager2.initialize();
      
      const state = await stateManager2.getExecutionState();
      expect(state.sessions['session-1']).toBeDefined();
      expect(state.sessions['session-1'].context.taskIds).toContain('task-1');
    });
  });

  describe('Session Creation Per PRD/Phase', () => {
    it('should create unique sessions for different PRD/phase combinations', async () => {
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['prd-1-phase-1'] = {
          sessionId: 'prd-1-phase-1',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'prd-1',
            taskIds: [],
          },
          history: [],
        };
        
        draft.sessions['prd-1-phase-2'] = {
          sessionId: 'prd-1-phase-2',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'prd-1',
            taskIds: [],
          },
          history: [],
        };
        
        draft.sessions['prd-2-phase-1'] = {
          sessionId: 'prd-2-phase-1',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'prd-2',
            taskIds: [],
          },
          history: [],
        };
      });
      
      const state = await stateManager.getExecutionState();
      expect(Object.keys(state.sessions).length).toBe(3);
      expect(state.sessions['prd-1-phase-1']).toBeDefined();
      expect(state.sessions['prd-1-phase-2']).toBeDefined();
      expect(state.sessions['prd-2-phase-1']).toBeDefined();
    });
  });

  describe('Session History Tracking', () => {
    it('should track session history', async () => {
      const historyEntry = {
        requestId: 'req-1',
        prompt: 'Test prompt',
        response: {
          text: 'Test response',
        },
        timestamp: new Date().toISOString(),
        success: true,
      };
      
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['session-1'] = {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'test-prd',
            taskIds: [],
          },
          history: [historyEntry],
        };
      });
      
      const state = await stateManager.getExecutionState();
      expect(state.sessions['session-1'].history.length).toBe(1);
      expect(state.sessions['session-1'].history[0].requestId).toBe('req-1');
      expect(state.sessions['session-1'].history[0].success).toBe(true);
    });

    it('should update lastUsed timestamp', async () => {
      const createdAt = new Date().toISOString();
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['session-1'] = {
          sessionId: 'session-1',
          createdAt,
          lastUsed: createdAt,
          context: {
            prdId: 'test-prd',
            taskIds: [],
          },
          history: [],
        };
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await stateManager.updateExecutionState((draft) => {
        if (draft.sessions['session-1']) {
          draft.sessions['session-1'].lastUsed = new Date().toISOString();
        }
      });
      
      const state = await stateManager.getExecutionState();
      const lastUsed = new Date(state.sessions['session-1'].lastUsed).getTime();
      const created = new Date(createdAt).getTime();
      expect(lastUsed).toBeGreaterThan(created);
    });
  });

  describe('Parallel Session Isolation', () => {
    it('should allow multiple sessions to coexist', async () => {
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['session-a'] = {
          sessionId: 'session-a',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'prd-a',
            taskIds: ['task-a1'],
          },
          history: [],
        };
        
        draft.sessions['session-b'] = {
          sessionId: 'session-b',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'prd-b',
            taskIds: ['task-b1'],
          },
          history: [],
        };
      });
      
      const state = await stateManager.getExecutionState();
      expect(state.sessions['session-a'].context.prdId).toBe('prd-a');
      expect(state.sessions['session-b'].context.prdId).toBe('prd-b');
      expect(state.sessions['session-a'].context.taskIds).not.toContain('task-b1');
      expect(state.sessions['session-b'].context.taskIds).not.toContain('task-a1');
    });
  });

  describe('Session Data Structure', () => {
    it('should match session state schema', async () => {
      await stateManager.updateExecutionState((draft) => {
        draft.sessions['session-1'] = {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          context: {
            prdId: 'test-prd',
            taskIds: ['task-1', 'task-2'],
          },
          history: [
            {
              requestId: 'req-1',
              prompt: 'Test',
              response: {
                text: 'Response',
              },
              timestamp: new Date().toISOString(),
              success: true,
            },
          ],
        };
      });
      
      const state = await stateManager.getExecutionState();
      const session = state.sessions['session-1'];
      
      expect(session.sessionId).toBe('session-1');
      expect(session.createdAt).toBeDefined();
      expect(session.lastUsed).toBeDefined();
      expect(session.context).toBeDefined();
      expect(session.context.prdId).toBe('test-prd');
      expect(Array.isArray(session.context.taskIds)).toBe(true);
      expect(Array.isArray(session.history)).toBe(true);
    });
  });
});
