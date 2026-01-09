/**
 * Config Merger Integration Tests
 *
 * Tests the hierarchical config merging system:
 * Project Config -> Framework Config -> PRD Set Config -> PRD Config -> Phase Config
 */

import {
  mergeConfigHierarchy,
  createPhaseEffectiveConfig,
  createConfigContext,
  applyPrdSetConfig,
  applyPrdConfig,
  applyPhaseConfig,
  clearPhaseConfig,
  clearPrdConfig,
  clearAllOverlays,
  mergeOverlays,
} from '../src/core/config-merger';
import { Config, ConfigOverlay, validateConfigOverlay } from '../src/config/schema';
import { defaultConfig } from '../src/config/defaults';

describe('Config Merger', () => {
  // Create a minimal valid base config for testing
  const baseConfig: Config = {
    ...defaultConfig,
    ai: {
      provider: 'anthropic' as const,
      model: 'claude-3-sonnet',
    },
    templates: {
      source: 'builtin' as const,
    },
    testing: {
      runner: 'playwright' as const,
      command: 'npx playwright test',
      timeout: 30000,
      artifactsDir: '.devloop/artifacts',
    },
    logs: {
      sources: [{ type: 'file' as const, path: '/var/log/app.log' }],
      patterns: {
        error: 'ERROR|error|Error',
        warning: 'WARN|warn|Warning',
      },
      useAI: false,
    },
    intervention: {
      mode: 'autonomous' as const,
      approvalRequired: [],
    },
    taskMaster: {
      tasksPath: '.taskmaster/tasks/tasks.json',
    },
  };

  describe('mergeConfigHierarchy', () => {
    it('should return base config when no overlays provided', () => {
      const result = mergeConfigHierarchy(baseConfig);
      expect(result.ai.provider).toBe('anthropic');
      expect(result.ai.model).toBe('claude-3-sonnet');
      expect(result.testing.timeout).toBe(30000);
    });

    it('should merge framework config overlay', () => {
      const frameworkConfig = {
        framework: {
          type: 'drupal',
          rules: ['Never modify core'],
        },
      };
      const result = mergeConfigHierarchy(baseConfig, frameworkConfig);
      expect(result.framework?.type).toBe('drupal');
      expect(result.framework?.rules).toEqual(['Never modify core']);
    });

    it('should merge PRD set config overlay', () => {
      const prdSetConfig: ConfigOverlay = {
        ai: {
          model: 'claude-sonnet-4-20250514',
        },
        testing: {
          timeout: 60000,
        },
      };
      const result = mergeConfigHierarchy(baseConfig, undefined, prdSetConfig);
      expect(result.ai.model).toBe('claude-sonnet-4-20250514');
      expect(result.ai.provider).toBe('anthropic'); // Preserved from base
      expect(result.testing.timeout).toBe(60000);
    });

    it('should merge PRD config overlay', () => {
      const prdConfig: ConfigOverlay = {
        testing: {
          timeout: 120000,
        },
        codebase: {
          searchDirs: ['docroot/modules/share/my_module'],
        },
      };
      const result = mergeConfigHierarchy(baseConfig, undefined, undefined, prdConfig);
      expect(result.testing.timeout).toBe(120000);
      expect(result.codebase?.searchDirs).toContain('docroot/modules/share/my_module');
    });

    it('should merge phase config overlay', () => {
      const phaseConfig: ConfigOverlay = {
        testing: {
          timeout: 180000,
        },
      };
      const result = mergeConfigHierarchy(baseConfig, undefined, undefined, undefined, phaseConfig);
      expect(result.testing.timeout).toBe(180000);
    });

    it('should apply overlays in correct order (later wins)', () => {
      const frameworkConfig = { testing: { timeout: 60000 } };
      const prdSetConfig: ConfigOverlay = { testing: { timeout: 120000 } };
      const prdConfig: ConfigOverlay = { testing: { timeout: 180000 } };
      const phaseConfig: ConfigOverlay = { testing: { timeout: 240000 } };

      const result = mergeConfigHierarchy(
        baseConfig,
        frameworkConfig,
        prdSetConfig,
        prdConfig,
        phaseConfig
      );
      expect(result.testing.timeout).toBe(240000);
    });

    it('should deep merge nested objects', () => {
      const prdConfig: ConfigOverlay = {
        framework: {
          type: 'drupal',
          errorGuidance: {
            'Error A': 'Fix A',
          },
        },
      };
      const phaseConfig: ConfigOverlay = {
        framework: {
          errorGuidance: {
            'Error B': 'Fix B',
          },
        },
      };

      const result = mergeConfigHierarchy(baseConfig, undefined, undefined, prdConfig, phaseConfig);
      expect(result.framework?.type).toBe('drupal');
      expect(result.framework?.errorGuidance?.['Error A']).toBe('Fix A');
      expect(result.framework?.errorGuidance?.['Error B']).toBe('Fix B');
    });

    it('should concatenate framework.rules arrays', () => {
      const baseWithRules: Config = {
        ...baseConfig,
        framework: {
          rules: ['Base rule 1', 'Base rule 2'],
        },
      };
      const prdConfig: ConfigOverlay = {
        framework: {
          rules: ['PRD rule 1'],
        },
      };

      const result = mergeConfigHierarchy(baseWithRules, undefined, undefined, prdConfig);
      expect(result.framework?.rules).toContain('Base rule 1');
      expect(result.framework?.rules).toContain('Base rule 2');
      expect(result.framework?.rules).toContain('PRD rule 1');
    });

    it('should concatenate codebase.searchDirs arrays', () => {
      const baseWithDirs: Config = {
        ...baseConfig,
        codebase: {
          searchDirs: ['dir1', 'dir2'],
        },
      };
      const prdConfig: ConfigOverlay = {
        codebase: {
          searchDirs: ['dir3'],
        },
      };

      const result = mergeConfigHierarchy(baseWithDirs, undefined, undefined, prdConfig);
      expect(result.codebase?.searchDirs).toContain('dir1');
      expect(result.codebase?.searchDirs).toContain('dir2');
      expect(result.codebase?.searchDirs).toContain('dir3');
    });
  });

  describe('ConfigContext', () => {
    it('should create context with base config', () => {
      const context = createConfigContext(baseConfig);
      expect(context.baseConfig).toBe(baseConfig);
      expect(context.effectiveConfig).toBe(baseConfig);
      expect(context.prdSetConfig).toBeUndefined();
      expect(context.prdConfig).toBeUndefined();
      expect(context.phaseConfig).toBeUndefined();
    });

    it('should apply PRD set config and update effective config', () => {
      const context = createConfigContext(baseConfig);
      const prdSetConfig: ConfigOverlay = { testing: { timeout: 60000 } };

      applyPrdSetConfig(context, prdSetConfig);

      expect(context.prdSetConfig).toBe(prdSetConfig);
      expect(context.effectiveConfig.testing.timeout).toBe(60000);
    });

    it('should apply PRD config and preserve PRD set config', () => {
      const context = createConfigContext(baseConfig);
      const prdSetConfig: ConfigOverlay = { ai: { model: 'prd-set-model' } };
      const prdConfig: ConfigOverlay = { testing: { timeout: 120000 } };

      applyPrdSetConfig(context, prdSetConfig);
      applyPrdConfig(context, prdConfig);

      expect(context.effectiveConfig.ai.model).toBe('prd-set-model');
      expect(context.effectiveConfig.testing.timeout).toBe(120000);
    });

    it('should apply phase config and preserve all higher-level configs', () => {
      const context = createConfigContext(baseConfig);
      const prdSetConfig: ConfigOverlay = { ai: { model: 'prd-set-model' } };
      const prdConfig: ConfigOverlay = { testing: { timeout: 120000 } };
      const phaseConfig: ConfigOverlay = { testing: { timeout: 180000 } };

      applyPrdSetConfig(context, prdSetConfig);
      applyPrdConfig(context, prdConfig);
      applyPhaseConfig(context, phaseConfig);

      expect(context.effectiveConfig.ai.model).toBe('prd-set-model');
      expect(context.effectiveConfig.testing.timeout).toBe(180000);
    });

    it('should clear phase config correctly', () => {
      const context = createConfigContext(baseConfig);
      const prdConfig: ConfigOverlay = { testing: { timeout: 120000 } };
      const phaseConfig: ConfigOverlay = { testing: { timeout: 180000 } };

      applyPrdConfig(context, prdConfig);
      applyPhaseConfig(context, phaseConfig);
      expect(context.effectiveConfig.testing.timeout).toBe(180000);

      clearPhaseConfig(context);
      expect(context.phaseConfig).toBeUndefined();
      expect(context.effectiveConfig.testing.timeout).toBe(120000);
    });

    it('should clear PRD config and phase config together', () => {
      const context = createConfigContext(baseConfig);
      const prdSetConfig: ConfigOverlay = { ai: { model: 'prd-set-model' } };
      const prdConfig: ConfigOverlay = { testing: { timeout: 120000 } };
      const phaseConfig: ConfigOverlay = { testing: { timeout: 180000 } };

      applyPrdSetConfig(context, prdSetConfig);
      applyPrdConfig(context, prdConfig);
      applyPhaseConfig(context, phaseConfig);

      clearPrdConfig(context);

      expect(context.prdConfig).toBeUndefined();
      expect(context.phaseConfig).toBeUndefined();
      expect(context.effectiveConfig.ai.model).toBe('prd-set-model');
      expect(context.effectiveConfig.testing.timeout).toBe(30000); // Back to base
    });

    it('should clear all overlays', () => {
      const context = createConfigContext(baseConfig);
      const prdSetConfig: ConfigOverlay = { ai: { model: 'prd-set-model' } };
      const prdConfig: ConfigOverlay = { testing: { timeout: 120000 } };

      applyPrdSetConfig(context, prdSetConfig);
      applyPrdConfig(context, prdConfig);

      clearAllOverlays(context);

      expect(context.prdSetConfig).toBeUndefined();
      expect(context.prdConfig).toBeUndefined();
      expect(context.phaseConfig).toBeUndefined();
      expect(context.effectiveConfig).toBe(baseConfig);
    });
  });

  describe('mergeOverlays', () => {
    it('should merge two overlays correctly', () => {
      const overlay1: ConfigOverlay = {
        ai: { model: 'model-1' },
        testing: { timeout: 60000 },
      };
      const overlay2: ConfigOverlay = {
        testing: { timeout: 120000 },
        codebase: { searchDirs: ['dir1'] },
      };

      const result = mergeOverlays(overlay1, overlay2);

      expect(result.ai?.model).toBe('model-1');
      expect(result.testing?.timeout).toBe(120000);
      expect(result.codebase?.searchDirs).toEqual(['dir1']);
    });
  });

  describe('createPhaseEffectiveConfig', () => {
    it('should create effective config for phase', () => {
      const prdSetConfig: ConfigOverlay = { ai: { model: 'set-model' } };
      const prdConfig: ConfigOverlay = { testing: { timeout: 120000 } };
      const phaseConfig: ConfigOverlay = { testing: { timeout: 180000 } };

      const result = createPhaseEffectiveConfig(baseConfig, prdSetConfig, prdConfig, phaseConfig);

      expect(result.ai.model).toBe('set-model');
      expect(result.testing.timeout).toBe(180000);
    });
  });
});

describe('ConfigOverlay Validation', () => {
  describe('validateConfigOverlay', () => {
    it('should validate empty overlay as valid', () => {
      const result = validateConfigOverlay({}, 'prd');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid overlay', () => {
      const overlay: ConfigOverlay = {
        ai: {
          model: 'test-model',
        },
        testing: {
          timeout: 60000,
        },
      };
      const result = validateConfigOverlay(overlay, 'prd');
      expect(result.valid).toBe(true);
    });

    it('should warn about unknown keys', () => {
      const overlay = {
        unknownKey: 'value',
      };
      const result = validateConfigOverlay(overlay, 'prd');
      expect(result.valid).toBe(true); // Still valid (passthrough)
      expect(result.warnings).toContain('[prd] Unknown config key: unknownKey (allowed but may be a typo)');
    });

    it('should validate at different levels', () => {
      const overlay: ConfigOverlay = { testing: { timeout: 60000 } };

      const projectResult = validateConfigOverlay(overlay, 'project');
      const prdSetResult = validateConfigOverlay(overlay, 'prd-set');
      const prdResult = validateConfigOverlay(overlay, 'prd');
      const phaseResult = validateConfigOverlay(overlay, 'phase');

      expect(projectResult.valid).toBe(true);
      expect(prdSetResult.valid).toBe(true);
      expect(prdResult.valid).toBe(true);
      expect(phaseResult.valid).toBe(true);
    });
  });
});

