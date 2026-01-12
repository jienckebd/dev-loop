import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ParsedPlanningDoc, ParsedPhase } from '../parser/planning-doc-parser';
import { DiscoveredPrdSet } from './discovery';
import { BuildMode } from '../../conversation/types';
import { logger } from '../../utils/logger';
import { Config } from '../../../config/schema/core';

/**
 * Represents a generated file
 */
export interface GeneratedFile {
  filename: string;
  content: string;
  type: 'manifest' | 'prd' | 'config';
}

/**
 * Generator for creating PRD set structures from parsed planning documents
 * Supports all three modes: convert, enhance, create
 */
export class PrdSetGenerator {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Generate PRD set files from a parsed planning document (convert/create mode)
   */
  async generate(
    parsedDoc: ParsedPlanningDoc,
    outputDir: string,
    setId: string
  ): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // Generate the PRD set manifest (index.md.yml)
    files.push(this.generateManifest(parsedDoc, setId));

    // Generate config overlay file if there's project-specific config
    if (parsedDoc.configOverlay && Object.keys(parsedDoc.configOverlay).length > 0) {
      files.push(this.generateConfigOverlay(parsedDoc.configOverlay));
    }

    // Generate individual phase PRD files if there are multiple phases
    if (parsedDoc.phases.length > 1) {
      for (const phase of parsedDoc.phases) {
        files.push(this.generatePhasePrd(parsedDoc, phase, setId));
      }
    }

    return files;
  }

  /**
   * Generate PRD set files from an existing PRD set (enhance mode)
   */
  async generateFromPrdSet(
    prdSet: DiscoveredPrdSet,
    outputDir: string,
    options?: {
      preserveExisting?: boolean;
      mode?: BuildMode;
    }
  ): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];
    const preserveExisting = options?.preserveExisting !== false; // Default to true

    // Load existing manifest and PRD files
    const existingManifest = prdSet.manifest;
    const existingDir = prdSet.directory;

    // Generate updated manifest (preserve existing if preserveExisting is true)
    if (preserveExisting && fs.existsSync(prdSet.indexPath)) {
      // Read existing manifest
      const existingContent = await fs.readFile(prdSet.indexPath, 'utf-8');
      files.push({
        filename: 'index.md.yml',
        content: existingContent,
        type: 'manifest',
      });
    } else {
      // Generate new manifest
      // This would require parsing the PRD set into ParsedPlanningDoc format
      // For now, use existing manifest structure
      const manifestContent = yamlStringify(existingManifest, { indent: 2, lineWidth: 100 });
      files.push({
        filename: 'index.md.yml',
        content: `---\n${manifestContent}---\n`,
        type: 'manifest',
      });
    }

    // Generate config overlay if present
    if (prdSet.configOverlay && Object.keys(prdSet.configOverlay).length > 0) {
      files.push(this.generateConfigOverlay(prdSet.configOverlay));
    }

    return files;
  }

  /**
   * Generate PRD set files (unified method for all modes)
   */
  async generatePrdSet(
    input: ParsedPlanningDoc | DiscoveredPrdSet,
    outputDir: string,
    setId: string,
    mode: BuildMode = 'convert'
  ): Promise<GeneratedFile[]> {
    if ('prdSet' in input) {
      // DiscoveredPrdSet (enhance mode)
      return await this.generateFromPrdSet(input, outputDir, { mode });
    } else {
      // ParsedPlanningDoc (convert/create mode)
      return await this.generate(input, outputDir, setId);
    }
  }

  private generateManifest(parsedDoc: ParsedPlanningDoc, setId: string): GeneratedFile {
    // PRD sets (index.md.yml) should always have status 'split' per validator requirements
    // The validator checks for status 'split' on parent PRDs in PRD set structures
    const hasMultiplePhases = parsedDoc.phases.length > 1;
    const hasTasks = parsedDoc.phases.some(phase => phase.tasks && phase.tasks.length > 0);
    
    const manifest: Record<string, any> = {
      // Parent PRD with status: split (required for PRD set structure per validator)
      prd: {
        id: setId,
        version: parsedDoc.version,
        status: 'split', // PRD sets always have status 'split' per PrdSetValidator.validateSetLevel()
        note: hasMultiplePhases
          ? `This PRD has been split into ${parsedDoc.phases.length} phased PRDs.`
          : (hasTasks 
              ? `This PRD set contains ${parsedDoc.phases[0]?.tasks?.length || 0} task(s) in a single phase.`
              : `PRD set structure generated from planning document.`),
      },
      execution: {
        strategy: 'phased',
        mode: 'autonomous',
      },
      dependencies: parsedDoc.dependencies || {},
      requirements: {
        idPattern: 'TASK-{id}',
        phases: parsedDoc.phases.map(phase => ({
          id: phase.id,
          name: phase.name,
          parallel: phase.parallel || false,
          dependsOn: phase.dependsOn,
          status: phase.status || 'pending',
          checkpoint: phase.checkpoint || false,
          file: parsedDoc.phases.length > 1
            ? `phase${phase.id}_${this.slugify(phase.name)}.md.yml`
            : undefined,
          config: phase.config,
          tasks: phase.tasks?.map(task => ({
            id: task.id,
            title: task.title,
            description: task.description,
            testStrategy: task.testStrategy,
            validationChecklist: task.validationChecklist,
            dependencies: task.dependencies,
            files: task.files,
          })),
        })),
      },
      testing: parsedDoc.testing || {
        directory: 'tests/playwright/',
      },
    };

    // Add config overlay reference if present
    if (parsedDoc.configOverlay && Object.keys(parsedDoc.configOverlay).length > 0) {
      manifest.config = parsedDoc.configOverlay;
    }

    // Add relationships for split PRDs
    if (parsedDoc.phases.length > 1) {
      manifest.relationships = {
        dependedOnBy: parsedDoc.phases.map(phase => ({
          prd: `${setId}_phase${phase.id}`,
          features: [phase.name.toLowerCase().replace(/\s+/g, '_')],
        })),
      };
    }

    const yamlContent = yamlStringify(manifest, {
      indent: 2,
      lineWidth: 100,
    });

    return {
      filename: 'index.md.yml',
      content: `---\n${yamlContent}---\n\n# ${parsedDoc.title || setId}\n\n${parsedDoc.description || 'PRD Set generated from planning document.'}\n`,
      type: 'manifest',
    };
  }

  private generateConfigOverlay(configOverlay: Record<string, any>): GeneratedFile {
    const content = JSON.stringify(configOverlay, null, 2);
    return {
      filename: 'prd-set-config.json',
      content,
      type: 'config',
    };
  }

  private generatePhasePrd(
    parsedDoc: ParsedPlanningDoc,
    phase: ParsedPhase,
    setId: string
  ): GeneratedFile {
    const prdId = `${setId}_phase${phase.id}`;
    // Use .md.yml extension to match dev-loop PRD schema format
    const filename = `phase${phase.id}_${this.slugify(phase.name)}.md.yml`;

    const frontmatter: Record<string, any> = {
      prd: {
        id: prdId,
        version: parsedDoc.version,
        status: phase.status === 'complete' || phase.status === 'done' ? 'done' : 'ready',
        parentPrd: setId,
        prdSequence: phase.id,
      },
      execution: {
        strategy: 'phased',
      },
      requirements: {
        idPattern: 'TASK-{id}',
        phases: [{
          id: 1,
          name: phase.name,
          parallel: phase.parallel || false,
          tasks: phase.tasks?.map(task => ({
            id: task.id,
            title: task.title,
            description: task.description,
            testStrategy: task.testStrategy,
            validationChecklist: task.validationChecklist,
            dependencies: task.dependencies,
            files: task.files,
          })),
        }],
      },
      testing: parsedDoc.testing || {
        directory: `tests/playwright/${this.slugify(phase.name)}/`,
      },
    };

    // Add phase-specific config if present
    if (phase.config) {
      frontmatter.config = phase.config;
    }

    // Add dependencies if present
    if (phase.dependsOn && phase.dependsOn.length > 0) {
      frontmatter.dependencies = {
        prds: phase.dependsOn.map(depId => `${setId}_phase${depId}`),
      };
    }

    const yamlContent = yamlStringify(frontmatter, {
      indent: 2,
      lineWidth: 100,
    });

    // Generate task list if tasks are present
    let taskContent = '';
    if (phase.tasks && phase.tasks.length > 0) {
      taskContent = '\n## Tasks\n\n';
      for (const task of phase.tasks) {
        taskContent += `### ${task.id}: ${task.title}\n\n`;
        taskContent += `${task.description}\n\n`;
        if (task.testStrategy) {
          taskContent += `**Test Strategy:** ${task.testStrategy}\n\n`;
        }
        if (task.validationChecklist && task.validationChecklist.length > 0) {
          taskContent += '**Validation Checklist:**\n';
          for (const item of task.validationChecklist) {
            taskContent += `- [ ] ${item}\n`;
          }
          taskContent += '\n';
        }
      }
    }

    return {
      filename,
      content: `---\n${yamlContent}---\n\n# Phase ${phase.id}: ${phase.name}\n\n${phase.description || 'Phase implementation.'}\n${taskContent}`,
      type: 'prd',
    };
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 30);
  }

  /**
   * Detect actual ID pattern from tasks and update PRD set files
   * @param prdSetDir - Directory containing PRD set files
   * @param setId - PRD set ID
   * @returns true if fix was applied, false otherwise
   */
  async fixIdPattern(prdSetDir: string, setId: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) {
      return false;
    }

    // Read and parse index.md.yml
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);
    const allTaskIds: string[] = [];

    // Extract task IDs from parent PRD
    if (indexYaml.requirements?.phases) {
      for (const phase of indexYaml.requirements.phases) {
        if (phase.tasks) {
          for (const task of phase.tasks) {
            if (task.id) allTaskIds.push(task.id);
          }
        }
      }
    }

    // Extract task IDs from child PRD files
    const phaseFiles = await fs.readdir(prdSetDir);
    for (const file of phaseFiles) {
      if (file.startsWith('phase') && file.endsWith('.md.yml')) {
        const phasePath = path.join(prdSetDir, file);
        const phaseContent = await fs.readFile(phasePath, 'utf-8');
        const phaseMatch = phaseContent.match(/^---\n([\s\S]*?)\n---/);
        if (phaseMatch) {
          const phaseYaml = yamlParse(phaseMatch[1]);
          if (phaseYaml.requirements?.phases?.[0]?.tasks) {
            for (const task of phaseYaml.requirements.phases[0].tasks) {
              if (task.id) allTaskIds.push(task.id);
            }
          }
        }
      }
    }

    if (allTaskIds.length === 0) return false;

    // Detect pattern from task IDs (e.g., REQ-1.1 -> REQ-{id})
    const firstTaskId = allTaskIds[0];
    const patternMatch = firstTaskId.match(/^([A-Z]+)-/);
    if (!patternMatch) return false;

    const detectedPattern = `${patternMatch[1]}-{id}`;
    const currentPattern = indexYaml.requirements?.idPattern || 'TASK-{id}';

    // If pattern matches, no fix needed
    if (currentPattern === detectedPattern) return false;

    if (this.debug) {
      logger.debug(`[PrdSetGenerator] Fixing ID pattern: ${currentPattern} -> ${detectedPattern}`);
    }

    // Update idPattern in index.md.yml
    indexYaml.requirements.idPattern = detectedPattern;
    const updatedIndexYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
    const updatedIndexContent = `---\n${updatedIndexYaml}---${indexContent.substring(indexMatch[0].length)}`;
    await fs.writeFile(indexPath, updatedIndexContent, 'utf-8');

    // Update idPattern in all phase files
    for (const file of phaseFiles) {
      if (file.startsWith('phase') && file.endsWith('.md.yml')) {
        const phasePath = path.join(prdSetDir, file);
        const phaseContent = await fs.readFile(phasePath, 'utf-8');
        const phaseMatch = phaseContent.match(/^---\n([\s\S]*?)\n---/);
        if (phaseMatch) {
          const phaseYaml = yamlParse(phaseMatch[1]);
          phaseYaml.requirements.idPattern = detectedPattern;
          const updatedPhaseYaml = yamlStringify(phaseYaml, { indent: 2, lineWidth: 100 });
          const updatedPhaseContent = `---\n${updatedPhaseYaml}---${phaseContent.substring(phaseMatch[0].length)}`;
          await fs.writeFile(phasePath, updatedPhaseContent, 'utf-8');
        }
      }
    }

    return true;
  }

  /**
   * Fix testing configuration using project config
   * @param prdSetDir - Directory containing PRD set files
   * @param projectConfig - Project configuration from devloop.config.js
   * @returns true if fix was applied, false otherwise
   */
  async fixTestingConfig(prdSetDir: string, projectConfig?: Config): Promise<boolean> {
    if (!projectConfig) return false;

    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) {
      return false;
    }

    // Read and parse index.md.yml
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);
    let fixApplied = false;

    // Get framework from config (e.g., 'drupal' from framework plugin)
    const framework = (projectConfig as any).framework?.name || 
                      (projectConfig as any).framework ||
                      undefined;

    // Get test runner from config.testing.runner
    const runner = (projectConfig as any).testing?.runner || 'playwright';

    // Get test directory from config.testGeneration.testDir or config.testing
    const testDir = (projectConfig as any).testGeneration?.testDir ||
                    (projectConfig as any).testing?.directory ||
                    'tests/playwright/';

    // Initialize testing section if missing
    if (!indexYaml.testing) {
      indexYaml.testing = {};
      fixApplied = true;
    }

    // Update testing configuration
    if (framework && !indexYaml.testing.framework) {
      indexYaml.testing.framework = framework;
      fixApplied = true;
    }

    if (runner && !indexYaml.testing.runner) {
      indexYaml.testing.runner = runner;
      fixApplied = true;
    }

    if (!indexYaml.testing.directory) {
      indexYaml.testing.directory = testDir;
      fixApplied = true;
    }

    // Remove incorrect 'runner' field if it exists at wrong level
    if ((indexYaml as any).runner) {
      delete (indexYaml as any).runner;
      fixApplied = true;
    }

    if (fixApplied) {
      if (this.debug) {
        logger.debug(`[PrdSetGenerator] Fixing testing config: framework=${framework}, runner=${runner}, directory=${testDir}`);
      }
      const updatedIndexYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      const updatedIndexContent = `---\n${updatedIndexYaml}---${indexContent.substring(indexMatch[0].length)}`;
      await fs.writeFile(indexPath, updatedIndexContent, 'utf-8');
    }

    return fixApplied;
  }

  /**
   * Fix missing PRD ID by setting it from set ID
   * @param prdSetDir - Directory containing PRD set files
   * @param setId - PRD set ID to use
   * @returns true if fix was applied, false otherwise
   */
  async fixMissingPrdId(prdSetDir: string, setId: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) return false;

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);

    if (!indexYaml.prd?.id || indexYaml.prd.id.trim() === '') {
      if (!indexYaml.prd) indexYaml.prd = {};
      indexYaml.prd.id = setId;

      if (this.debug) {
        logger.debug(`[PrdSetGenerator] Fixing missing PRD ID: ${setId}`);
      }

      const updatedYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      await fs.writeFile(indexPath, `---\n${updatedYaml}---\n`, 'utf-8');
      return true;
    }
    return false;
  }

  /**
   * Fix missing title by generating from set ID
   * @param prdSetDir - Directory containing PRD set files
   * @param setId - PRD set ID to derive title from
   * @returns true if fix was applied, false otherwise
   */
  async fixMissingTitle(prdSetDir: string, setId: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) return false;

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);

    if (!indexYaml.prd?.title || indexYaml.prd.title.trim() === '') {
      if (!indexYaml.prd) indexYaml.prd = {};
      // Convert set ID to title case: "my-module" -> "My Module"
      indexYaml.prd.title = setId
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase());

      if (this.debug) {
        logger.debug(`[PrdSetGenerator] Fixing missing title: ${indexYaml.prd.title}`);
      }

      const updatedYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      await fs.writeFile(indexPath, `---\n${updatedYaml}---\n`, 'utf-8');
      return true;
    }
    return false;
  }

  /**
   * Fix missing phase names by auto-generating "Phase N"
   * @param prdSetDir - Directory containing PRD set files
   * @returns true if fix was applied, false otherwise
   */
  async fixMissingPhaseName(prdSetDir: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) return false;

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);
    let fixApplied = false;

    if (indexYaml.requirements?.phases) {
      for (const phase of indexYaml.requirements.phases) {
        if (!phase.name || phase.name.trim() === '') {
          phase.name = `Phase ${phase.id}`;
          fixApplied = true;
          if (this.debug) {
            logger.debug(`[PrdSetGenerator] Fixing missing phase name for phase ${phase.id}`);
          }
        }
      }
    }

    if (fixApplied) {
      const updatedYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      await fs.writeFile(indexPath, `---\n${updatedYaml}---\n`, 'utf-8');
    }
    return fixApplied;
  }

  /**
   * Fix missing task titles by deriving from task ID
   * @param prdSetDir - Directory containing PRD set files
   * @returns true if fix was applied, false otherwise
   */
  async fixMissingTaskTitles(prdSetDir: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) return false;

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);
    let fixApplied = false;

    if (indexYaml.requirements?.phases) {
      for (const phase of indexYaml.requirements.phases) {
        if (phase.tasks) {
          for (const task of phase.tasks) {
            if (!task.title || task.title.trim() === '') {
              // Convert task ID to title: "TASK-1.1" -> "Task 1.1"
              task.title = task.id
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, (c: string) => c.toUpperCase());
              fixApplied = true;
              if (this.debug) {
                logger.debug(`[PrdSetGenerator] Fixing missing task title for ${task.id}`);
              }
            }
          }
        }
      }
    }

    if (fixApplied) {
      const updatedYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      await fs.writeFile(indexPath, `---\n${updatedYaml}---\n`, 'utf-8');
    }
    return fixApplied;
  }

  /**
   * Fix missing task descriptions by generating placeholder
   * @param prdSetDir - Directory containing PRD set files
   * @returns true if fix was applied, false otherwise
   */
  async fixMissingTaskDescriptions(prdSetDir: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) return false;

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);
    let fixApplied = false;

    if (indexYaml.requirements?.phases) {
      for (const phase of indexYaml.requirements.phases) {
        if (phase.tasks) {
          for (const task of phase.tasks) {
            if (!task.description || task.description.trim() === '') {
              task.description = `Implementation of ${task.title || task.id}`;
              fixApplied = true;
              if (this.debug) {
                logger.debug(`[PrdSetGenerator] Fixing missing task description for ${task.id}`);
              }
            }
          }
        }
      }
    }

    if (fixApplied) {
      const updatedYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      await fs.writeFile(indexPath, `---\n${updatedYaml}---\n`, 'utf-8');
    }
    return fixApplied;
  }

  /**
   * Fix empty phases by adding placeholder tasks
   * @param prdSetDir - Directory containing PRD set files
   * @returns true if fix was applied, false otherwise
   */
  async fixEmptyPhases(prdSetDir: string): Promise<boolean> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    if (!await fs.pathExists(indexPath)) return false;

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const indexMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
    if (!indexMatch) return false;

    const indexYaml = yamlParse(indexMatch[1]);
    const idPattern = indexYaml.requirements?.idPattern || 'TASK-{id}';
    const prefix = idPattern.split('{id}')[0];
    let fixApplied = false;

    if (indexYaml.requirements?.phases) {
      for (const phase of indexYaml.requirements.phases) {
        if (!phase.tasks || phase.tasks.length === 0) {
          phase.tasks = [{
            id: `${prefix}${phase.id}.1`,
            title: `${phase.name || `Phase ${phase.id}`} - Task 1`,
            description: `Implement ${phase.name || `phase ${phase.id}`} functionality`,
            status: 'pending',
          }];
          fixApplied = true;
          if (this.debug) {
            logger.debug(`[PrdSetGenerator] Fixing empty phase ${phase.id} with placeholder task`);
          }
        }
      }
    }

    if (fixApplied) {
      const updatedYaml = yamlStringify(indexYaml, { indent: 2, lineWidth: 100 });
      await fs.writeFile(indexPath, `---\n${updatedYaml}---\n`, 'utf-8');
    }
    return fixApplied;
  }
}

