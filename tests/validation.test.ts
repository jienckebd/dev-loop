/**
 * Validation Command Tests
 *
 * Tests for validate-prd and validate-config commands
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { validateConfigOverlay, ConfigOverlay, frameworkConfigSchema } from '../src/config/schema';

describe('PRD Validation', () => {
  describe('Config Overlay Validation', () => {
    it('should validate valid PRD config overlay', () => {
      const overlay: ConfigOverlay = {
        testing: {
          timeout: 300000,
        },
        codebase: {
          searchDirs: ['docroot/modules/share/my_module'],
        },
      };

      const result = validateConfigOverlay(overlay, 'prd');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid phase config overlay', () => {
      const overlay: ConfigOverlay = {
        testing: {
          timeout: 600000,
        },
        ai: {
          maxTokens: 16000,
        },
      };

      const result = validateConfigOverlay(overlay, 'phase');
      expect(result.valid).toBe(true);
    });

    it('should warn about unknown keys in overlay', () => {
      const overlay = {
        testing: { timeout: 60000 },
        customUnknownKey: 'some value',
      };

      const result = validateConfigOverlay(overlay, 'prd');
      expect(result.valid).toBe(true); // Passthrough allows unknown keys
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('customUnknownKey'))).toBe(true);
    });

    it('should handle nested config structures', () => {
      const overlay: ConfigOverlay = {
        framework: {
          type: 'drupal',
          rules: ['Rule 1', 'Rule 2'],
          errorGuidance: {
            'Error pattern': 'Fix suggestion',
          },
        },
      };

      const result = validateConfigOverlay(overlay, 'prd');
      expect(result.valid).toBe(true);
    });

    it('should validate empty overlay', () => {
      const result = validateConfigOverlay({}, 'prd');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Framework Config Validation', () => {
    it('should validate valid framework config', () => {
      const frameworkConfig = {
        type: 'drupal',
        rules: ['Rule 1'],
        taskPatterns: ['pattern1'],
        errorPathPatterns: ['path pattern'],
        errorGuidance: { 'Error': 'Fix' },
        identifierPatterns: ['identifier'],
        templatePath: '.taskmaster/templates/drupal.md',
      };

      const result = frameworkConfigSchema.safeParse(frameworkConfig);
      expect(result.success).toBe(true);
    });

    it('should allow empty framework config', () => {
      const result = frameworkConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate partial framework config', () => {
      const frameworkConfig = {
        type: 'react',
      };

      const result = frameworkConfigSchema.safeParse(frameworkConfig);
      expect(result.success).toBe(true);
    });
  });
});

describe('PRD Set Validation', () => {
  describe('PRD Set Config Overlay', () => {
    it('should validate valid PRD set config', () => {
      const prdSetConfig: ConfigOverlay = {
        ai: {
          model: 'claude-sonnet-4-20250514',
        },
        framework: {
          rules: ['PRD set specific rule'],
        },
        testing: {
          timeout: 300000,
        },
      };

      const result = validateConfigOverlay(prdSetConfig, 'prd-set');
      expect(result.valid).toBe(true);
    });

    it('should handle PRD set with multiple sections', () => {
      const prdSetConfig: ConfigOverlay = {
        ai: { model: 'model' },
        testing: { timeout: 60000 },
        codebase: { searchDirs: ['dir1', 'dir2'] },
        framework: { type: 'drupal', rules: ['rule1'] },
      };

      const result = validateConfigOverlay(prdSetConfig, 'prd-set');
      expect(result.valid).toBe(true);
    });
  });
});

describe('Phase Config Validation', () => {
  it('should validate phase config with test timeout override', () => {
    const phaseConfig: ConfigOverlay = {
      testing: {
        timeout: 900000, // 15 minutes
      },
    };

    const result = validateConfigOverlay(phaseConfig, 'phase');
    expect(result.valid).toBe(true);
  });

  it('should validate phase config with AI override', () => {
    const phaseConfig: ConfigOverlay = {
      ai: {
        maxTokens: 32000,
        maxContextChars: 100000,
      },
    };

    const result = validateConfigOverlay(phaseConfig, 'phase');
    expect(result.valid).toBe(true);
  });

  it('should validate phase config with codebase focus', () => {
    const phaseConfig: ConfigOverlay = {
      codebase: {
        searchDirs: ['docroot/modules/share/specific_module'],
        excludeDirs: ['node_modules', 'vendor'],
      },
    };

    const result = validateConfigOverlay(phaseConfig, 'phase');
    expect(result.valid).toBe(true);
  });
});

describe('Validation Error Handling', () => {
  it('should handle null input', () => {
    const result = validateConfigOverlay(null, 'prd');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle undefined input', () => {
    const result = validateConfigOverlay(undefined, 'prd');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle non-object input', () => {
    const result = validateConfigOverlay('string', 'prd');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle array input', () => {
    const result = validateConfigOverlay([], 'prd');
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

