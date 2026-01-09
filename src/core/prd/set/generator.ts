import { stringify as yamlStringify } from 'yaml';
import { ParsedPlanningDoc, ParsedPhase } from '../parser/planning-doc-parser';
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
 */
export class PrdSetGenerator {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Generate PRD set files from a parsed planning document
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

  private generateManifest(parsedDoc: ParsedPlanningDoc, setId: string): GeneratedFile {
    const manifest: Record<string, any> = {
      // Parent PRD with status: split
      prd: {
        id: setId,
        version: parsedDoc.version,
        status: parsedDoc.phases.length > 1 ? 'split' : 'ready',
        note: parsedDoc.phases.length > 1
          ? `This PRD has been split into ${parsedDoc.phases.length} phased PRDs.`
          : undefined,
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
            ? `phase${phase.id}_${this.slugify(phase.name)}.md`
            : undefined,
          config: phase.config,
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
        dependedOnBy: parsedDoc.phases.map(phase =>
          `${setId}_phase${phase.id}`
        ),
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
    const filename = `phase${phase.id}_${this.slugify(phase.name)}.md`;

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

