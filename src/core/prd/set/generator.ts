import { stringify as yamlStringify } from 'yaml';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ParsedPlanningDoc, ParsedPhase } from '../parser/planning-doc-parser';
import { DiscoveredPrdSet } from './discovery';
import { BuildMode } from '../../conversation/types';
import { logger } from '../../utils/logger';

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
}

