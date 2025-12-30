import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider } from '../providers/ai/interface';
import { PrdContext, Requirement, TestState } from './prd-context';
import { Config } from '../config/schema';

export class TestGenerator {
  private testDir: string;
  private framework: string;

  constructor(
    private aiProvider: AIProvider,
    private config: Config,
    private debug: boolean = false
  ) {
    const autonomousConfig = (config as any).autonomous || {};
    const testGenConfig = autonomousConfig.testGeneration || {};
    this.testDir = testGenConfig.testDir || 'tests/playwright/auto';
    this.framework = testGenConfig.framework || 'playwright';
  }

  /**
   * Generate or evolve tests from requirements
   */
  async generateTests(
    requirements: Requirement[],
    context: PrdContext,
    existingTestPaths?: string[]
  ): Promise<TestState[]> {
    const tests: TestState[] = [];

    for (const req of requirements) {
      // Check if test already exists
      const existingTest = context.tests.find(t => t.requirementId === req.id);

      if (existingTest && existingTest.status === 'passing') {
        // Keep passing tests as-is
        if (this.debug) {
          console.log(`[TestGenerator] Keeping passing test for requirement ${req.id}`);
        }
        tests.push(existingTest);
        continue;
      }

      // Generate or enhance test based on accumulated knowledge
      const test = await this.generateTestForRequirement(req, context, existingTest);
      tests.push(test);
    }

    return tests;
  }

  /**
   * Generate test for a specific requirement
   */
  private async generateTestForRequirement(
    req: Requirement,
    context: PrdContext,
    existingTest?: TestState
  ): Promise<TestState> {
    // Build prompt with accumulated context
    const prompt = this.buildTestGenerationPrompt(req, context, existingTest);

    if (this.debug) {
      console.log(`[TestGenerator] Generating test for requirement ${req.id}`);
    }

    // Generate test code via AI
    const response = await this.aiProvider.generateCode(prompt, {
      task: {
        id: `test-gen-${req.id}`,
        title: `Generate test for ${req.id}`,
        description: `Generate Playwright test for requirement: ${req.description}`,
        status: 'pending',
        priority: 'high',
      },
      codebaseContext: this.buildCodebaseContext(context),
    });

    // Extract test code from response
    let testCode = response.files?.[0]?.content || response.summary || '';

    // Clean up the test code - remove markdown code blocks if present
    testCode = this.cleanTestCode(testCode);

    if (!testCode || testCode.trim().length < 50) {
      throw new Error(`Failed to generate test code for requirement ${req.id}`);
    }

    // Write to test file
    const testPath = await this.getTestPath(req);
    await this.writeTestFile(testPath, testCode);

    return {
      id: `test-${req.id}`,
      requirementId: req.id,
      testPath,
      testCode,
      status: existingTest ? 'implemented' : 'implemented',
      attempts: existingTest?.attempts || 0,
    };
  }

  /**
   * Build test generation prompt with accumulated context
   */
  private buildTestGenerationPrompt(
    req: Requirement,
    context: PrdContext,
    existingTest?: TestState
  ): string {
    const sections: string[] = [
      `## Requirement`,
      req.description,
      '',
      `## Acceptance Criteria`,
      ...req.acceptanceCriteria.map(c => `- ${c}`),
    ];

    // Add CRITICAL test structure requirements first
    sections.push(
      '',
      `## CRITICAL: Test Structure Requirements`,
      ``,
      `Tests are generated in \`${this.testDir}/\` directory.`,
      ``,
      `### Required Imports (USE EXACTLY THESE)`,
      `\`\`\`typescript`,
      `import { test, expect } from '@playwright/test';`,
      `import { AuthHelper } from '../helpers/auth';`,
      `import { DrupalAPI } from '../helpers/drupal-api';`,
      `import { WizardHelper, WizardTestUtils } from '../helpers/wizard-helper';`,
      `\`\`\``,
      ``,
      `### Required Test Setup Pattern`,
      `\`\`\`typescript`,
      `test.describe('Feature Name', () => {`,
      `  test.beforeEach(async ({ page, request }) => {`,
      `    const baseURL = 'https://sysf.ddev.site';`,
      `    const api = new DrupalAPI(request, baseURL);`,
      `    const auth = new AuthHelper(page, api);`,
      `    const wizard = new WizardHelper(page, api);`,
      `    `,
      `    // Login as admin before each test`,
      `    await auth.login();`,
      `  });`,
      ``,
      `  test('should do something', async ({ page }) => {`,
      `    // Navigate with full URL`,
      `    await page.goto('https://sysf.ddev.site/admin/content/wizard/add/api_spec');`,
      `    // ... test code`,
      `  });`,
      `});`,
      `\`\`\``,
      ``,
      `### Available Helper Classes`,
      `- **AuthHelper**: Call \`await auth.login()\` in beforeEach to authenticate`,
      `- **DrupalAPI**: API helper for Drupal operations`,
      `- **WizardHelper**: Helper for wizard interactions (waitForWizardStep, fillAceEditor, clickNextAndWait, etc.)`,
      `- **WizardTestUtils**: Static utilities (generateSampleSchema, generateWizardName)`,
      ``,
      `### Key URLs`,
      `- Base URL: \`https://sysf.ddev.site\``,
      `- Wizard add page: \`https://sysf.ddev.site/admin/content/wizard/add/api_spec\``,
      `- For existing wizard: \`https://sysf.ddev.site/admin/content/wizard/{wizard_id}/edit\``,
      ``,
      `### Important Rules`,
      `1. ALWAYS use full URLs starting with https://sysf.ddev.site`,
      `2. NEVER use relative paths like '/admin/...' - always use full URLs`,
      `3. Import helpers from '../helpers/' (one directory up from auto/)`,
      `4. Use .ts extension imports, NOT .js`,
      `5. DrupalAPI constructor requires (request, baseURL) parameters`,
      ``,
      `### Wizard Page Structure & Selectors (USE THESE)`,
      ``,
      `**Form Selectors (try in order):**`,
      `- \`form[data-drupal-selector*="wizard"]\` - Primary wizard form`,
      `- \`form[id*="wizard"]\` - Alternative wizard form ID`,
      `- \`.layout-content form\` - Form in layout content area`,
      `- \`main form[method="post"]\` - Main form with POST method`,
      `- \`.wizard-form\` - Wizard form class`,
      ``,
      `**Navigation Buttons:**`,
      `- Next: \`input[type="submit"][value*="Next"], button:has-text("Next")\``,
      `- Back: \`input[type="submit"][value*="Back"], button:has-text("Back")\``,
      `- Complete: \`input[type="submit"][value*="Complete"], button:has-text("Complete")\``,
      ``,
      `**Form Fields:**`,
      `- Wizard name: \`input[name="label"], input[name*="label"]\``,
      `- Schema input: \`textarea[name*="schema"], .ace_editor\` (ACE editor for YAML/JSON)`,
      `- Feature checkboxes: \`input[type="checkbox"][name*="feature"]\``,
      `- Entity type select: \`select[name*="entity_type"], input[name*="entity_type"]\``,
      ``,
      `**IEF (Inline Entity Form) Widgets:**`,
      `- IEF container: \`[data-drupal-selector*="schema_mapping"], [data-drupal-selector*="feed_type"], [data-drupal-selector*="webhook"]\``,
      `- IEF table: \`.ief-table, table.ief-entity-table\``,
      `- IEF add button: \`input[value*="Add"], button:has-text("Add")\``,
      `- IEF edit button: \`input[value*="Edit"], button:has-text("Edit")\``,
      ``,
      `**Step Indicators:**`,
      `- Active step: \`[data-step].active, .step.active\``,
      `- Step number: \`[data-step="1"], [data-step="2"], etc.\``,
      ``,
      `**Wait Strategies:**`,
      `- Wait for form: \`await page.waitForSelector('form[data-drupal-selector*="wizard"]', { timeout: 15000 })\``,
      `- Wait for load: \`await page.waitForLoadState('domcontentloaded')\``,
      `- Wait after navigation: \`await page.waitForTimeout(500)\` (small delay for AJAX)`
    );

    // Add learned knowledge
    if (context.knowledge.codeLocations.length > 0) {
      sections.push(
        '',
        `## Known Code Locations`,
        ...context.knowledge.codeLocations.map(
          l => `- ${l.path}: ${l.purpose}${l.relevantFunctions ? ` (functions: ${l.relevantFunctions.join(', ')})` : ''}`
        )
      );
    }

    // Add working patterns
    if (context.knowledge.workingPatterns.length > 0) {
      sections.push(
        '',
        `## Working Patterns (USE THESE)`,
        ...context.knowledge.workingPatterns.map(
          p => `- ${p.description}:\n\`\`\`\n${p.code}\n\`\`\``
        )
      );
    }

    // Add failed approaches to avoid
    if (context.knowledge.failedApproaches.length > 0) {
      sections.push(
        '',
        `## Failed Approaches (AVOID THESE)`,
        ...context.knowledge.failedApproaches.map(
          a => `- ${a.description}: ${a.reason}`
        )
      );
    }

    // Add existing test if enhancing
    if (existingTest && existingTest.testCode) {
      sections.push(
        '',
        `## Existing Test (ENHANCE THIS)`,
        `\`\`\`typescript\n${existingTest.testCode}\n\`\`\``,
        '',
        `The test above is failing. Fix it based on the error context and accumulated knowledge.`
      );
    }

    // Add framework-specific guidance
    const frameworkType = (this.config as any).framework?.type || 'generic';
    sections.push(
      '',
      `## Output Format`,
      `Generate ONLY the complete test file content, nothing else.`,
      `Do not include markdown code blocks or explanations - just the raw TypeScript code.`
    );

    // Add discovered issues to be aware of
    if (context.knowledge.discoveredIssues.length > 0) {
      const relevantIssues = context.knowledge.discoveredIssues.filter(
        i => i.testId === existingTest?.id || !existingTest
      );
      if (relevantIssues.length > 0) {
        sections.push(
          '',
          `## Known Issues to Work Around`,
          ...relevantIssues.map(i => `- ${i.description}`)
        );
      }
    }

    return sections.join('\n');
  }

  /**
   * Build codebase context from accumulated knowledge
   */
  private buildCodebaseContext(context: PrdContext): string {
    const sections: string[] = [];

    if (context.knowledge.codeLocations.length > 0) {
      sections.push(
        '## Known Files and Functions',
        ...context.knowledge.codeLocations.map(
          l => `- ${l.path}: ${l.purpose}`
        )
      );
    }

    return sections.join('\n');
  }

  /**
   * Get test file path for a requirement
   */
  private async getTestPath(req: Requirement): Promise<string> {
    await fs.ensureDir(path.resolve(process.cwd(), this.testDir));

    // Sanitize requirement ID for filename
    const safeId = req.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeId}.spec.ts`;

    return path.join(this.testDir, filename);
  }

  /**
   * Clean test code by removing markdown code blocks and other artifacts
   */
  private cleanTestCode(code: string): string {
    let cleaned = code.trim();

    // Remove markdown code block wrappers
    // Match ```typescript, ```ts, ``` at the start
    const codeBlockStart = /^```(?:typescript|ts|javascript|js)?\s*\n?/;
    const codeBlockEnd = /\n?```\s*$/;

    if (codeBlockStart.test(cleaned) && codeBlockEnd.test(cleaned)) {
      cleaned = cleaned.replace(codeBlockStart, '').replace(codeBlockEnd, '');
    }

    // Also handle case where entire response is wrapped
    if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
      // Find first newline after opening fence
      const firstNewline = cleaned.indexOf('\n');
      // Find last newline before closing fence
      const lastNewline = cleaned.lastIndexOf('\n');
      if (firstNewline > 0 && lastNewline > firstNewline) {
        cleaned = cleaned.substring(firstNewline + 1, lastNewline);
      }
    }

    return cleaned.trim();
  }

  /**
   * Write test file to disk
   */
  private async writeTestFile(testPath: string, testCode: string): Promise<void> {
    const fullPath = path.resolve(process.cwd(), testPath);
    await fs.ensureDir(path.dirname(fullPath));

    // Ensure test code has proper imports if it's TypeScript
    let finalCode = testCode;
    if (testPath.endsWith('.ts') || testPath.endsWith('.spec.ts')) {
      // Check if imports are present
      if (!testCode.includes('import') && !testCode.includes('from')) {
        // Add basic Playwright imports if missing
        finalCode = `import { test, expect } from '@playwright/test';\n\n${testCode}`;
      }
    }

    await fs.writeFile(fullPath, finalCode, 'utf-8');

    if (this.debug) {
      console.log(`[TestGenerator] Wrote test file: ${testPath}`);
    }
  }
}
