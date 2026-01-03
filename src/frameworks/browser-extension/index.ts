import * as fs from 'fs-extra';
import * as path from 'path';
import { z } from 'zod';
import { FrameworkPlugin, FrameworkDefaultConfig, CodeChanges, CodeQualityTool, TechDebtIndicator } from '../interface';

/**
 * Browser Extension Framework Plugin
 *
 * Provides Chrome/Firefox browser extension specific functionality for dev-loop including:
 * - Auto-detection of browser extension projects
 * - Manifest V3 support
 * - WebExtension API patterns
 * - Security-focused error patterns
 */
export class BrowserExtensionPlugin implements FrameworkPlugin {
  readonly name = 'browser-extension';
  readonly version = '1.0.0';
  readonly description = 'Chrome/Firefox browser extension support with Webpack';

  private templateCache: Map<string, string> = new Map();

  async detect(projectRoot: string): Promise<boolean> {
    const indicators = [
      path.join(projectRoot, 'manifest.json'),
      path.join(projectRoot, 'public/manifest.json'),
    ];

    for (const indicator of indicators) {
      if (await fs.pathExists(indicator)) {
        try {
          const manifest = await fs.readJson(indicator);
          if (manifest.manifest_version) {
            return true;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    // Check package.json for webextension-polyfill
    const pkgPath = path.join(projectRoot, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      try {
        const pkg = await fs.readJson(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['webextension-polyfill'] || deps['@types/chrome']) {
          return true;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    return false;
  }

  getDefaultConfig(): FrameworkDefaultConfig {
    return {
      searchDirs: ['src', 'public'],
      excludeDirs: ['node_modules', 'dist', 'build', '.git'],
      extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css'],
      testRunner: 'playwright',
      testCommand: 'npm test',
    };
  }

  getSchemaExtension(): z.ZodObject<any> {
    return z.object({
      browserExtension: z.object({
        // Enable browser extension-specific code generation
        enabled: z.boolean().default(true),
        // Manifest version (2 or 3)
        manifestVersion: z.number().default(3),
        // Build output directory
        buildDir: z.string().default('dist'),
        // TypeScript support
        useTypeScript: z.boolean().default(true),
      }).optional(),
    });
  }

  getTaskTemplate(): string {
    // Try to load from file first, fall back to embedded
    if (!this.templateCache.has('task')) {
      const templatePath = path.join(__dirname, 'templates', 'task.md');
      try {
        if (fs.existsSync(templatePath)) {
          this.templateCache.set('task', fs.readFileSync(templatePath, 'utf-8'));
        } else {
          this.templateCache.set('task', this.getEmbeddedTaskTemplate());
        }
      } catch {
        this.templateCache.set('task', this.getEmbeddedTaskTemplate());
      }
    }
    return this.templateCache.get('task')!;
  }

  private getEmbeddedTaskTemplate(): string {
    return `# Browser Extension Task Implementation

You are an expert browser extension developer. Generate code changes to implement the following task.

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace for large files
2. **Preserve existing code** - only change what is necessary for the task
3. **Manifest V3** - Use Manifest V3 APIs (chrome.action, service workers, not background pages)
4. **Security** - Avoid innerHTML, eval, and dynamic code execution
5. **Cross-browser** - Use webextension-polyfill for Firefox compatibility

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Details:** {{task.details}}

## Target Files

{{targetFiles}}

## Existing Code Context

{{existingCode}}

## Browser Extension Coding Standards

1. **Manifest V3**: Use chrome.action (not browserAction), service workers (not background pages)
2. **Security**: Use textContent instead of innerHTML, avoid eval/Function
3. **Cross-browser**: Use browser.* API with webextension-polyfill, not chrome.* directly
4. **Message Passing**: Use chrome.runtime.sendMessage for service worker communication
5. **Permissions**: Declare only necessary permissions in manifest.json
6. **Content Scripts**: Isolate from page context, use message passing for communication

## Output Format

\`\`\`json
{
  "files": [
    {
      "path": "src/background.ts",
      "patches": [
        {
          "search": "// exact code to find",
          "replace": "// replacement code"
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Brief description of changes made"
}
\`\`\`
`;
  }

  getFileExtensions(): string[] {
    return ['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css'];
  }

  getSearchDirs(): string[] {
    return ['src', 'public'];
  }

  getExcludeDirs(): string[] {
    return ['node_modules', 'dist', 'build', '.git'];
  }

  getErrorPatterns(): Record<string, string> {
    return {
      'Content Security Policy': 'Extension CSP violation - remove eval, inline scripts, or remote code',
      'chrome.* is undefined': 'Running outside extension context - use webextension-polyfill',
      'Permission denied': 'Add required permission to manifest.json',
      'Invalid manifest': 'Check manifest.json syntax and required fields',
      'Service worker': 'MV3 uses service workers not background pages - check for window/document usage',
    };
  }

  getIdentifierPatterns(): RegExp[] {
    return [
      // Function declarations
      /(?:export\s+)?(?:default\s+)?(?:function\s+|const\s+)([a-z][a-zA-Z0-9_]*)\s*[=:]?\s*(?:\(|async\s*\()/g,
      // TypeScript interfaces
      /\binterface\s+([A-Z][a-zA-Z0-9_]*)/g,
      // Message listeners
      /chrome\.runtime\.onMessage\.addListener\s*\(/g,
    ];
  }

  getErrorPathPatterns(): RegExp[] {
    return [
      // TypeScript/JavaScript error paths
      /([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/g,
      // Stack trace paths
      /at\s+([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/g,
    ];
  }

  getBuildCommand(): string {
    return 'npm run build';
  }

  getCodeQualityTools(): CodeQualityTool[] {
    return [
      {
        name: 'eslint',
        purpose: 'static-analysis',
        command: 'npx eslint src --format json',
        outputFormat: 'json',
        description: 'ESLint for TypeScript/React',
      },
      {
        name: 'typescript',
        purpose: 'static-analysis',
        command: 'npx tsc --noEmit',
        outputFormat: 'text',
        description: 'TypeScript type checking',
      },
      {
        name: 'web-ext-lint',
        purpose: 'static-analysis',
        command: 'npx web-ext lint --source-dir dist',
        outputFormat: 'text',
        installCommand: 'npm install -D web-ext',
        description: 'Mozilla web-ext linter for extension manifest and APIs',
      },
      {
        name: 'npm-audit',
        purpose: 'security',
        command: 'npm audit --json',
        outputFormat: 'json',
        description: 'Dependency vulnerability audit',
      },
    ];
  }

  getTechDebtIndicators(): TechDebtIndicator[] {
    return [
      // Manifest V3 migration
      {
        pattern: '"manifest_version":\\s*2',
        severity: 'high',
        category: 'deprecated-api',
        description: 'Manifest V2 deprecated - Chrome requires V3',
        remediation: 'Migrate to Manifest V3 format',
      },
      {
        pattern: 'chrome\\.browserAction',
        severity: 'high',
        category: 'deprecated-api',
        description: 'browserAction deprecated in MV3',
        remediation: 'Use chrome.action instead',
      },
      {
        pattern: 'chrome\\.extension\\.getBackgroundPage',
        severity: 'high',
        category: 'deprecated-api',
        description: 'getBackgroundPage deprecated in MV3',
        remediation: 'Use chrome.runtime.sendMessage for service worker communication',
      },
      // Security patterns
      {
        pattern: 'innerHTML\\s*=',
        severity: 'high',
        category: 'security',
        description: 'innerHTML assignment - XSS risk',
        remediation: 'Use textContent or DOMPurify.sanitize()',
      },
      {
        pattern: 'eval\\(|new Function\\(',
        severity: 'high',
        category: 'security',
        description: 'eval/Function - CSP violation in extensions',
        remediation: 'Remove dynamic code execution',
      },
      // Cross-browser
      {
        pattern: 'chrome\\.',
        severity: 'low',
        category: 'obsolete-pattern',
        description: 'Direct chrome.* API - not cross-browser',
        remediation: 'Use browser.* with webextension-polyfill for Firefox support',
      },
    ];
  }

  async onAfterApply(changes: CodeChanges): Promise<void> {
    const hasManifestChanges = changes.files?.some(f =>
      f.path.includes('manifest.json')
    );

    const hasTypeScriptChanges = changes.files?.some(f =>
      f.path.endsWith('.ts') || f.path.endsWith('.tsx')
    );

    if (hasManifestChanges) {
      console.log('[BrowserExtensionPlugin] Manifest changes applied - reload extension in browser');
    }

    if (hasTypeScriptChanges) {
      console.log('[BrowserExtensionPlugin] TypeScript changes applied - rebuild recommended: npm run build');
    }
  }

  async onTestFailure(error: string): Promise<string> {
    const guidance: string[] = [];

    if (error.includes('CSP') || error.includes('Content Security Policy')) {
      guidance.push('CSP VIOLATION: Remove eval, inline scripts, or remote code execution');
    }

    if (error.includes('chrome') && error.includes('undefined')) {
      guidance.push('EXTENSION CONTEXT: Use webextension-polyfill for cross-browser support');
    }

    if (error.includes('Permission') || error.includes('permission')) {
      guidance.push('PERMISSION: Add required permission to manifest.json');
    }

    if (error.includes('Service worker') || error.includes('background')) {
      guidance.push('SERVICE WORKER: MV3 uses service workers - check for window/document usage');
    }

    return guidance.length > 0
      ? '\n\n**Browser Extension-Specific Guidance:**\n' + guidance.map(g => `- ${g}`).join('\n')
      : '';
  }
}
