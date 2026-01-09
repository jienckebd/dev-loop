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

    // If no phases found, create a single default phase
    if (phases.length === 0) {
      phases.push({
        id: 1,
        name: 'Implementation',
        parallel: false,
        status: 'pending',
      });
    }

    return phases;
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
}

