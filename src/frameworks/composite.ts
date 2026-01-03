import { FrameworkPlugin, FrameworkDefaultConfig, CodeChanges, CodeQualityTool, TechDebtIndicator } from './interface';
import { DrupalPlugin } from './drupal';
import { DjangoPlugin } from './django';
import { ReactPlugin } from './react';

/**
 * Composite Framework Plugin
 *
 * For projects with multiple frameworks (e.g., Django backend + React frontend),
 * this plugin detects and merges configurations from multiple framework plugins.
 */
export class CompositePlugin implements FrameworkPlugin {
  readonly name = 'composite';
  readonly version = '1.0.0';
  readonly description = 'Multi-framework composite plugin for projects with multiple stacks';

  private childPlugins: FrameworkPlugin[] = [];
  private templateCache: Map<string, string> = new Map();

  constructor(childPlugins: FrameworkPlugin[] = []) {
    this.childPlugins = childPlugins;
  }

  async detect(projectRoot: string): Promise<boolean> {
    // Composite plugin doesn't auto-detect - it's created when multiple frameworks are detected
    // Return false so it's only used when explicitly created
    return false;
  }

  getDefaultConfig(): FrameworkDefaultConfig {
    // Merge configurations from all child plugins
    const merged: FrameworkDefaultConfig = {
      searchDirs: [],
      excludeDirs: [],
      extensions: [],
      ignoreGlobs: [],
    };

    for (const plugin of this.childPlugins) {
      const config = plugin.getDefaultConfig();

      // Merge search directories (unique)
      if (config.searchDirs) {
        merged.searchDirs = [
          ...(merged.searchDirs || []),
          ...config.searchDirs,
        ].filter((v, i, a) => a.indexOf(v) === i);
      }

      // Merge exclude directories (unique)
      if (config.excludeDirs) {
        merged.excludeDirs = [
          ...(merged.excludeDirs || []),
          ...config.excludeDirs,
        ].filter((v, i, a) => a.indexOf(v) === i);
      }

      // Merge extensions (unique)
      if (config.extensions) {
        merged.extensions = [
          ...(merged.extensions || []),
          ...config.extensions,
        ].filter((v, i, a) => a.indexOf(v) === i);
      }

      // Merge ignore globs (unique)
      if (config.ignoreGlobs) {
        merged.ignoreGlobs = [
          ...(merged.ignoreGlobs || []),
          ...config.ignoreGlobs,
        ].filter((v, i, a) => a.indexOf(v) === i);
      }

      // Prefer first non-empty test runner/test command
      if (!merged.testRunner && config.testRunner) {
        merged.testRunner = config.testRunner;
      }
      if (!merged.testCommand && config.testCommand) {
        merged.testCommand = config.testCommand;
      }

      // Prefer first non-empty cache command
      if (!merged.cacheCommand && config.cacheCommand) {
        merged.cacheCommand = config.cacheCommand;
      }

      // Prefer first non-empty validation base URL
      if (!merged.validationBaseUrl && config.validationBaseUrl) {
        merged.validationBaseUrl = config.validationBaseUrl;
      }
    }

    return merged;
  }

  getTaskTemplate(): string {
    // Generate a combined template that includes guidance for all frameworks
    if (!this.templateCache.has('task')) {
      const sections = this.childPlugins.map(plugin => {
        const template = plugin.getTaskTemplate();
        // Extract the main content (skip the header)
        const lines = template.split('\n');
        const contentStart = lines.findIndex(line => 
          line.startsWith('##') && 
          !line.includes('CRITICAL RULES') && 
          !line.includes('FILE CREATION')
        );
        const frameworkSection = lines.slice(contentStart).join('\n');
        
        return `### ${plugin.name.toUpperCase()} Framework\n\n${frameworkSection}`;
      }).join('\n\n---\n\n');

      const combinedTemplate = `# Multi-Framework Task Implementation

You are working with a project that uses multiple frameworks. This task requires understanding the architecture and implementing changes across the appropriate framework layers.

## CRITICAL RULES

1. **Identify the framework layer** - Determine which framework (backend/frontend) the task affects
2. **Preserve existing code** - Only change what is necessary for the task
3. **Respect framework boundaries** - Don't mix patterns from different frameworks
4. **Follow framework-specific standards** - Use the appropriate coding standards for each framework

## Detected Frameworks

This project uses: ${this.childPlugins.map(p => p.name).join(', ')}

---

${sections}

## Cross-Framework Considerations

- **API Integration**: When modifying frontend, ensure backend API supports the changes
- **Type Safety**: Ensure TypeScript types match backend serializer fields
- **Environment Variables**: Use appropriate env var prefixes (VITE_* for frontend, Django settings for backend)
- **Testing**: Test both backend API and frontend integration

## Output Format

\`\`\`json
{
  "files": [
    {
      "path": "path/to/file",
      "patches": [...],
      "operation": "patch"
    }
  ],
  "summary": "Description of changes across frameworks"
}
\`\`\`
`;

      this.templateCache.set('task', combinedTemplate);
    }

    return this.templateCache.get('task')!;
  }

  getFileExtensions(): string[] {
    // Merge all extensions from child plugins
    const extensions = new Set<string>();
    for (const plugin of this.childPlugins) {
      for (const ext of plugin.getFileExtensions()) {
        extensions.add(ext);
      }
    }
    return Array.from(extensions);
  }

  getSearchDirs(): string[] {
    // Merge all search directories from child plugins
    const dirs = new Set<string>();
    for (const plugin of this.childPlugins) {
      for (const dir of plugin.getSearchDirs()) {
        dirs.add(dir);
      }
    }
    return Array.from(dirs);
  }

  getExcludeDirs(): string[] {
    // Merge all exclude directories from child plugins
    const dirs = new Set<string>();
    for (const plugin of this.childPlugins) {
      for (const dir of plugin.getExcludeDirs()) {
        dirs.add(dir);
      }
    }
    return Array.from(dirs);
  }

  getErrorPatterns(): Record<string, string> {
    // Merge error patterns from all child plugins
    // If multiple plugins have the same pattern, concatenate the guidance
    const patterns: Record<string, string> = {};
    for (const plugin of this.childPlugins) {
      const pluginPatterns = plugin.getErrorPatterns();
      for (const [pattern, guidance] of Object.entries(pluginPatterns)) {
        if (patterns[pattern]) {
          patterns[pattern] = `${patterns[pattern]} | ${guidance}`;
        } else {
          patterns[pattern] = `[${plugin.name}] ${guidance}`;
        }
      }
    }
    return patterns;
  }

  getIdentifierPatterns(): RegExp[] {
    // Merge all identifier patterns from child plugins
    const patterns: RegExp[] = [];
    for (const plugin of this.childPlugins) {
      patterns.push(...plugin.getIdentifierPatterns());
    }
    return patterns;
  }

  getErrorPathPatterns(): RegExp[] {
    // Merge all error path patterns from child plugins
    const patterns: RegExp[] = [];
    for (const plugin of this.childPlugins) {
      const pluginPatterns = plugin.getErrorPathPatterns?.();
      if (pluginPatterns) {
        patterns.push(...pluginPatterns);
      }
    }
    return patterns;
  }

  getCacheCommand(): string | undefined {
    // Return the first available cache command from child plugins
    for (const plugin of this.childPlugins) {
      const cmd = plugin.getCacheCommand?.();
      if (cmd) {
        return cmd;
      }
    }
    return undefined;
  }

  getBuildCommand(): string | undefined {
    // Return the first available build command from child plugins
    for (const plugin of this.childPlugins) {
      const cmd = plugin.getBuildCommand?.();
      if (cmd) {
        return cmd;
      }
    }
    return undefined;
  }

  async onAfterApply(changes: CodeChanges): Promise<void> {
    // Call onAfterApply for each child plugin that has it
    for (const plugin of this.childPlugins) {
      if (plugin.onAfterApply) {
        await plugin.onAfterApply(changes);
      }
    }
  }

  async onTestFailure(error: string): Promise<string> {
    // Collect guidance from all child plugins
    const guidance: string[] = [];
    for (const plugin of this.childPlugins) {
      if (plugin.onTestFailure) {
        const pluginGuidance = await plugin.onTestFailure(error);
        if (pluginGuidance) {
          guidance.push(pluginGuidance);
        }
      }
    }
    return guidance.join('\n\n');
  }

  /**
   * Get the list of child framework plugins.
   */
  getChildPlugins(): FrameworkPlugin[] {
    return this.childPlugins;
  }

  /**
   * Check if a specific framework is included in this composite.
   */
  hasFramework(name: string): boolean {
    return this.childPlugins.some(p => p.name === name);
  }

  getCodeQualityTools(): CodeQualityTool[] {
    // Merge all code quality tools from child plugins
    const tools: CodeQualityTool[] = [];
    const toolNames = new Set<string>();

    for (const plugin of this.childPlugins) {
      if (plugin.getCodeQualityTools) {
        const pluginTools = plugin.getCodeQualityTools();
        for (const tool of pluginTools) {
          // Avoid duplicates by name
          if (!toolNames.has(tool.name)) {
            tools.push(tool);
            toolNames.add(tool.name);
          }
        }
      }
    }

    return tools;
  }

  getTechDebtIndicators(): TechDebtIndicator[] {
    // Merge all tech debt indicators from child plugins
    const indicators: TechDebtIndicator[] = [];

    for (const plugin of this.childPlugins) {
      if (plugin.getTechDebtIndicators) {
        indicators.push(...plugin.getTechDebtIndicators());
      }
    }

    return indicators;
  }
}