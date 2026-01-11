import * as fs from 'fs-extra';
import * as path from 'path';
import { parse as yamlParse } from 'yaml';
import { logger } from '../../utils/logger';

/**
 * Represents a parsed phase from a planning document
 */
export interface ParsedPhase {
  id: number;
  name: string;
  description?: string;
  dependsOn?: number[];
  parallel?: boolean;
  status?: string;
  tasks?: ParsedTask[];
  config?: Record<string, any>;
  checkpoint?: boolean;
}

/**
 * Represents a parsed task from a planning document
 */
export interface ParsedTask {
  id: string;
  title: string;
  description: string;
  testStrategy?: string;
  validationChecklist?: string[];
  dependencies?: string[];
  files?: string[];
}

/**
 * Represents the complete parsed structure of a planning document
 */
export interface ParsedPlanningDoc {
  prdId: string;
  version: string;
  status: string;
  title: string;
  description?: string;
  phases: ParsedPhase[];
  configOverlay?: Record<string, any>;
  testing?: {
    directory: string;
    runner?: string;
    command?: string;
  };
  dependencies?: {
    externalModules?: string[];
    prds?: string[];
    codeRequirements?: string[];
  };
  rawFrontmatter?: Record<string, any>;
  rawContent: string;
}

/**
 * Parser for converting planning documents into structured PRD data
 */
export class PlanningDocParser {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Parse a planning document file
   */
  async parse(filePath: string): Promise<ParsedPlanningDoc> {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseContent(content, path.basename(filePath));
  }

  /**
   * Parse planning document content
   */
  parseContent(content: string, filename: string): ParsedPlanningDoc {
    const { frontmatter, body } = this.extractFrontmatter(content);

    // Extract basic metadata
    const prdId = frontmatter?.prd?.id || this.extractPrdIdFromFilename(filename);
    const version = frontmatter?.prd?.version || '1.0.0';
    const status = frontmatter?.prd?.status || 'ready';
    const title = this.extractTitle(body) || filename.replace(/\.md$/, '');

    // Extract phases
    const phases = this.extractPhases(frontmatter, body);

    // Extract config overlay (project-specific config)
    const configOverlay = this.extractConfigOverlay(frontmatter, body);

    // Extract testing config
    const testing = this.extractTestingConfig(frontmatter, body);

    // Extract dependencies
    const dependencies = this.extractDependencies(frontmatter, body);

    return {
      prdId,
      version,
      status,
      title,
      description: this.extractDescription(body),
      phases,
      configOverlay,
      testing,
      dependencies,
      rawFrontmatter: frontmatter,
      rawContent: content,
    };
  }

  private extractFrontmatter(content: string): { frontmatter: any; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return { frontmatter: null, body: content };
    }

    try {
      const frontmatter = yamlParse(frontmatterMatch[1]);
      return { frontmatter, body: frontmatterMatch[2] };
    } catch (error) {
      if (this.debug) {
        logger.warn(`Failed to parse frontmatter: ${error}`);
      }
      return { frontmatter: null, body: content };
    }
  }

  private extractPrdIdFromFilename(filename: string): string {
    return filename
      .replace(/\.md$/, '')
      .replace(/_prd$/, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .toLowerCase();
  }

  private extractTitle(body: string): string | undefined {
    const titleMatch = body.match(/^#\s+(.+)$/m);
    return titleMatch ? titleMatch[1].trim() : undefined;
  }

  private extractDescription(body: string): string | undefined {
    // Look for overview or description section
    const overviewMatch = body.match(/##\s*(?:Overview|Description|Introduction)\n+([\s\S]*?)(?=\n##|$)/i);
    if (overviewMatch) {
      return overviewMatch[1].trim().split('\n').slice(0, 5).join('\n');
    }
    return undefined;
  }

  private extractPhases(frontmatter: any, body: string): ParsedPhase[] {
    const phases: ParsedPhase[] = [];

    // Try to extract from frontmatter first
    if (frontmatter?.requirements?.phases) {
      for (const phase of frontmatter.requirements.phases) {
        phases.push({
          id: phase.id,
          name: phase.name,
          dependsOn: phase.dependsOn,
          parallel: phase.parallel || false,
          status: phase.status || 'pending',
          checkpoint: phase.checkpoint || false,
          config: phase.config,
          tasks: phase.tasks,
        });
      }
      return phases;
    }

    // Try to extract phases from markdown headers
    const phasePattern = /##\s*(?:Phase|Step)\s*(\d+)[:\s]*(.+?)(?=\n##|$)/gi;
    let match;
    let phaseId = 1;

    while ((match = phasePattern.exec(body)) !== null) {
      const id = parseInt(match[1], 10) || phaseId++;
      const name = match[2].trim();

      phases.push({
        id,
        name,
        parallel: false,
        status: 'pending',
      });
    }

    // Extract tasks from REQ-X.Y format in document body
    const tasks = this.extractTasksFromBody(body);
    
    // Group tasks by phase number (REQ-1.* -> phase 1, REQ-2.* -> phase 2, etc.)
    const tasksByPhase = new Map<number, ParsedTask[]>();
    for (const task of tasks) {
      // Extract phase number from task ID (REQ-1.1 -> phase 1)
      const phaseMatch = task.id.match(/^REQ-(\d+)\./);
      if (phaseMatch) {
        const phaseNum = parseInt(phaseMatch[1], 10);
        if (!tasksByPhase.has(phaseNum)) {
          tasksByPhase.set(phaseNum, []);
        }
        tasksByPhase.get(phaseNum)!.push(task);
      } else {
        // If no phase number in ID, assign to phase 1
        if (!tasksByPhase.has(1)) {
          tasksByPhase.set(1, []);
        }
        tasksByPhase.get(1)!.push(task);
      }
    }

    // Create phases from extracted tasks if phases weren't found in headers
    if (phases.length === 0 && tasksByPhase.size > 0) {
      // Create phases based on task groups
      for (const [phaseNum, phaseTasks] of tasksByPhase.entries()) {
        phases.push({
          id: phaseNum,
          name: `Phase ${phaseNum}`,
          parallel: false,
          status: 'pending',
          tasks: phaseTasks,
        });
      }
    } else if (phases.length > 0 && tasksByPhase.size > 0) {
      // Assign tasks to existing phases
      for (const phase of phases) {
        const phaseTasks = tasksByPhase.get(phase.id) || [];
        phase.tasks = phaseTasks;
      }
    }

    // If no phases found and no tasks extracted, create a single default phase
    if (phases.length === 0) {
      phases.push({
        id: 1,
        name: 'Implementation',
        parallel: false,
        status: 'pending',
        tasks: tasks.length > 0 ? tasks : undefined,
      });
    }

    return phases;
  }

  /**
   * Extract tasks from document body (REQ-X.Y format)
   */
  private extractTasksFromBody(body: string): ParsedTask[] {
    const tasks: ParsedTask[] = [];
    
    // Pattern to match REQ-X.Y: Title format
    // Matches: ### REQ-1.1: Create Module Info File
    const reqPattern = /###\s*(REQ-(\d+)\.(\d+))[:\s]*(.+?)(?=\n###|$)/gs;
    let match;

    while ((match = reqPattern.exec(body)) !== null) {
      const taskId = match[1].trim(); // REQ-1.1
      const phaseNum = parseInt(match[2], 10); // 1
      const taskNum = parseInt(match[3], 10); // 1
      const title = match[4].trim(); // Create Module Info File
      const taskContent = match[0]; // Full task section

      // Extract description
      const descMatch = taskContent.match(/\*\*Description\*\*[:\s]*\n(.+?)(?=\n\*\*|$)/is);
      const description = descMatch ? descMatch[1].trim() : title;

      // Extract target files
      const filesMatch = taskContent.match(/\*\*Target Files\*\*[:\s]*\n((?:[-*]\s+[^\n]+\n?)+)/i);
      const files: string[] = [];
      if (filesMatch) {
        const fileList = filesMatch[1];
        const filePattern = /[-*]\s+(.+)/g;
        let fileMatch;
        while ((fileMatch = filePattern.exec(fileList)) !== null) {
          // Extract file path, removing markdown code formatting
          const filePath = fileMatch[1].replace(/`/g, '').trim();
          if (filePath) {
            files.push(filePath);
          }
        }
      }

      // Extract validation checklist from Validation section
      const validationMatch = taskContent.match(/\*\*Validation\*\*[:\s]*\n(?:```\w+\n)?([\s\S]*?)(?:```)?(?=\n\*\*|$)/i);
      const validationChecklist: string[] = [];
      if (validationMatch) {
        const validationContent = validationMatch[1];
        // Extract individual validation commands/checks
        const lines = validationContent.split('\n').filter(line => line.trim() && !line.trim().startsWith('```'));
        validationChecklist.push(...lines.map(line => line.trim()));
      }

      // Extract dependencies from task content (if mentioned)
      const depsMatch = taskContent.match(/\*\*Dependencies?\*\*[:\s]*\n((?:[-*]\s+[^\n]+\n?)+)/i);
      const dependencies: string[] = [];
      if (depsMatch) {
        const depsList = depsMatch[1];
        const depPattern = /[-*]\s+([^\n]+)/g;
        let depMatch;
        while ((depMatch = depPattern.exec(depsList)) !== null) {
          dependencies.push(depMatch[1].trim());
        }
      }

      tasks.push({
        id: taskId,
        title,
        description,
        files: files.length > 0 ? files : undefined,
        validationChecklist: validationChecklist.length > 0 ? validationChecklist : undefined,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
      });
    }

    return tasks;
  }

  private extractConfigOverlay(frontmatter: any, body: string): Record<string, any> | undefined {
    const configOverlay: Record<string, any> = {};

    // Extract from frontmatter config section
    if (frontmatter?.config) {
      Object.assign(configOverlay, frontmatter.config);
    }

    // Look for project-specific config sections in frontmatter
    const projectSpecificKeys = ['wizard', 'designSystem', 'openapi', 'entityGeneration'];
    for (const key of projectSpecificKeys) {
      if (frontmatter?.[key]) {
        configOverlay[key] = frontmatter[key];
      }
    }

    // Extract config from markdown code blocks (```yaml or ```json)
    const configBlockPattern = /```(?:yaml|json)\s*\n#?\s*(?:config|configuration)\s*\n([\s\S]*?)```/gi;
    let match;
    while ((match = configBlockPattern.exec(body)) !== null) {
      try {
        const parsed = yamlParse(match[1]);
        if (parsed && typeof parsed === 'object') {
          Object.assign(configOverlay, parsed);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return Object.keys(configOverlay).length > 0 ? configOverlay : undefined;
  }

  private extractTestingConfig(frontmatter: any, body: string): ParsedPlanningDoc['testing'] | undefined {
    if (frontmatter?.testing) {
      return {
        directory: frontmatter.testing.directory || 'tests/playwright/',
        runner: frontmatter.testing.runner || 'playwright',
        command: frontmatter.testing.command,
      };
    }

    // Look for testing section in markdown
    const testingMatch = body.match(/##\s*Testing\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (testingMatch) {
      const testingSection = testingMatch[1];
      const dirMatch = testingSection.match(/directory[:\s]+([^\n]+)/i);
      return {
        directory: dirMatch ? dirMatch[1].trim() : 'tests/playwright/',
        runner: 'playwright',
      };
    }

    return {
      directory: 'tests/playwright/',
      runner: 'playwright',
    };
  }

  private extractDependencies(frontmatter: any, body: string): ParsedPlanningDoc['dependencies'] | undefined {
    if (frontmatter?.dependencies) {
      return frontmatter.dependencies;
    }

    // Look for dependencies section in markdown
    const depsMatch = body.match(/##\s*Dependencies\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (depsMatch) {
      const depsSection = depsMatch[1];
      const codeRequirements: string[] = [];

      // Extract bullet points
      const bulletPattern = /[-*]\s+(.+)/g;
      let match;
      while ((match = bulletPattern.exec(depsSection)) !== null) {
        codeRequirements.push(match[1].trim());
      }

      if (codeRequirements.length > 0) {
        return { codeRequirements };
      }
    }

    return undefined;
  }

  /**
   * Parse PRD set index file (index.md.yml) for enhance mode
   */
  async parsePrdSetIndex(indexPath: string): Promise<ParsedPlanningDoc> {
    if (this.debug) {
      logger.debug(`[PlanningDocParser] Parsing PRD set index: ${indexPath}`);
    }

    const content = await fs.readFile(indexPath, 'utf-8');
    const { frontmatter, body } = this.extractFrontmatter(content);

    // Extract PRD set metadata
    const prdId = frontmatter?.prd?.id || this.extractPrdIdFromFilename(path.basename(indexPath));
    const version = frontmatter?.prd?.version || '1.0.0';
    const status = frontmatter?.prd?.status || 'ready';
    const title = this.extractTitle(body) || prdId;

    // Extract phases from manifest
    const phases: ParsedPhase[] = [];
    if (frontmatter?.requirements?.phases && Array.isArray(frontmatter.requirements.phases)) {
      for (const phaseData of frontmatter.requirements.phases) {
        // Load phase PRD file if it exists
        let phaseTasks: ParsedTask[] = [];
        if (phaseData.file) {
          const phaseFilePath = path.join(path.dirname(indexPath), phaseData.file);
          if (await fs.pathExists(phaseFilePath)) {
            try {
              const phaseDoc = await this.parse(phaseFilePath);
              phaseTasks = phaseDoc.phases[0]?.tasks || [];
            } catch (error) {
              if (this.debug) {
                logger.warn(`[PlanningDocParser] Failed to parse phase file ${phaseFilePath}: ${error}`);
              }
            }
          }
        }

        phases.push({
          id: phaseData.id || phases.length + 1,
          name: phaseData.name || `Phase ${phaseData.id || phases.length + 1}`,
          description: phaseData.description,
          dependsOn: phaseData.dependsOn,
          parallel: phaseData.parallel || false,
          status: phaseData.status || 'pending',
          tasks: phaseTasks,
          config: phaseData.config,
          checkpoint: phaseData.checkpoint || false,
        });
      }
    }

    // Extract config overlay
    const configOverlay = this.extractConfigOverlay(frontmatter, body);

    // Extract testing config
    const testing = this.extractTestingConfig(frontmatter, body);

    // Extract dependencies
    const dependencies = this.extractDependencies(frontmatter, body);

    return {
      prdId,
      version,
      status,
      title,
      description: this.extractDescription(body),
      phases,
      configOverlay,
      testing,
      dependencies,
      rawFrontmatter: frontmatter,
      rawContent: content,
    };
  }

  /**
   * Parse PRD set directory (enhance mode)
   * Parses index.md.yml and all phase PRD files
   */
  async parsePrdSet(prdSetDir: string): Promise<ParsedPlanningDoc> {
    const indexPath = path.join(prdSetDir, 'index.md.yml');
    
    if (!(await fs.pathExists(indexPath))) {
      throw new Error(`PRD set index file not found: ${indexPath}`);
    }

    // Parse index file
    const prdDoc = await this.parsePrdSetIndex(indexPath);

    // Load and merge phase PRD files if they exist
    for (const phase of prdDoc.phases) {
      const phaseFileName = `phase${phase.id}_${this.slugify(phase.name)}.md`;
      const phaseFilePath = path.join(prdSetDir, phaseFileName);
      
      if (await fs.pathExists(phaseFilePath)) {
        try {
          const phaseDoc = await this.parse(phaseFilePath);
          if (phaseDoc.phases && phaseDoc.phases.length > 0) {
            const phaseData = phaseDoc.phases[0];
            // Merge phase data
            phase.tasks = phaseData.tasks || phase.tasks;
            phase.description = phaseData.description || phase.description;
            if (phaseData.config) {
              phase.config = { ...phase.config, ...phaseData.config };
            }
          }
        } catch (error) {
          if (this.debug) {
            logger.warn(`[PlanningDocParser] Failed to parse phase file ${phaseFilePath}: ${error}`);
          }
        }
      }
    }

    return prdDoc;
  }

  /**
   * Slugify text (helper for file names)
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 30);
  }
}

