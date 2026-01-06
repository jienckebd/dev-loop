import * as fs from 'fs-extra';
import { AIProvider } from '../providers/ai/interface';
import { Requirement } from './prd-context';
import { PrdConfigParser } from './prd-config-parser';
import { Config } from '../config/schema';

export class PrdParser {
  private configParser: PrdConfigParser;

  constructor(
    private aiProvider: AIProvider,
    private debug: boolean = false
  ) {
    this.configParser = new PrdConfigParser(debug);
  }

  /**
   * Parse PRD markdown using structured format (machine-parseable)
   * Supports both YAML frontmatter and markdown format requirements
   */
  async parseStructured(prdPath: string): Promise<Requirement[]> {
    // First, try to parse YAML frontmatter requirements
    const metadata = await this.configParser.parsePrdMetadata(prdPath);
    if (this.debug) {
      console.log(`[PrdParser] Metadata parsed:`, metadata ? 'yes' : 'no');
      if (metadata?.requirements) {
        console.log(`[PrdParser] Requirements metadata found:`, {
          hasPhases: !!metadata.requirements.phases,
          phaseCount: metadata.requirements.phases?.length || 0,
        });
      }
    }
    if (metadata?.requirements?.phases) {
      const yamlRequirements = this.parseYamlFrontmatterRequirements(metadata.requirements);
      if (this.debug) {
        console.log(`[PrdParser] Parsed ${yamlRequirements.length} requirements from YAML frontmatter`);
      }
      if (yamlRequirements.length > 0) {
        return yamlRequirements;
      }
    }

    // Fall back to markdown format parsing
    const content = await fs.readFile(prdPath, 'utf-8');
    const requirements: Requirement[] = [];

    // Split content by requirement blocks (## REQ-XXX:)
    const requirementBlocks = content.split(/^##\s+REQ-/m);

    // Skip the first block (everything before first requirement)
    for (let i = 1; i < requirementBlocks.length; i++) {
      const block = `## REQ-${requirementBlocks[i]}`;
      const req = this.parseStructuredRequirement(block);
      if (req) {
        requirements.push(req);
      }
    }

    if (requirements.length === 0 && this.debug) {
      console.warn('[PrdParser] No structured requirements found, falling back to AI parsing');
    }

    return requirements.length > 0 ? requirements : this.parse(prdPath);
  }

  /**
   * Parse requirements from YAML frontmatter structure
   */
  private parseYamlFrontmatterRequirements(requirementsMeta: {
    idPattern?: string;
    phases?: Array<{
      id: number;
      name: string;
      parallel?: boolean;
      tasks?: Array<{
        id: string;
        title: string;
        description: string;
      }>;
    }>;
  }): Requirement[] {
    const requirements: Requirement[] = [];
    const idPattern = requirementsMeta.idPattern || 'REQ-{id}';

    if (!requirementsMeta.phases) {
      return [];
    }

    for (const phase of requirementsMeta.phases) {
      if (!phase.tasks) {
        continue;
      }

      for (const task of phase.tasks) {
        // If task.id already matches the pattern prefix, use it directly
        // Otherwise, apply the pattern
        let reqId: string;
        const patternPrefix = idPattern.split('{id}')[0];
        if (task.id.startsWith(patternPrefix)) {
          reqId = task.id;
        } else {
          reqId = idPattern.replace('{id}', task.id);
        }
        const description = task.description.trim();
        
        // Extract acceptance criteria from description (lines starting with -)
        const acceptanceCriteria: string[] = [];
        const lines = description.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('-') && trimmed.length > 2) {
            acceptanceCriteria.push(trimmed.substring(1).trim());
          }
        }

        // If no explicit criteria found, use description as main criterion
        if (acceptanceCriteria.length === 0) {
          // Use first line or first sentence as main criterion
          const firstLine = description.split('\n')[0].trim();
          acceptanceCriteria.push(firstLine || 'Requirement must be testable');
        }

        requirements.push({
          id: reqId,
          description: task.title + (description ? '\n\n' + description : ''),
          acceptanceCriteria,
          priority: 'must', // Default to 'must' for structured requirements
          status: 'pending',
          type: 'functional',
        });
      }
    }

    return requirements;
  }

  /**
   * Parse a single structured requirement block
   */
  private parseStructuredRequirement(block: string): Requirement | null {
    const idMatch = block.match(/##\s+REQ-(\S+):/);
    if (!idMatch) {
      return null;
    }

    const id = idMatch[1];
    const priorityMatch = block.match(/\*\*Priority\*\*:\s*(must|should|could)/i);
    const priority = (priorityMatch?.[1]?.toLowerCase() || 'should') as 'must' | 'should' | 'could';

    const typeMatch = block.match(/\*\*Type\*\*:\s*(\w+)/i);
    const type = typeMatch?.[1]?.toLowerCase() as 'functional' | 'test' | 'fix' | undefined;

    const descriptionMatch = block.match(/\*\*Description\*\*:\s*([^\n]+)/);
    const description = descriptionMatch?.[1]?.trim() || '';

    // Extract implementation files
    const implFilesMatch = block.match(/\*\*Implementation Files\*\*:\n((?:- `[^`]+`[^\n]*\n?)+)/);
    const implementationFiles = implFilesMatch
      ? [...implFilesMatch[1].matchAll(/- `([^`]+)`/g)].map(m => m[1])
      : [];

    // Extract test file
    const testFileMatch = block.match(/\*\*Test File\*\*:\s*`([^`]+)`/);
    const testFile = testFileMatch?.[1];

    // Extract acceptance criteria (checkboxes)
    const criteriaMatch = block.match(/\*\*Acceptance Criteria\*\*:\n((?:- \[[ x]\][^\n]+\n?)+)/);
    const acceptanceCriteria = criteriaMatch
      ? [...criteriaMatch[1].matchAll(/- \[[ x]\]\s*([^\n]+)/g)].map(m => m[1].trim())
      : [];

    // If no checkbox format, try bullet points
    if (acceptanceCriteria.length === 0) {
      const bulletMatch = block.match(/\*\*Acceptance Criteria\*\*:\n((?:- [^\n]+\n?)+)/);
      if (bulletMatch) {
        const matches = Array.from(bulletMatch[1].matchAll(/- ([^\n]+)/g));
        acceptanceCriteria.push(...matches.map((m: RegExpMatchArray) => m[1].trim()));
      }
    }

    return {
      id: `REQ-${id}`,
      description,
      acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : ['Requirement must be testable'],
      priority,
      status: 'pending',
      type,
      implementationFiles: implementationFiles.length > 0 ? implementationFiles : undefined,
      testFile,
    };
  }

  /**
   * Parse PRD markdown to extract structured requirements
   */
  async parse(prdPath: string): Promise<Requirement[]> {
    const content = await fs.readFile(prdPath, 'utf-8');

    // Use AI to extract structured requirements
    const prompt = `Extract all requirements from this PRD as structured data.

For each requirement, identify:
- A unique ID (short, descriptive, like "req-1", "req-2")
- Description (what needs to be implemented)
- Acceptance criteria (testable conditions, one per line)
- Priority (must/should/could - based on PRD language)

Return the requirements as a JSON array with this exact structure:
[
  {
    "id": "req-1",
    "description": "Requirement description",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "priority": "must"
  }
]

PRD Content:
${content}

Extract ALL requirements from the PRD. Include functional requirements, non-functional requirements, and any acceptance criteria mentioned.`;

    try {
      const response = await this.aiProvider.generateCode(prompt, {
        task: {
          id: 'prd-parse',
          title: 'Parse PRD Requirements',
          description: 'Extract requirements from PRD',
          status: 'pending',
          priority: 'high',
        },
        codebaseContext: '',
      });

      // Parse the response - it should be JSON
      const jsonMatch = response.files?.[0]?.content?.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const requirements = JSON.parse(jsonMatch[0]) as Requirement[];

        // Validate and set default status
        return requirements.map(req => ({
          ...req,
          status: 'pending' as const,
          acceptanceCriteria: Array.isArray(req.acceptanceCriteria)
            ? req.acceptanceCriteria
            : [req.acceptanceCriteria || 'Requirement must be testable'],
        }));
      }

      // Fallback: try to extract from summary or full response
      if (response.summary) {
        return this.parseRequirementsFromText(response.summary);
      }

      throw new Error('Could not parse requirements from AI response');
    } catch (error) {
      if (this.debug) {
        console.error('[PrdParser] AI parsing failed, using fallback:', error);
      }
      // Fallback: extract requirements using simple pattern matching
      return this.parseRequirementsFromText(content);
    }
  }

  /**
   * Fallback parser using pattern matching
   */
  private parseRequirementsFromText(text: string): Requirement[] {
    const requirements: Requirement[] = [];
    const lines = text.split('\n');

    let currentReq: Partial<Requirement> | null = null;
    let inRequirement = false;
    let reqCounter = 1;

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect requirement headers
      if (trimmed.match(/^#+\s+(?:Requirement|Req|Feature|User Story)/i)) {
        if (currentReq) {
          requirements.push({
            id: currentReq.id || `req-${reqCounter++}`,
            description: currentReq.description || 'Requirement',
            acceptanceCriteria: currentReq.acceptanceCriteria || [],
            priority: currentReq.priority || 'should',
            status: 'pending',
          });
        }
        currentReq = {
          id: `req-${reqCounter++}`,
          description: trimmed.replace(/^#+\s+/, ''),
          acceptanceCriteria: [],
          priority: 'should',
        };
        inRequirement = true;
        continue;
      }

      // Detect acceptance criteria
      if (inRequirement && currentReq) {
        if (trimmed.match(/^[-*]\s*(?:Acceptance|Criteria|Given|When|Then|Must|Should)/i)) {
          const criterion = trimmed.replace(/^[-*]\s*/, '').trim();
          if (criterion) {
            currentReq.acceptanceCriteria = currentReq.acceptanceCriteria || [];
            currentReq.acceptanceCriteria.push(criterion);
          }
        } else if (trimmed.match(/^[-*]/)) {
          // Generic list item - could be acceptance criteria
          const criterion = trimmed.replace(/^[-*]\s*/, '').trim();
          if (criterion && criterion.length > 10) {
            currentReq.acceptanceCriteria = currentReq.acceptanceCriteria || [];
            currentReq.acceptanceCriteria.push(criterion);
          }
        }

        // Detect priority
        if (trimmed.match(/priority:\s*(must|should|could)/i)) {
          const match = trimmed.match(/priority:\s*(must|should|could)/i);
          if (match) {
            currentReq.priority = match[1].toLowerCase() as 'must' | 'should' | 'could';
          }
        }
      }

      // Detect end of requirement section
      if (trimmed.match(/^#+\s+[^#]/) && inRequirement && currentReq) {
        inRequirement = false;
      }
    }

    // Add last requirement
    if (currentReq) {
      requirements.push({
        id: currentReq.id || `req-${reqCounter++}`,
        description: currentReq.description || 'Requirement',
        acceptanceCriteria: currentReq.acceptanceCriteria || [],
        priority: currentReq.priority || 'should',
        status: 'pending',
      });
    }

    // If no requirements found, create one from the whole document
    if (requirements.length === 0) {
      requirements.push({
        id: 'req-1',
        description: 'Implement PRD requirements',
        acceptanceCriteria: ['All PRD requirements must be implemented and tested'],
        priority: 'must',
        status: 'pending',
      });
    }

    return requirements;
  }

  /**
   * Parse PRD and extract both requirements and configuration overlay
   * 
   * This method parses the PRD for requirements and also extracts any
   * embedded Dev-Loop Configuration section that provides config overlays.
   */
  async parseWithConfig(prdPath: string, useStructuredParsing: boolean = true): Promise<{
    requirements: Requirement[];
    configOverlay?: Partial<Config>;
  }> {
    // Parse requirements
    const requirements = useStructuredParsing
      ? await this.parseStructured(prdPath)
      : await this.parse(prdPath);

    // Parse config overlay
    const configOverlay = await this.configParser.parsePrdConfig(prdPath);

    return {
      requirements,
      configOverlay: configOverlay || undefined,
    };
  }
}
