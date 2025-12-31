import * as fs from 'fs-extra';
import * as path from 'path';
import { FrameworkPlugin, PluginManifest, FrameworkDefaultConfig } from './interface';
import { DrupalPlugin } from './drupal';
import { DjangoPlugin } from './django';
import { ReactPlugin } from './react';
import { CompositePlugin } from './composite';
import { GenericPlugin } from './generic';

// Re-export types
export * from './interface';
export { DrupalPlugin } from './drupal';
export { DjangoPlugin } from './django';
export { ReactPlugin } from './react';
export { CompositePlugin } from './composite';
export { GenericPlugin } from './generic';

/**
 * Built-in framework plugins.
 * These are always available without additional installation.
 */
const BUILTIN_FRAMEWORKS: Record<string, FrameworkPlugin> = {
  drupal: new DrupalPlugin(),
  django: new DjangoPlugin(),
  react: new ReactPlugin(),
  generic: new GenericPlugin(),
};

/**
 * Framework Loader
 *
 * Loads and manages framework plugins for dev-loop.
 * Supports:
 * - Built-in frameworks (drupal, django, react, generic)
 * - Composite plugin for multi-framework projects
 * - Project-local plugins (.devloop/frameworks/{name}/)
 * - npm plugins (@dev-loop/framework-{name})
 * - Auto-detection from project structure
 * - Automatic composite plugin creation when multiple frameworks detected
 */
export class FrameworkLoader {
  private projectRoot: string;
  private customPluginsPath: string;
  private loadedPlugins: Map<string, FrameworkPlugin> = new Map();
  private debug: boolean;

  constructor(projectRoot: string, debug = false) {
    this.projectRoot = projectRoot;
    this.customPluginsPath = path.join(projectRoot, '.devloop/frameworks');
    this.debug = debug;

    // Pre-load built-in plugins
    for (const [name, plugin] of Object.entries(BUILTIN_FRAMEWORKS)) {
      this.loadedPlugins.set(name, plugin);
    }
  }

  /**
   * Detect all frameworks present in the project.
   * @returns Array of detected framework plugins
   */
  async detectAllFrameworks(): Promise<FrameworkPlugin[]> {
    const detected: FrameworkPlugin[] = [];

    // Check all built-in plugins (except generic and composite)
    for (const [name, plugin] of Object.entries(BUILTIN_FRAMEWORKS)) {
      if (name === 'generic' || name === 'composite') continue;
      if (await plugin.detect(this.projectRoot)) {
        detected.push(plugin);
        if (this.debug) {
          console.log(`[FrameworkLoader] Detected framework: ${name}`);
        }
      }
    }

    // Check custom plugins
    if (await fs.pathExists(this.customPluginsPath)) {
      const dirs = await fs.readdir(this.customPluginsPath);
      for (const dir of dirs) {
        const customPlugin = await this.loadCustomPlugin(dir);
        if (customPlugin && await customPlugin.detect(this.projectRoot)) {
          detected.push(customPlugin);
          if (this.debug) {
            console.log(`[FrameworkLoader] Detected custom framework: ${dir}`);
          }
        }
      }
    }

    return detected;
  }

  /**
   * Load a framework plugin by type.
   * Falls back to auto-detection if type is not specified.
   * If multiple frameworks are detected, returns a CompositePlugin.
   *
   * @param type Framework type (e.g., 'drupal', 'composite')
   * @returns The loaded framework plugin
   */
  async loadFramework(type?: string): Promise<FrameworkPlugin> {
    // 1. Explicit type from config - check built-in first
    if (type && this.loadedPlugins.has(type)) {
      if (this.debug) {
        console.log(`[FrameworkLoader] Using built-in framework: ${type}`);
      }
      return this.loadedPlugins.get(type)!;
    }

    // 2. Check for project-local plugin
    if (type) {
      const customPlugin = await this.loadCustomPlugin(type);
      if (customPlugin) {
        if (this.debug) {
          console.log(`[FrameworkLoader] Loaded project-local framework: ${type}`);
        }
        return customPlugin;
      }
    }

    // 3. Check for npm plugin (@dev-loop/framework-*)
    if (type) {
      const npmPlugin = await this.loadNpmPlugin(type);
      if (npmPlugin) {
        if (this.debug) {
          console.log(`[FrameworkLoader] Loaded npm framework: ${type}`);
        }
        return npmPlugin;
      }
    }

    // 4. Auto-detect from project structure
    if (!type) {
      const detected = await this.detectAllFrameworks();

      // If multiple frameworks detected, use CompositePlugin
      if (detected.length > 1) {
        if (this.debug) {
          console.log(`[FrameworkLoader] Multiple frameworks detected: ${detected.map(p => p.name).join(', ')}`);
          console.log(`[FrameworkLoader] Using CompositePlugin`);
        }
        return new CompositePlugin(detected);
      }

      // Single framework detected
      if (detected.length === 1) {
        if (this.debug) {
          console.log(`[FrameworkLoader] Auto-detected framework: ${detected[0].name}`);
        }
        return detected[0];
      }
    }

    // 5. Fallback to generic
    if (this.debug) {
      console.log(`[FrameworkLoader] Using fallback generic framework`);
    }
    return this.loadedPlugins.get('generic')!;
  }

  /**
   * Load a project-local plugin from .devloop/frameworks/{name}/
   */
  private async loadCustomPlugin(name: string): Promise<FrameworkPlugin | null> {
    const pluginPath = path.join(this.customPluginsPath, name, 'plugin.json');

    if (!(await fs.pathExists(pluginPath))) {
      return null;
    }

    try {
      const manifest: PluginManifest = await fs.readJson(pluginPath);
      return this.createPluginFromManifest(manifest, path.dirname(pluginPath));
    } catch (error) {
      console.warn(`[FrameworkLoader] Failed to load custom plugin ${name}:`, error);
      return null;
    }
  }

  /**
   * Load an npm plugin (@dev-loop/framework-{name})
   */
  private async loadNpmPlugin(name: string): Promise<FrameworkPlugin | null> {
    const moduleName = `@dev-loop/framework-${name}`;

    try {
      // Dynamic require for npm modules
      const plugin = require(moduleName);
      const instance = plugin.default || plugin;

      // Verify it implements FrameworkPlugin
      if (typeof instance.getTaskTemplate === 'function') {
        this.loadedPlugins.set(name, instance);
        return instance;
      }

      console.warn(`[FrameworkLoader] npm plugin ${moduleName} does not implement FrameworkPlugin interface`);
      return null;
    } catch {
      // Module not found - that's okay
      return null;
    }
  }

  /**
   * Create a FrameworkPlugin from a manifest file.
   * Used for project-local plugins.
   */
  private createPluginFromManifest(manifest: PluginManifest, pluginDir: string): FrameworkPlugin {
    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || `Custom ${manifest.name} framework plugin`,

      detect: async () => false, // Local plugins don't auto-detect

      getDefaultConfig: (): FrameworkDefaultConfig => ({
        searchDirs: manifest.searchDirs,
        excludeDirs: manifest.excludeDirs,
        extensions: manifest.fileExtensions,
        cacheCommand: manifest.cacheCommand,
      }),

      getTaskTemplate: () => {
        if (manifest.templates?.task) {
          const templatePath = path.join(pluginDir, manifest.templates.task);
          if (fs.existsSync(templatePath)) {
            return fs.readFileSync(templatePath, 'utf-8');
          }
        }
        // Fallback to generic template
        return BUILTIN_FRAMEWORKS.generic.getTaskTemplate();
      },

      getTestTemplate: (): string | undefined => {
        if (manifest.templates?.test) {
          const templatePath = path.join(pluginDir, manifest.templates.test);
          if (fs.existsSync(templatePath)) {
            return fs.readFileSync(templatePath, 'utf-8');
          }
        }
        return undefined;
      },

      getFileExtensions: () => manifest.fileExtensions || ['ts', 'js', 'json'],

      getSearchDirs: () => manifest.searchDirs || ['src'],

      getExcludeDirs: () => manifest.excludeDirs || ['node_modules'],

      getErrorPatterns: () => manifest.errorPatterns || {},

      getIdentifierPatterns: () => {
        if (manifest.identifierPatterns) {
          return manifest.identifierPatterns.map(p => new RegExp(p, 'g'));
        }
        return [];
      },

      getCacheCommand: (): string | undefined => manifest.cacheCommand,
      getBuildCommand: (): string | undefined => manifest.buildCommand,
    };
  }

  /**
   * Get list of all available frameworks (built-in + detected custom)
   */
  async listAvailableFrameworks(): Promise<Array<{ name: string; type: 'builtin' | 'custom' | 'npm'; description: string }>> {
    const frameworks: Array<{ name: string; type: 'builtin' | 'custom' | 'npm'; description: string }> = [];

    // Built-in
    for (const [name, plugin] of Object.entries(BUILTIN_FRAMEWORKS)) {
      frameworks.push({
        name,
        type: 'builtin',
        description: plugin.description,
      });
    }

    // Custom (project-local)
    if (await fs.pathExists(this.customPluginsPath)) {
      const dirs = await fs.readdir(this.customPluginsPath);
      for (const dir of dirs) {
        const manifestPath = path.join(this.customPluginsPath, dir, 'plugin.json');
        if (await fs.pathExists(manifestPath)) {
          try {
            const manifest: PluginManifest = await fs.readJson(manifestPath);
            frameworks.push({
              name: manifest.name,
              type: 'custom',
              description: manifest.description || `Custom ${manifest.name} plugin`,
            });
          } catch {
            // Ignore invalid manifests
          }
        }
      }
    }

    return frameworks;
  }

  /**
   * Register a custom framework plugin at runtime.
   */
  registerPlugin(plugin: FrameworkPlugin): void {
    this.loadedPlugins.set(plugin.name, plugin);
    if (this.debug) {
      console.log(`[FrameworkLoader] Registered custom plugin: ${plugin.name}`);
    }
  }

  /**
   * Check if a specific framework is available.
   */
  hasFramework(name: string): boolean {
    return this.loadedPlugins.has(name);
  }

  /**
   * Get a built-in framework directly (for testing/direct access).
   */
  getBuiltinFramework(name: string): FrameworkPlugin | undefined {
    return BUILTIN_FRAMEWORKS[name];
  }
}

/**
 * Create a framework loader instance for the current working directory.
 */
export function createFrameworkLoader(projectRoot?: string, debug = false): FrameworkLoader {
  return new FrameworkLoader(projectRoot || process.cwd(), debug);
}
