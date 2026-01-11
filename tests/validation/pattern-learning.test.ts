/**
 * Pattern Learning Integration Tests
 * 
 * Tests for pattern learning functionality using UnifiedStateManager,
 * including pattern extraction, storage, retrieval, filtering, and
 * application to AI prompts.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { UnifiedStateManager } from '../../src/core/state/StateManager';
import { patternsFileSchema } from '../../src/config/schema/runtime';

describe('Pattern Learning Integration', () => {
  let testDir: string;
  let stateManager: UnifiedStateManager;

  beforeEach(async () => {
    testDir = path.join(__dirname, '../../.test-patterns');
    await fs.ensureDir(testDir);
    stateManager = new UnifiedStateManager(testDir);
    await stateManager.initialize();
  });

  afterEach(async () => {
    if (await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('Pattern Storage via UnifiedStateManager', () => {
    it('should add pattern using addPattern()', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'test pattern text',
        guidance: 'guidance text for pattern',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].id).toBe('pattern-1');
      expect(patterns[0].pattern).toBe('test pattern text');
      expect(patterns[0].guidance).toBe('guidance text for pattern');
    });

    it('should update existing pattern with addPattern()', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'initial pattern',
        guidance: 'initial guidance',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'updated pattern',
        guidance: 'updated guidance',
        occurrences: 5,
        lastSeen: new Date().toISOString(),
        files: ['file1.php'],
        projectTypes: ['drupal'],
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].pattern).toBe('updated pattern');
      expect(patterns[0].occurrences).toBe(5);
      expect(patterns[0].files).toContain('file1.php');
    });

    it('should retrieve patterns using getPatterns()', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'pattern 1',
        guidance: 'guidance 1',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      await stateManager.addPattern({
        id: 'pattern-2',
        pattern: 'pattern 2',
        guidance: 'guidance 2',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns.length).toBe(2);
      expect(patterns.find(p => p.id === 'pattern-1')).toBeDefined();
      expect(patterns.find(p => p.id === 'pattern-2')).toBeDefined();
    });
  });

  describe('Pattern Update with Producer', () => {
    it('should update patterns using updatePatterns()', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'initial',
        guidance: 'guidance',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      await stateManager.updatePatterns((draft) => {
        const pattern = draft.patterns.find(p => p.id === 'pattern-1');
        if (pattern) {
          pattern.occurrences = 10;
          pattern.lastSeen = new Date().toISOString();
          pattern.files.push('file1.php', 'file2.php');
        }
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns[0].occurrences).toBe(10);
      expect(patterns[0].files.length).toBe(2);
      expect(patterns[0].lastSeen).toBeDefined();
    });

    it('should add new pattern via updatePatterns()', async () => {
      await stateManager.updatePatterns((draft) => {
        draft.patterns.push({
          id: 'new-pattern',
          pattern: 'new pattern text',
          guidance: 'new guidance',
          occurrences: 0,
          lastSeen: '',
          files: [],
          projectTypes: [],
        });
      });
      
      const patterns = await stateManager.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].id).toBe('new-pattern');
    });
  });

  describe('Patterns File Structure', () => {
    it('should store patterns in patterns.json with correct structure', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'test',
        guidance: 'guidance',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      const patternsFile = path.join(testDir, '.devloop/patterns.json');
      expect(await fs.pathExists(patternsFile)).toBe(true);
      
      const patternsData = await fs.readJson(patternsFile);
      expect(patternsData.version).toBeDefined();
      expect(patternsData.patterns).toBeDefined();
      expect(Array.isArray(patternsData.patterns)).toBe(true);
      expect(patternsData.patterns.length).toBe(1);
      
      // Validate schema
      patternsFileSchema.parse(patternsData);
    });

    it('should include updatedAt timestamp', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'test',
        guidance: 'guidance',
        occurrences: 0,
        lastSeen: '',
        files: [],
        projectTypes: [],
      });
      
      const patternsFile = path.join(testDir, '.devloop/patterns.json');
      const patternsData = await fs.readJson(patternsFile);
      expect(patternsData.updatedAt).toBeDefined();
      expect(new Date(patternsData.updatedAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe('Pattern Filtering', () => {
    it('should support filtering patterns by relevance', async () => {
      await stateManager.addPattern({
        id: 'pattern-1',
        pattern: 'pattern 1',
        guidance: 'guidance',
        occurrences: 10,
        lastSeen: new Date().toISOString(),
        files: ['file1.php'],
        projectTypes: ['drupal'],
      });
      
      await stateManager.addPattern({
        id: 'pattern-2',
        pattern: 'pattern 2',
        guidance: 'guidance',
        occurrences: 2,
        lastSeen: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
        files: [],
        projectTypes: [],
      });
      
      const allPatterns = await stateManager.getPatterns();
      expect(allPatterns.length).toBe(2);
      
      // Filter by occurrences (relevance)
      const relevantPatterns = allPatterns.filter(p => p.occurrences >= 5);
      expect(relevantPatterns.length).toBe(1);
      expect(relevantPatterns[0].id).toBe('pattern-1');
    });

    it('should support filtering patterns by last seen date', async () => {
      const recentDate = new Date().toISOString();
      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(); // 200 days ago
      
      await stateManager.addPattern({
        id: 'recent-pattern',
        pattern: 'recent',
        guidance: 'guidance',
        occurrences: 0,
        lastSeen: recentDate,
        files: [],
        projectTypes: [],
      });
      
      await stateManager.addPattern({
        id: 'old-pattern',
        pattern: 'old',
        guidance: 'guidance',
        occurrences: 0,
        lastSeen: oldDate,
        files: [],
        projectTypes: [],
      });
      
      const allPatterns = await stateManager.getPatterns();
      const cutoffDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 180 days
      const recentPatterns = allPatterns.filter(p => new Date(p.lastSeen) > cutoffDate);
      
      expect(recentPatterns.length).toBe(1);
      expect(recentPatterns[0].id).toBe('recent-pattern');
    });
  });

  describe('Pattern Persistence', () => {
    it('should persist patterns across state manager instances', async () => {
      await stateManager.addPattern({
        id: 'persistent-pattern',
        pattern: 'persistent',
        guidance: 'guidance',
        occurrences: 5,
        lastSeen: new Date().toISOString(),
        files: ['file.php'],
        projectTypes: ['drupal'],
      });
      
      // Create new state manager instance
      const stateManager2 = new UnifiedStateManager(testDir);
      await stateManager2.initialize();
      
      const patterns = await stateManager2.getPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].id).toBe('persistent-pattern');
      expect(patterns[0].occurrences).toBe(5);
      expect(patterns[0].files).toContain('file.php');
    });
  });
});
