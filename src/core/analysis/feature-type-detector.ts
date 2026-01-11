/**
 * Feature Type Detector
 *
 * Detects feature types from codebase analysis.
 * Uses patterns and heuristics to identify feature types like entities, forms, plugins, services, etc.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { CodebaseAnalysisResult } from './codebase-analyzer';
import { FrameworkPlugin } from '../../frameworks';
import { logger } from '../utils/logger';

/**
 * Feature Type
 */
export type FeatureType =
  | 'entity'
  | 'form'
  | 'plugin'
  | 'service'
  | 'controller'
  | 'validator'
  | 'schema'
  | 'config'
  | 'api'
  | 'test'
  | 'migration'
  | 'field'
  | 'custom';

/**
 * Feature Type Detection Result
 */
export interface FeatureTypeDetectionResult {
  featureTypes: FeatureType[];
  confidence: Map<FeatureType, number>; // Confidence score 0-1
  evidence: Map<FeatureType, string[]>; // Evidence for each feature type
}

/**
 * Feature Type Detector Configuration
 */
export interface FeatureTypeDetectorConfig {
  projectRoot: string;
  frameworkPlugin?: FrameworkPlugin;
  debug?: boolean;
}

/**
 * Detects feature types from codebase analysis
 */
export class FeatureTypeDetector {
  private config: FeatureTypeDetectorConfig & { debug: boolean };
  private debug: boolean;

  constructor(config: FeatureTypeDetectorConfig) {
    this.config = {
      projectRoot: config.projectRoot,
      frameworkPlugin: config.frameworkPlugin, // Optional, can be undefined
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
  }

  /**
   * Detect feature types from codebase analysis
   */
  async detectFeatureTypes(
    analysis: CodebaseAnalysisResult
  ): Promise<FeatureTypeDetectionResult> {
    logger.debug('[FeatureTypeDetector] Detecting feature types from codebase analysis');

    const confidence = new Map<FeatureType, number>();
    const evidence = new Map<FeatureType, string[]>();

    // Analyze files and contexts
    for (const [filePath, context] of analysis.fileContexts.entries()) {
      const detectedTypes = this.analyzeFile(filePath, context, analysis.frameworkPlugin);

      for (const [type, fileEvidence] of detectedTypes) {
        // Update confidence based on multiple matches
        const currentConfidence = confidence.get(type) || 0;
        confidence.set(type, Math.min(currentConfidence + 0.2, 1.0));

        // Add evidence
        if (!evidence.has(type)) {
          evidence.set(type, []);
        }
        evidence.get(type)!.push(fileEvidence);
      }
    }

    // Analyze file paths
    for (const filePath of analysis.relevantFiles) {
      const pathTypes = this.analyzeFilePath(filePath, analysis.frameworkPlugin);
      for (const type of pathTypes) {
        const currentConfidence = confidence.get(type) || 0;
        confidence.set(type, Math.min(currentConfidence + 0.15, 1.0));

        if (!evidence.has(type)) {
          evidence.set(type, []);
        }
        evidence.get(type)!.push(`File path: ${filePath}`);
      }
    }

    // Analyze patterns
    if (analysis.patterns) {
      for (const pattern of analysis.patterns) {
        const patternTypes = this.analyzePattern(pattern, analysis.frameworkPlugin);
        for (const type of patternTypes) {
          const currentConfidence = confidence.get(type) || 0;
          confidence.set(type, Math.min(currentConfidence + 0.1, 1.0));

          if (!evidence.has(type)) {
            evidence.set(type, []);
          }
          evidence.get(type)!.push(`Pattern: ${pattern.signature}`);
        }
      }
    }

    // Filter by minimum confidence threshold
    const featureTypes = Array.from(confidence.entries())
      .filter(([_, conf]) => conf >= 0.3) // Minimum 30% confidence
      .sort(([_, a], [__, b]) => b - a) // Sort by confidence (highest first)
      .map(([type, _]) => type);

    logger.debug(
      `[FeatureTypeDetector] Detected feature types: ${featureTypes.join(', ')}`
    );

    return {
      featureTypes,
      confidence,
      evidence,
    };
  }

  /**
   * Analyze a file for feature types
   */
  private analyzeFile(
    filePath: string,
    context: any, // FileContext from CodeContextProvider
    frameworkPlugin?: FrameworkPlugin
  ): Map<FeatureType, string> {
    const detectedTypes = new Map<FeatureType, string>();
    const fileName = path.basename(filePath);
    const content = context.skeleton || context.fullContent || '';

    // Analyze file name
    if (fileName.includes('Entity') || fileName.includes('entity')) {
      detectedTypes.set('entity', `File name contains 'entity': ${fileName}`);
    }
    if (fileName.includes('Form') || fileName.includes('form')) {
      detectedTypes.set('form', `File name contains 'form': ${fileName}`);
    }
    if (fileName.includes('Plugin') || fileName.includes('plugin')) {
      detectedTypes.set('plugin', `File name contains 'plugin': ${fileName}`);
    }
    if (fileName.includes('Service') || fileName.includes('service')) {
      detectedTypes.set('service', `File name contains 'service': ${fileName}`);
    }
    if (fileName.includes('Controller') || fileName.includes('controller')) {
      detectedTypes.set('controller', `File name contains 'controller': ${fileName}`);
    }
    if (fileName.includes('Validator') || fileName.includes('validator')) {
      detectedTypes.set('validator', `File name contains 'validator': ${fileName}`);
    }
    if (fileName.includes('schema') || filePath.includes('schema')) {
      detectedTypes.set('schema', `File path contains 'schema': ${filePath}`);
    }
    if (fileName.includes('config') || filePath.includes('config')) {
      detectedTypes.set('config', `File path contains 'config': ${filePath}`);
    }
    if (fileName.includes('Migration') || fileName.includes('migration')) {
      detectedTypes.set('migration', `File name contains 'migration': ${fileName}`);
    }
    if (fileName.includes('Field') || fileName.includes('field')) {
      detectedTypes.set('field', `File name contains 'field': ${fileName}`);
    }
    if (fileName.includes('Api') || fileName.includes('api') || fileName.includes('API')) {
      detectedTypes.set('api', `File name contains 'api': ${fileName}`);
    }
    if (fileName.includes('.test.') || fileName.includes('.spec.')) {
      detectedTypes.set('test', `File name indicates test: ${fileName}`);
    }

    // Analyze content signatures
    if (context.helperSignatures) {
      for (const signature of context.helperSignatures) {
        const sigLower = signature.toLowerCase();

        if (sigLower.includes('extends') && sigLower.includes('entity')) {
          detectedTypes.set('entity', `Signature extends entity: ${signature}`);
        }
        if (sigLower.includes('implements') && sigLower.includes('form')) {
          detectedTypes.set('form', `Signature implements form: ${signature}`);
        }
        if (sigLower.includes('plugin') || sigLower.includes('annotated')) {
          detectedTypes.set('plugin', `Signature suggests plugin: ${signature}`);
        }
        if (sigLower.includes('service') || sigLower.includes('inject')) {
          detectedTypes.set('service', `Signature suggests service: ${signature}`);
        }
        if (sigLower.includes('controller')) {
          detectedTypes.set('controller', `Signature suggests controller: ${signature}`);
        }
        if (sigLower.includes('validate') || sigLower.includes('validator')) {
          detectedTypes.set('validator', `Signature suggests validator: ${signature}`);
        }
      }
    }

    // Analyze imports
    if (context.imports) {
      for (const imp of context.imports) {
        const impLower = imp.toLowerCase();

        if (impLower.includes('entity') && !impLower.includes('test')) {
          detectedTypes.set('entity', `Import suggests entity: ${imp}`);
        }
        if (impLower.includes('form')) {
          detectedTypes.set('form', `Import suggests form: ${imp}`);
        }
        if (impLower.includes('plugin')) {
          detectedTypes.set('plugin', `Import suggests plugin: ${imp}`);
        }
        if (impLower.includes('service') || impLower.includes('inject')) {
          detectedTypes.set('service', `Import suggests service: ${imp}`);
        }
        if (impLower.includes('controller')) {
          detectedTypes.set('controller', `Import suggests controller: ${imp}`);
        }
        if (impLower.includes('api') || impLower.includes('rest')) {
          detectedTypes.set('api', `Import suggests API: ${imp}`);
        }
      }
    }

    // Framework-specific detection
    if (frameworkPlugin) {
      const frameworkTypes = this.detectFrameworkSpecificTypes(
        filePath,
        context,
        frameworkPlugin
      );
      for (const [type, evidence] of frameworkTypes) {
        detectedTypes.set(type, evidence);
      }
    }

    return detectedTypes;
  }

  /**
   * Analyze file path for feature types
   */
  private analyzeFilePath(
    filePath: string,
    frameworkPlugin?: FrameworkPlugin
  ): FeatureType[] {
    const types: FeatureType[] = [];
    const normalizedPath = filePath.toLowerCase();

    // Directory-based detection
    if (normalizedPath.includes('/entity/') || normalizedPath.includes('\\entity\\')) {
      types.push('entity');
    }
    if (normalizedPath.includes('/form/') || normalizedPath.includes('\\form\\')) {
      types.push('form');
    }
    if (normalizedPath.includes('/plugin/') || normalizedPath.includes('\\plugin\\')) {
      types.push('plugin');
    }
    if (normalizedPath.includes('/service/') || normalizedPath.includes('\\service\\')) {
      types.push('service');
    }
    if (normalizedPath.includes('/controller/') || normalizedPath.includes('\\controller\\')) {
      types.push('controller');
    }
    if (normalizedPath.includes('/schema/') || normalizedPath.includes('\\schema\\')) {
      types.push('schema');
    }
    if (normalizedPath.includes('/config/') || normalizedPath.includes('\\config\\')) {
      types.push('config');
    }
    if (normalizedPath.includes('/api/') || normalizedPath.includes('\\api\\')) {
      types.push('api');
    }
    if (normalizedPath.includes('/migration/') || normalizedPath.includes('\\migration\\')) {
      types.push('migration');
    }
    if (normalizedPath.includes('/field/') || normalizedPath.includes('\\field\\')) {
      types.push('field');
    }
    if (
      normalizedPath.includes('/test/') ||
      normalizedPath.includes('\\test\\') ||
      normalizedPath.includes('/tests/') ||
      normalizedPath.includes('\\tests\\')
    ) {
      types.push('test');
    }

    // Extension-based detection
    if (filePath.endsWith('.schema.yml') || filePath.endsWith('.schema.yaml')) {
      types.push('schema');
    }
    if (filePath.endsWith('.config.yml') || filePath.endsWith('.config.yaml')) {
      types.push('config');
    }

    return types;
  }

  /**
   * Analyze pattern for feature types
   */
  private analyzePattern(
    pattern: { type: string; signature: string; files: string[] },
    frameworkPlugin?: FrameworkPlugin
  ): FeatureType[] {
    const types: FeatureType[] = [];
    const sigLower = pattern.signature.toLowerCase();

    if (sigLower.includes('entity')) {
      types.push('entity');
    }
    if (sigLower.includes('form')) {
      types.push('form');
    }
    if (sigLower.includes('plugin')) {
      types.push('plugin');
    }
    if (sigLower.includes('service')) {
      types.push('service');
    }
    if (sigLower.includes('controller')) {
      types.push('controller');
    }
    if (sigLower.includes('validator') || sigLower.includes('validate')) {
      types.push('validator');
    }
    if (sigLower.includes('schema')) {
      types.push('schema');
    }
    if (sigLower.includes('config')) {
      types.push('config');
    }
    if (sigLower.includes('api') || sigLower.includes('rest')) {
      types.push('api');
    }

    return types;
  }

  /**
   * Detect framework-specific feature types
   */
  private detectFrameworkSpecificTypes(
    filePath: string,
    context: any,
    frameworkPlugin: FrameworkPlugin
  ): Map<FeatureType, string> {
    const types = new Map<FeatureType, string>();

    // Drupal-specific detection
    if (frameworkPlugin.name === 'drupal') {
      // Drupal entity types
      if (filePath.includes('entity_type') || filePath.includes('entity_type.yml')) {
        types.set('entity', 'Drupal entity type definition');
      }

      // Drupal plugins
      if (
        filePath.includes('/Plugin/') ||
        filePath.includes('\\Plugin\\') ||
        context.helperSignatures?.some((sig: string) =>
          sig.includes('@Plugin')
        )
      ) {
        types.set('plugin', 'Drupal plugin');
      }

      // Drupal services
      if (
        filePath.includes('services.yml') ||
        filePath.includes('services.yaml') ||
        context.imports?.some((imp: string) => imp.includes('Symfony\\Component\\DependencyInjection'))
      ) {
        types.set('service', 'Drupal service');
      }

      // Drupal config schemas
      if (
        filePath.includes('schema') ||
        filePath.endsWith('.schema.yml') ||
        context.imports?.some((imp: string) => imp.includes('TypedDataInterface'))
      ) {
        types.set('schema', 'Drupal config schema');
      }

      // Drupal forms
      if (
        filePath.includes('Form') ||
        context.helperSignatures?.some((sig: string) =>
          sig.includes('FormInterface') || sig.includes('FormBase')
        )
      ) {
        types.set('form', 'Drupal form');
      }

      // Drupal controllers
      if (
        filePath.includes('Controller') ||
        context.helperSignatures?.some((sig: string) => sig.includes('ControllerBase'))
      ) {
        types.set('controller', 'Drupal controller');
      }
    }

    // Django-specific detection
    if (frameworkPlugin.name === 'django') {
      if (filePath.includes('models.py')) {
        types.set('entity', 'Django model');
      }
      if (filePath.includes('forms.py')) {
        types.set('form', 'Django form');
      }
      if (filePath.includes('views.py')) {
        types.set('controller', 'Django view');
      }
      if (filePath.includes('serializers.py')) {
        types.set('api', 'Django REST API');
      }
    }

    // React-specific detection
    if (frameworkPlugin.name === 'react') {
      if (filePath.includes('components/') || filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
        types.set('plugin', 'React component');
      }
      if (filePath.includes('hooks/') || filePath.includes('use')) {
        types.set('service', 'React hook');
      }
      if (filePath.includes('api/') || filePath.includes('services/')) {
        types.set('api', 'React API service');
      }
    }

    return types;
  }

  /**
   * Detect feature types from a simple query/prompt (for create mode)
   */
  async detectFromPrompt(prompt: string): Promise<FeatureType[]> {
    const types: FeatureType[] = [];
    const promptLower = prompt.toLowerCase();

    // Simple keyword-based detection
    if (promptLower.includes('entity') || promptLower.includes('model')) {
      types.push('entity');
    }
    if (promptLower.includes('form')) {
      types.push('form');
    }
    if (promptLower.includes('plugin')) {
      types.push('plugin');
    }
    if (promptLower.includes('service')) {
      types.push('service');
    }
    if (promptLower.includes('controller') || promptLower.includes('route')) {
      types.push('controller');
    }
    if (promptLower.includes('validate') || promptLower.includes('validator')) {
      types.push('validator');
    }
    if (promptLower.includes('schema') || promptLower.includes('config schema')) {
      types.push('schema');
    }
    if (promptLower.includes('config') || promptLower.includes('configuration')) {
      types.push('config');
    }
    if (promptLower.includes('api') || promptLower.includes('rest') || promptLower.includes('endpoint')) {
      types.push('api');
    }
    if (promptLower.includes('migration') || promptLower.includes('migrate')) {
      types.push('migration');
    }
    if (promptLower.includes('field')) {
      types.push('field');
    }
    if (promptLower.includes('test') || promptLower.includes('testing')) {
      types.push('test');
    }

    // If no specific types detected, mark as custom
    if (types.length === 0) {
      types.push('custom');
    }

    return types;
  }
}
