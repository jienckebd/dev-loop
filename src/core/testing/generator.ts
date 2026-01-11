import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider } from '../../providers/ai/interface';
import { PrdContext, Requirement, TestState } from '../prd/coordination/context';
import { Config } from '../../config/schema/core';

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
   * Generate or refine tests from requirements
   * Supports parallel generation with batching to respect API rate limits
   */
  async generateTests(
    requirements: Requirement[],
    context: PrdContext,
    existingTestPaths?: string[]
  ): Promise<TestState[]> {
    // Get batch size from config (prd.execution.parallelism.testGeneration)
    const prdConfig = (this.config as any).prd || {};
    const executionConfig = prdConfig.execution || {};
    const parallelismConfig = executionConfig.parallelism || {};
    const batchSize = parallelismConfig.testGeneration || 1;

    const tests: TestState[] = [];
    const requirementsToGenerate: Requirement[] = [];

    // Filter out passing tests
    for (const req of requirements) {
      const existingTest = context.tests.find(t => t.requirementId === req.id);

      if (existingTest && existingTest.status === 'passing') {
        // Keep passing tests as-is
        if (this.debug) {
          console.log(`[TestGenerator] Keeping passing test for requirement ${req.id}`);
        }
        tests.push(existingTest);
        continue;
      }

      requirementsToGenerate.push(req);
    }

    // Generate tests in batches for parallel processing
    if (batchSize > 1 && requirementsToGenerate.length > 1) {
      if (this.debug) {
        console.log(`[TestGenerator] Generating ${requirementsToGenerate.length} tests in batches of ${batchSize}`);
      }
      return await this.generateTestsBatch(requirementsToGenerate, context, batchSize, tests);
    } else {
      // Sequential generation (original behavior)
      for (const req of requirementsToGenerate) {
        const existingTest = context.tests.find(t => t.requirementId === req.id);
        const test = await this.generateTestForRequirement(req, context, existingTest);
        tests.push(test);
      }
      return tests;
    }
  }

  /**
   * Generate tests in parallel batches
   */
  private async generateTestsBatch(
    requirements: Requirement[],
    context: PrdContext,
    batchSize: number,
    existingTests: TestState[]
  ): Promise<TestState[]> {
    const allTests = [...existingTests];

    // Split requirements into batches
    const batches: Requirement[][] = [];
    for (let i = 0; i < requirements.length; i += batchSize) {
      batches.push(requirements.slice(i, i + batchSize));
    }

    // Process each batch in parallel
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      if (this.debug) {
        console.log(`[TestGenerator] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} requirements)`);
      }

      // Generate all tests in this batch in parallel
      const batchPromises = batch.map(async (req) => {
        const existingTest = context.tests.find(t => t.requirementId === req.id);
        return await this.generateTestForRequirement(req, context, existingTest);
      });

      const batchTests = await Promise.all(batchPromises);
      allTests.push(...batchTests);
    }

    return allTests;
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

    const testPath = await this.getTestPath(req);
    let testCode = '';
    let testStatus: 'implemented' | 'stub' = 'implemented';

    try {
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
      testCode = response.files?.[0]?.content || response.summary || '';

      // Clean up the test code - remove markdown code blocks if present
      testCode = this.cleanTestCode(testCode);

      if (!testCode || testCode.trim().length < 50) {
        throw new Error(`Failed to generate test code for requirement ${req.id}`);
      }
    } catch (error) {
      // If test generation fails (e.g., Cursor AI timeout), create a stub test
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.debug) {
        console.warn(`[TestGenerator] Test generation failed for ${req.id}: ${errorMessage}. Creating stub test.`);
      }

      // Create a minimal stub test that will fail but allows execution to continue
      testCode = this.createStubTest(req, errorMessage);
      testStatus = 'stub';
    }

    // Write to test file
    await this.writeTestFile(testPath, testCode);

    return {
      id: `test-${req.id}`,
      requirementId: req.id,
      testPath,
      testCode,
      status: testStatus,
      attempts: existingTest?.attempts || 0,
    };
  }

  /**
   * Create a stub test when AI generation fails
   */
  private createStubTest(req: Requirement, errorMessage: string): string {
    const testGenConfig = (this.config as any).testGeneration || {};
    const imports = testGenConfig.imports || [
      "import { test, expect } from '@playwright/test';"
    ];

    // Extract only the first line of the error message to prevent writing
    // uncommented multi-line error details that create invalid TypeScript syntax
    const errorSummary = errorMessage.split('\n')[0].trim();

    return `${imports.join('\n')}

// STUB TEST: Test generation failed for requirement ${req.id}
// Error: ${errorSummary}
// This test will fail but allows PRD execution to continue for metrics validation

test('${req.id}: Stub test (generation failed)', async ({ page }) => {
  test.skip(true, 'Test generation failed - stub test for metrics validation');
});
`;
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

    // Read test generation config
    const testGenConfig = (this.config as any).testGeneration || {};
    const baseUrl = testGenConfig.baseUrl || 'https://sysf.ddev.site';

    // Add CRITICAL test structure requirements first
    sections.push(
      '',
      `## CRITICAL: Test Structure Requirements`,
      ``,
      `Tests are generated in \`${this.testDir}/\` directory.`,
      ``
    );

    // Add imports from config
    if (testGenConfig.imports && testGenConfig.imports.length > 0) {
      sections.push(
        `### Required Imports (USE EXACTLY THESE)`,
        `\`\`\`typescript`,
        ...testGenConfig.imports,
        `\`\`\``,
        ``
      );
    }

    // Add setup pattern from config
    if (testGenConfig.setupPattern) {
      sections.push(
        `### Required Test Setup Pattern`,
        `\`\`\`typescript`,
        testGenConfig.setupPattern,
        `\`\`\``,
        ``,
        `### Available Helper Classes`,
        `- **AuthHelper**: Call \`await auth.login()\` in beforeEach to authenticate`,
        `- **DrupalAPI**: API helper for Drupal operations`,
        `- **WizardHelper**: Helper for wizard interactions (waitForWizardStep, fillAceEditor, clickNextAndWait, etc.)`,
        `- **WizardTestUtils**: Static utilities (generateSampleSchema, generateWizardName)`,
        ``,
        `### Key URLs`,
        `- Base URL: \`${baseUrl}\``,
        `- Wizard add page: \`${baseUrl}/admin/content/wizard/add/api_spec\``,
        `- For existing wizard: \`${baseUrl}/admin/content/wizard/{wizard_id}/edit\``,
        ``,
        `### Important Rules`,
        `1. ALWAYS use full URLs starting with ${baseUrl}`,
        `2. NEVER use relative paths like '/admin/...' - always use full URLs`,
        `3. Import helpers from '../helpers/' (one directory up from test directory)`,
        `4. Use .ts extension imports, NOT .js`,
        `5. DrupalAPI constructor requires (request, baseURL) parameters`,
        `6. Add test.describe.configure({ mode: 'serial' }) to run tests serially (avoid login conflicts)`,
        `7. Use appropriate timeouts (page.waitForTimeout(2000)) after form submissions`,
        ``,
        `### Serial Execution Pattern`,
        `\`\`\`typescript`,
        `test.describe('Feature Name', () => {`,
        `  // Run tests one at a time to avoid login race conditions`,
        `  test.describe.configure({ mode: 'serial' });`,
        `  `,
        `  test.beforeEach(async ({ page, request }) => {`,
        `    // ... setup ONLY - no helper function definitions here!`,
        `  });`,
        ``,
        `  // Helper functions go OUTSIDE beforeEach/test blocks`,
        `  // OR define them at the top of the file BEFORE test.describe`,
        `});`,
        `\`\`\``,
        ``,
        `### CRITICAL: Function Placement Rules`,
        `- DO NOT define helper functions inside test.beforeEach or test()`,
        `- Helper functions must be defined:`,
        `  1. At the TOP of the file, before test.describe()`,
        `  2. OR as standalone exported functions`,
        `  3. OR import them from '../helpers/' files`,
        `- Never write 'async functionName() {}' inside a test block - this is a syntax error`,
        `- Use arrow functions if needed: 'const helperFn = async (page) => { ... }'`,
        ``
      );
    }

    // Add selectors from config
    if (testGenConfig.selectors) {
      sections.push(`### Wizard Page Structure & Selectors (USE THESE)`, ``);

      const selectors = testGenConfig.selectors;
      if (selectors.form) {
        sections.push(
          `**Form Selectors (try in order):**`,
          ...selectors.form.map((s: string) => `- \`${s}\``),
          ``
        );
      }

      if (selectors.navigation) {
        sections.push(
          `**Navigation Buttons:**`,
          ...Object.entries(selectors.navigation).map(([key, value]) => `- ${key.charAt(0).toUpperCase() + key.slice(1)}: \`${value}\``),
          ``
        );
      }

      if (selectors.fields) {
        sections.push(
          `**Form Fields (Step 1 - Feature Selection):**`,
          ...Object.entries(selectors.fields).map(([key, value]) => {
            const fieldName = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            return `- ${fieldName}: ${value}`;
          }),
          ``,
          `**PREFER getByRole and getByLabel over CSS selectors for form fields!**`,
          `This is the most reliable way to find form elements in Drupal.`,
          ``
        );
      }

      if (selectors.ief) {
        sections.push(
          `**IEF (Inline Entity Form) Widgets:**`,
          ...Object.entries(selectors.ief).map(([key, value]) => {
            const label = key === 'container' ? 'IEF container' : key === 'table' ? 'IEF table' : 'IEF add button';
            return `- ${label}: \`${value}\``;
          }),
          ``
        );
      }
    }

    // Add entity save timing rules from config
    if (testGenConfig.entitySaveTiming) {
      const timing = testGenConfig.entitySaveTiming;
      sections.push(
        `### CRITICAL: Wizard Entity Save Timing Rules`,
        ``
      );

      if (timing.rules) {
        timing.rules.forEach((rule: any, index: number) => {
          sections.push(
            `**Rule ${index + 1}: ${rule.id.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}**`,
            `- ${rule.description}`,
            ``
          );
        });
      }

      if (timing.stepProcessing) {
        sections.push(
          `**Step-Specific Processing in hook_wizard_step_post_save()**:`,
          ...Object.entries(timing.stepProcessing).map(([step, desc]) => `- Step ${step}: ${desc}`),
          ``
        );
      }

      if (timing.validationRequirements) {
        sections.push(
          `### Validation Requirements Before Pre-Population`,
          ``
        );
        Object.entries(timing.validationRequirements).forEach(([step, reqs]) => {
          sections.push(
            `**Step ${step} Pre-Population Requires**:`,
            ...(reqs as string[]).map((r: string) => `- ${r.replace(/_/g, ' ')}`),
            ``
          );
        });
      }

      sections.push(
        `**Test Pattern for Pre-Population Verification**:`,
        `1. Navigate to step (e.g., Step 7)`,
        `2. Verify IEF table shows rows (entities in memory)`,
        `3. Click "Next" to save`,
        `4. Verify entities exist in database (if needed)`,
        ``,
        `**Test Pattern for Step Processing Verification**:`,
        `1. Complete prerequisite steps (e.g., Steps 1-6 for Step 7)`,
        `2. Navigate to step`,
        `3. Verify pre-population (IEF table has rows)`,
        `4. Click "Next" to trigger hook_wizard_step_post_save()`,
        `5. Verify processing results (e.g., fields created for Step 7)`,
        ``
      );
    }

    // Add isolation rules from config
    if (testGenConfig.isolationRules && testGenConfig.isolationRules.length > 0) {
      sections.push(
        `### CRITICAL: Test Isolation Rules`,
        ...testGenConfig.isolationRules.map((rule: string) => `- ${rule}`),
        ``,
        `### Test Structure for Wizard Steps`,
        `- Step 1-2: Fill form fields, verify they're visible, click Next, verify next step loads`,
        `- Later steps: Verify form elements exist and are interactive`,
        `- DO NOT submit the final "Complete" button unless specifically testing completion`,
        `- If testing completion: Use a test.afterEach hook to clean up created entities`,
        ``
      );

      // Add wizard hook processing
      sections.push(
        `### Wizard Hook Processing`,
        ``,
        `**hook_wizard_step_post_save()** is called:`,
        `- After clicking "Next" (forward navigation)`,
        `- After clicking "Complete" (final step)`,
        `- NOT called when clicking "Back"`,
        ``,
        `**Test Pattern**:`,
        `- Verify entities exist in memory (IEF table) before clicking Next`,
        `- Click Next to trigger hook processing`,
        `- Verify processing results (fields, bundles, etc.) after hook completes`,
        ``
      );
    }

    // Add wizard-specific context from config (project-specific, comes from PRD config overlays)
    const wizardConfig = (this.config as any).wizard;
    if (wizardConfig) {
      sections.push(
        '',
        `## OpenAPI Wizard Specifics`,
        ``,
        `**Wizard Steps Configuration**:`,
        ...(wizardConfig.steps || []).map((step: any) =>
          `- Step ${step.number}: ${step.name} (form mode: ${step.formMode})${step.visibilityCondition ? ` [visible if: ${step.visibilityCondition}]` : ''}`
        ),
        ``,
        `**IEF Widget Selectors**:`,
        `- Container: \`${wizardConfig.iefSelectors?.container || '[data-drupal-selector*="inline-entity-form"]'}\``,
        `- Table: \`${wizardConfig.iefSelectors?.table || '.ief-table, table.ief-entity-table'}\``,
        `- Add Button: \`${wizardConfig.iefSelectors?.addButton || 'input[value*="Add"], button:has-text("Add")'}\``,
        ``,
        `**Step Processing Notes**:`,
        `- IEF widgets use hook_inline_entity_form_entity_form_alter()`,
        `- Pre-population happens on form load via EntityFormService`,
        `- Entities save on forward navigation only`,
        `- Step 7 (Entity Mapping) should show pre-populated schemadotorg_mapping entities in IEF`,
        `- Step 8 (API Sync) should show pre-populated feed_type entities`,
        `- Step 9 (Webhooks) should show pre-populated webhook_config entities`,
        ``,
        `**Key Services**:`,
        `- EntityFormService::prepopulateSchemaMappings() - Step 7 pre-pop`,
        `- SchemaMappingRecommendationService - AI recommendations`,
        `- EntityBundleFieldFeedService - Feed/field creation`,
        ``,
        `**Common Assertions**:`,
        `- Check IEF table has rows: \`await page.locator('.ief-table tbody tr').count() > 0\``,
        `- Check field created: \`await api.fieldExists(entityType, bundle, fieldName)\``,
        `- Check bundle created: \`await api.bundleExists(entityType, bundleId)\``
      );
    }

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

    // Add helper method signatures and anti-patterns from config
    if (testGenConfig.helperMethodSignatures) {
      sections.push(
        '',
        `## CRITICAL: Helper Method Signatures (MUST USE CORRECT SIGNATURES)`,
        ``
      );
      Object.entries(testGenConfig.helperMethodSignatures).forEach(([method, signature]) => {
        if (method !== 'NOTE') {
          sections.push(`- **${method}**: \`${signature}\``);
        } else {
          sections.push(`**${signature}**`);
        }
      });
      sections.push(``);
    }

    if (testGenConfig.antiPatterns && testGenConfig.antiPatterns.length > 0) {
      sections.push(
        `## CRITICAL: Common Mistakes to Avoid (ANTI-PATTERNS)`,
        ``
      );
      testGenConfig.antiPatterns.forEach((pattern: string) => {
        sections.push(`- ${pattern}`);
      });
      sections.push(``);
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
