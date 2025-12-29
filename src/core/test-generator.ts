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
    const testCode = response.files?.[0]?.content || response.summary || '';

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
      `## Test Framework: ${this.framework}`,
      `Generate a ${this.framework} test that validates the requirement and acceptance criteria.`,
      `Use the project's existing test patterns and helpers.`
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
