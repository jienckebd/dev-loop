import * as fs from 'fs-extra';
import { AIProvider } from '../providers/ai/interface';
import { Requirement } from './prd-context';

export class PrdParser {
  constructor(
    private aiProvider: AIProvider,
    private debug: boolean = false
  ) {}

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
}
