/**
 * Codebase Insight Extractor
 *
 * Extracts actionable insights from codebase analysis for each refinement phase.
 * Helps guide questions and refinement decisions.
 */

import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { SemanticFileDiscovery, DiscoveryQuery, FileRelevance } from '../../analysis/code/semantic-file-discovery';
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { TestResultExecution } from '../learning/types';

/**
 * Codebase Insight
 */
export interface CodebaseInsight {
  id: string;
  type: 'pattern' | 'file' | 'schema' | 'test' | 'config';
  phase: 'schema' | 'test' | 'feature';
  description: string;
  relevance: 'high' | 'medium' | 'low';
  example?: string;
  recommendation?: string;
  filePath?: string; // Path to relevant file
  pattern?: string; // Detected pattern
  count?: number; // Number of occurrences
}

/**
 * Codebase Insight Extractor Configuration
 */
export interface CodebaseInsightExtractorConfig {
  projectRoot: string;
  useSemanticDiscovery?: boolean; // Use semantic discovery when available
  semanticDiscovery?: SemanticFileDiscovery; // Optional semantic discovery instance
  testResults?: TestResultExecution[]; // Loaded test results from test-results.json (filtered)
  debug?: boolean;
}

/**
 * Extracts actionable insights from codebase analysis
 */
export class CodebaseInsightExtractor {
  private config: CodebaseInsightExtractorConfig;
  private semanticDiscovery?: SemanticFileDiscovery;
  private debug: boolean;
  private useSemanticDiscovery: boolean;
  private testResults: TestResultExecution[] = [];

  constructor(config: CodebaseInsightExtractorConfig) {
    this.config = config;
    this.debug = config.debug || false;
    this.useSemanticDiscovery = config.useSemanticDiscovery !== false; // Default to true if available
    this.semanticDiscovery = config.semanticDiscovery;
    this.testResults = config.testResults || [];

    if (this.debug && this.testResults.length > 0) {
      logger.debug(`[CodebaseInsightExtractor] Initialized with ${this.testResults.length} test results for context`);
    }
  }

  /**
   * Extract insights for schema enhancement phase
   */
  async extractSchemaInsights(analysis: CodebaseAnalysisResult): Promise<CodebaseInsight[]> {
    logger.debug('[CodebaseInsightExtractor] Extracting schema insights');

    const insights: CodebaseInsight[] = [];

    // Find existing schema files using semantic discovery if available, otherwise use pattern matching
    let schemaFiles: string[] = [];
    
    if (this.useSemanticDiscovery && this.semanticDiscovery && analysis.frameworkPlugin) {
      try {
        await this.semanticDiscovery.initialize();
        
        // Use semantic discovery to find relevant schema files
        const discoveryQuery: DiscoveryQuery = {
          query: `schema definitions for ${(analysis.featureTypes || []).join(', ') || 'entities'}`,
          includePatterns: ['**/*.schema.yml', '**/*schema*.yml', '**/bd.entity_type.*.yml'],
          maxResults: 15,
          minScore: 0.6,
          excludePatterns: ['**/node_modules/**', '**/vendor/**', '**/docroot/core/**'],
        };

        const relevantFiles = await this.semanticDiscovery.discoverFiles(discoveryQuery);
        schemaFiles = relevantFiles
          .filter((f: FileRelevance) => f.score >= 0.6)
          .sort((a: FileRelevance, b: FileRelevance) => b.score - a.score)
          .map((f: FileRelevance) => f.filePath);
        
        logger.debug(`[CodebaseInsightExtractor] Found ${schemaFiles.length} schema files using semantic discovery`);
      } catch (error) {
        logger.warn(`[CodebaseInsightExtractor] Semantic discovery failed: ${error}, falling back to pattern matching`);
        schemaFiles = analysis.relevantFiles.filter(
          f => f.includes('schema') && (f.endsWith('.yml') || f.endsWith('.yaml'))
        );
      }
    } else {
      // Fallback to pattern matching
      schemaFiles = analysis.relevantFiles.filter(
        f => f.includes('schema') && (f.endsWith('.yml') || f.endsWith('.yaml'))
      );
    }

    if (schemaFiles.length > 0) {
      insights.push({
        id: 'schema-files-found',
        type: 'schema',
        phase: 'schema',
        description: `Found ${schemaFiles.length} existing schema file(s) in the codebase`,
        relevance: 'high',
        example: schemaFiles[0],
        recommendation: 'Review existing schemas to follow established patterns',
        filePath: schemaFiles[0],
        count: schemaFiles.length,
      });
    }

    // Analyze schema patterns
    if (analysis.schemaPatterns && analysis.schemaPatterns.length > 0) {
      for (const pattern of analysis.schemaPatterns.slice(0, 3)) {
        insights.push({
          id: `schema-pattern-${pattern.type}`,
          type: 'pattern',
          phase: 'schema',
          description: `Detected schema pattern: ${pattern.type}`,
          relevance: 'high',
          example: pattern.examples?.[0],
          recommendation: `Use ${pattern.type} pattern for new schemas`,
          pattern: pattern.pattern,
          count: pattern.examples?.length || 0,
        });
      }
    }

    // Check for entity type schemas
    const entityTypeSchemas = schemaFiles.filter(f => f.includes('entity_type'));
    if (entityTypeSchemas.length > 0) {
      insights.push({
        id: 'entity-type-schemas',
        type: 'schema',
        phase: 'schema',
        description: `Found ${entityTypeSchemas.length} entity type schema(s) using pattern: bd.*.entity_type.*.yml`,
        relevance: 'high',
        example: entityTypeSchemas[0],
        recommendation: 'Follow bd.{module}.entity_type.{entity_id}.yml pattern for new entity type schemas',
        pattern: 'bd.*.entity_type.*.yml',
        count: entityTypeSchemas.length,
      });
    }

    // Check for config schemas
    const configSchemas = schemaFiles.filter(
      f => f.includes('schema') && !f.includes('entity_type') && f.endsWith('.schema.yml')
    );
    if (configSchemas.length > 0) {
      insights.push({
        id: 'config-schemas',
        type: 'schema',
        phase: 'schema',
        description: `Found ${configSchemas.length} config schema file(s)`,
        relevance: 'medium',
        example: configSchemas[0],
        recommendation: 'Use .schema.yml suffix for config schemas',
        pattern: '*.schema.yml',
        count: configSchemas.length,
      });
    }

    // Analyze file contexts for schema-related patterns
    for (const [filePath, context] of analysis.fileContexts.entries()) {
      if (filePath.includes('schema') || filePath.includes('entity_type')) {
        const imports = context.imports || [];
        const schemaImports = imports.filter((imp: string) =>
          imp.includes('TypedData') || imp.includes('Schema') || imp.includes('Config')
        );

        if (schemaImports.length > 0) {
          insights.push({
            id: `schema-imports-${path.basename(filePath)}`,
            type: 'pattern',
            phase: 'schema',
            description: `Schema file uses imports: ${schemaImports.slice(0, 3).join(', ')}`,
            relevance: 'medium',
            example: filePath,
            recommendation: 'Include similar imports in new schema files',
            filePath,
          });
        }
      }
    }

    return insights;
  }

  /**
   * Extract insights for test planning phase
   */
  async extractTestInsights(analysis: CodebaseAnalysisResult): Promise<CodebaseInsight[]> {
    logger.debug('[CodebaseInsightExtractor] Extracting test insights');

    const insights: CodebaseInsight[] = [];

    // Find existing test files using semantic discovery if available, otherwise use pattern matching
    let testFiles: string[] = [];
    
    if (this.useSemanticDiscovery && this.semanticDiscovery && analysis.frameworkPlugin) {
      try {
        await this.semanticDiscovery.initialize();
        
        // Use semantic discovery to find relevant test files
        const discoveryQuery: DiscoveryQuery = {
          query: `test files for ${(analysis.featureTypes || []).join(', ') || 'features'}`,
          includePatterns: ['**/*.spec.ts', '**/*.spec.js', '**/*.test.ts', '**/*.test.js', '**/tests/**/*.ts'],
          maxResults: 15,
          minScore: 0.6,
          excludePatterns: ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**'],
        };

        const relevantFiles = await this.semanticDiscovery.discoverFiles(discoveryQuery);
        testFiles = relevantFiles
          .filter((f: FileRelevance) => f.score >= 0.6)
          .sort((a: FileRelevance, b: FileRelevance) => b.score - a.score)
          .map((f: FileRelevance) => f.filePath);
        
        logger.debug(`[CodebaseInsightExtractor] Found ${testFiles.length} test files using semantic discovery`);
      } catch (error) {
        logger.warn(`[CodebaseInsightExtractor] Semantic discovery failed: ${error}, falling back to pattern matching`);
        testFiles = analysis.relevantFiles.filter(
          f => f.includes('test') || f.includes('spec') || f.endsWith('.test.ts') || f.endsWith('.spec.ts')
        );
      }
    } else {
      // Fallback to pattern matching
      testFiles = analysis.relevantFiles.filter(
        f => f.includes('test') || f.includes('spec') || f.endsWith('.test.ts') || f.endsWith('.spec.ts')
      );
    }

    if (testFiles.length > 0) {
      insights.push({
        id: 'test-files-found',
        type: 'test',
        phase: 'test',
        description: `Found ${testFiles.length} existing test file(s) in the codebase`,
        relevance: 'high',
        example: testFiles[0],
        recommendation: 'Review existing tests to understand test structure and patterns',
        count: testFiles.length,
      });
    }

    // Analyze test patterns
    if (analysis.testPatterns && analysis.testPatterns.length > 0) {
      for (const pattern of analysis.testPatterns.slice(0, 3)) {
        insights.push({
          id: `test-pattern-${pattern.framework}`,
          type: 'pattern',
          phase: 'test',
          description: `Detected test framework: ${pattern.framework}`,
          relevance: 'high',
          example: pattern.examples?.[0],
          recommendation: `Use ${pattern.framework} framework for test plans`,
          pattern: pattern.structure,
          count: pattern.examples?.length || 0,
        });
      }
    }

    // Check for Playwright tests
    const playwrightTests = testFiles.filter(f => f.includes('playwright') || f.includes('.spec.ts'));
    if (playwrightTests.length > 0) {
      insights.push({
        id: 'playwright-tests',
        type: 'test',
        phase: 'test',
        description: `Found ${playwrightTests.length} Playwright test file(s)`,
        relevance: 'high',
        example: playwrightTests[0],
        recommendation: 'Use Playwright test structure: describe() blocks with test() cases',
        pattern: 'Playwright E2E structure',
        count: playwrightTests.length,
      });
    }

    // Check for PHPUnit tests
    const phpunitTests = testFiles.filter(f => f.endsWith('Test.php') || f.includes('phpunit'));
    if (phpunitTests.length > 0) {
      insights.push({
        id: 'phpunit-tests',
        type: 'test',
        phase: 'test',
        description: `Found ${phpunitTests.length} PHPUnit test file(s)`,
        relevance: 'high',
        example: phpunitTests[0],
        recommendation: 'Use PHPUnit test structure: class extends TestCase with test* methods',
        pattern: 'PHPUnit unit test structure',
        count: phpunitTests.length,
      });
    }

    // Analyze test directory structure
    const testDirs = new Set<string>();
    for (const testFile of testFiles.slice(0, 20)) {
      const dir = path.dirname(testFile);
      const relDir = path.relative(this.config.projectRoot, dir);
      if (relDir.includes('test') || relDir.includes('tests')) {
        testDirs.add(relDir);
      }
    }

    if (testDirs.size > 0) {
      const commonDir = Array.from(testDirs)[0];
      insights.push({
        id: 'test-directory-structure',
        type: 'pattern',
        phase: 'test',
        description: `Tests are organized in directory: ${commonDir}`,
        relevance: 'medium',
        recommendation: `Place new test files in ${commonDir} directory`,
        pattern: commonDir,
        count: testDirs.size,
      });
    }

    // Analyze file contexts for test patterns
    for (const [filePath, context] of analysis.fileContexts.entries()) {
      if (filePath.includes('test') || filePath.includes('spec')) {
        const signatures = context.helperSignatures || [];
        const testSignatures = signatures.filter((sig: string) =>
          sig.includes('test') || sig.includes('describe') || sig.includes('it(')
        );

        if (testSignatures.length > 0) {
          insights.push({
            id: `test-structure-${path.basename(filePath)}`,
            type: 'pattern',
            phase: 'test',
            description: `Test file uses structure: ${testSignatures.slice(0, 2).join(', ')}`,
            relevance: 'medium',
            example: filePath,
            recommendation: 'Follow similar test structure in new test plans',
            filePath,
          });
        }
      }
    }

    // Analyze test results history (if available) to identify successful/failed patterns
    if (this.testResults.length > 0) {
      const testHistoryInsights = this.extractInsightsFromTestHistory(analysis);
      insights.push(...testHistoryInsights);
    }

    return insights;
  }

  /**
   * Extract insights from test results history
   */
  private extractInsightsFromTestHistory(analysis: CodebaseAnalysisResult): CodebaseInsight[] {
    const insights: CodebaseInsight[] = [];

    // Analyze test results for patterns
    const passingTests = this.testResults.filter(r => r.status === 'passing' || (r.passing > 0 && r.failing === 0));
    const failingTests = this.testResults.filter(r => r.status === 'failing' || r.failing > 0);
    const flakyTests = this.testResults.filter(r => r.status === 'flaky' || r.flaky);

    // Success rate analysis
    const successRate = passingTests.length / this.testResults.length;
    if (successRate > 0.8 && passingTests.length > 5) {
      insights.push({
        id: 'test-success-pattern',
        type: 'pattern',
        phase: 'test',
        description: `High test success rate (${(successRate * 100).toFixed(0)}%) in past PRD executions`,
        relevance: 'high',
        recommendation: 'Follow patterns from successful test executions',
        pattern: 'High success rate pattern',
        count: passingTests.length,
      });
    }

    // Common failure patterns
    if (failingTests.length > 0) {
      // Group by PRD ID to find patterns
      const failuresByPrd = failingTests.reduce((acc, result) => {
        if (!acc[result.prdId]) {
          acc[result.prdId] = [];
        }
        acc[result.prdId].push(result);
        return acc;
      }, {} as Record<string, TestResultExecution[]>);

      // Find PRDs with multiple failures (patterns to avoid)
      const problematicPrds = Object.entries(failuresByPrd)
        .filter(([_, results]) => results.length > 2)
        .slice(0, 3);

      if (problematicPrds.length > 0) {
        insights.push({
          id: 'test-failure-patterns',
          type: 'pattern',
          phase: 'test',
          description: `Found ${problematicPrds.length} PRD(s) with multiple test failures in past executions`,
          relevance: 'medium',
          recommendation: 'Review failed test patterns to avoid similar issues',
          pattern: problematicPrds.map(([prdId]) => prdId).join(', '),
          count: problematicPrds.reduce((sum, [_, results]) => sum + results.length, 0),
        });
      }
    }

    // Flaky test patterns
    if (flakyTests.length > 0) {
      insights.push({
        id: 'flaky-test-patterns',
        type: 'pattern',
        phase: 'test',
        description: `Found ${flakyTests.length} flaky test execution(s) in past PRD sets`,
        relevance: 'medium',
        recommendation: 'Ensure test isolation and avoid flaky test patterns (timing issues, shared state, etc.)',
        pattern: 'Flaky test pattern',
        count: flakyTests.length,
      });
    }

    // Test framework usage patterns (if test results have framework info)
    const frameworkUsage = this.testResults
      .filter(r => r.testFramework)
      .reduce((acc, result) => {
        acc[result.testFramework!] = (acc[result.testFramework!] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    if (Object.keys(frameworkUsage).length > 0) {
      const mostUsedFramework = Object.entries(frameworkUsage)
        .sort((a, b) => b[1] - a[1])[0];
      
      insights.push({
        id: 'test-framework-usage',
        type: 'pattern',
        phase: 'test',
        description: `Most used test framework in past executions: ${mostUsedFramework[0]} (${mostUsedFramework[1]} executions)`,
        relevance: 'high',
        recommendation: `Use ${mostUsedFramework[0]} framework for test plans to match project patterns`,
        pattern: mostUsedFramework[0],
        count: mostUsedFramework[1],
      });
    }

    return insights;
  }

  /**
   * Extract insights for feature enhancement phase
   */
  async extractFeatureInsights(analysis: CodebaseAnalysisResult): Promise<CodebaseInsight[]> {
    logger.debug('[CodebaseInsightExtractor] Extracting feature insights');

    const insights: CodebaseInsight[] = [];

    // Framework-specific insights
    if (analysis.frameworkPlugin) {
      insights.push({
        id: 'framework-detected',
        type: 'config',
        phase: 'feature',
        description: `Framework detected: ${analysis.frameworkPlugin.name}`,
        relevance: 'high',
        recommendation: `Generate ${analysis.frameworkPlugin.name}-specific configurations`,
        pattern: analysis.frameworkPlugin.name,
      });
    }

    // Feature type insights
    if (analysis.featureTypes && analysis.featureTypes.length > 0) {
      insights.push({
        id: 'feature-types-detected',
        type: 'pattern',
        phase: 'feature',
        description: `Detected feature types: ${analysis.featureTypes.join(', ')}`,
        relevance: 'high',
        recommendation: `Generate configurations for these feature types: ${analysis.featureTypes.join(', ')}`,
        count: analysis.featureTypes.length,
      });
    }

    // Check for existing error guidance or log patterns
    const errorPatternFiles = analysis.relevantFiles.filter(
      f => f.includes('error') || f.includes('exception') || f.includes('log')
    );

    if (errorPatternFiles.length > 0) {
      insights.push({
        id: 'error-pattern-files',
        type: 'file',
        phase: 'feature',
        description: `Found ${errorPatternFiles.length} file(s) related to error handling or logging`,
        relevance: 'medium',
        example: errorPatternFiles[0],
        recommendation: 'Review existing error handling patterns for consistency',
        count: errorPatternFiles.length,
      });
    }

    // Check for dev-loop config files
    const devloopConfigs = analysis.relevantFiles.filter(
      f => f.includes('devloop') && (f.endsWith('.js') || f.endsWith('.yml'))
    );

    if (devloopConfigs.length > 0) {
      insights.push({
        id: 'devloop-configs',
        type: 'config',
        phase: 'feature',
        description: `Found ${devloopConfigs.length} dev-loop configuration file(s)`,
        relevance: 'high',
        example: devloopConfigs[0],
        recommendation: 'Review existing dev-loop configs to maintain consistency',
        count: devloopConfigs.length,
      });
    }

    // Analyze code patterns for feature enhancements
    if (analysis.patterns && analysis.patterns.length > 0) {
      const errorPatterns = analysis.patterns.filter(
        p => p.signature.toLowerCase().includes('error') ||
             p.signature.toLowerCase().includes('exception') ||
             p.signature.toLowerCase().includes('log')
      );

      if (errorPatterns.length > 0) {
        insights.push({
          id: 'error-patterns',
          type: 'pattern',
          phase: 'feature',
          description: `Found ${errorPatterns.length} error handling pattern(s) in codebase`,
          relevance: 'medium',
          example: errorPatterns[0].signature,
          recommendation: 'Use similar error handling patterns in new code',
          count: errorPatterns.length,
        });
      }
    }

    // Check for module configuration files
    const moduleConfigs = analysis.relevantFiles.filter(
      f => (f.includes('.services.yml') || f.includes('.routing.yml') || f.includes('.permissions.yml')) &&
           f.includes('modules/share')
    );

    if (moduleConfigs.length > 0) {
      insights.push({
        id: 'module-configs',
        type: 'config',
        phase: 'feature',
        description: `Found ${moduleConfigs.length} module configuration file(s)`,
        relevance: 'high',
        example: moduleConfigs[0],
        recommendation: 'Follow existing module config patterns (services.yml, routing.yml, etc.)',
        count: moduleConfigs.length,
      });
    }

    return insights;
  }

  /**
   * Extract all insights for a specific phase
   */
  async extractInsightsForPhase(
    phase: 'schema' | 'test' | 'feature',
    analysis: CodebaseAnalysisResult
  ): Promise<CodebaseInsight[]> {
    switch (phase) {
      case 'schema':
        return await this.extractSchemaInsights(analysis);
      case 'test':
        return await this.extractTestInsights(analysis);
      case 'feature':
        return await this.extractFeatureInsights(analysis);
      default:
        return [];
    }
  }
}
