/**
 * Constitution Parser
 *
 * Parses .cursorrules or constitution files into structured rules.
 * Merges with framework-specific rules from FrameworkPlugin.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { FrameworkPlugin } from '../../../frameworks';
import { ConstitutionRules, PatternRule } from '../parser/planning-doc-parser';
import { logger } from '../../utils/logger';

/**
 * Constitution Parser Configuration
 */
export interface ConstitutionParserConfig {
  projectRoot: string;
  debug?: boolean;
}

/**
 * Parses .cursorrules or constitution files into structured rules
 * Merges with framework-specific rules from FrameworkLoader
 */
export class ConstitutionParser {
  private projectRoot: string;
  private debug: boolean;

  constructor(config: ConstitutionParserConfig) {
    this.projectRoot = config.projectRoot;
    this.debug = config.debug || false;
  }

  /**
   * Parse constitution file (usually .cursorrules)
   */
  async parse(constitutionPath?: string): Promise<ConstitutionRules> {
    const filePath = constitutionPath
      ? path.resolve(this.projectRoot, constitutionPath)
      : path.join(this.projectRoot, '.cursorrules');

    if (!await fs.pathExists(filePath)) {
      if (this.debug) {
        logger.debug(`[ConstitutionParser] No constitution file at ${filePath}`);
      }
      return { constraints: [], patterns: [], avoid: [], codeLocations: [] };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const rules = this.parseContent(content);
      if (this.debug) {
        logger.debug(`[ConstitutionParser] Parsed ${rules.constraints.length} constraints, ${rules.patterns.length} patterns`);
      }
      return rules;
    } catch (error) {
      logger.error(`[ConstitutionParser] Error parsing constitution file: ${error}`);
      return { constraints: [], patterns: [], avoid: [], codeLocations: [] };
    }
  }

  /**
   * Parse content into structured rules
   */
  private parseContent(content: string): ConstitutionRules {
    const rules: ConstitutionRules = {
      constraints: [],
      patterns: [],
      avoid: [],
      codeLocations: [],
    };

    // Extract "NEVER" constraints (case insensitive, multi-word)
    const neverMatches = content.match(/\bNEVER\b[^\n.]+/gi) || [];
    rules.constraints.push(...neverMatches.map(m => m.trim()));

    // Extract "MUST" constraints
    const mustMatches = content.match(/\bMUST\b[^\n.]+/gi) || [];
    rules.constraints.push(...mustMatches.map(m => m.trim()));

    // Extract "ALWAYS" constraints
    const alwaysMatches = content.match(/\bALWAYS\b[^\n.]+/gi) || [];
    rules.constraints.push(...alwaysMatches.map(m => m.trim()));

    // Extract "REQUIRED" constraints
    const requiredMatches = content.match(/\bREQUIRED\b[^\n.]+/gi) || [];
    rules.constraints.push(...requiredMatches.map(m => m.trim()));

    // Deduplicate constraints
    rules.constraints = [...new Set(rules.constraints)];

    // Extract pattern rules (look for "use X for Y" or "use X when Y" patterns)
    const usePatterns = content.match(/\buse\s+[\w_]+\s+(?:for|when)\s+[^\n.]+/gi) || [];
    for (const match of usePatterns) {
      const parts = match.match(/\buse\s+([\w_]+)\s+(?:for|when)\s+(.+)/i);
      if (parts) {
        rules.patterns.push({
          pattern: parts[1],
          when: parts[2].trim(),
        });
      }
    }

    // Extract "extend X" patterns
    const extendPatterns = content.match(/\bextend\s+[\w\\]+\s+(?:for|when)[^\n.]+/gi) || [];
    for (const match of extendPatterns) {
      const parts = match.match(/\bextend\s+([\w\\]+)\s+(?:for|when)\s+(.+)/i);
      if (parts) {
        rules.patterns.push({
          pattern: `extend ${parts[1]}`,
          when: parts[2].trim(),
        });
      }
    }

    // Extract avoid rules
    const avoidMatches = content.match(/\b(?:avoid|don't|do not)\s+[^\n.]+/gi) || [];
    rules.avoid.push(...avoidMatches.map(m => m.trim()));

    // Deduplicate avoid rules
    rules.avoid = [...new Set(rules.avoid)];

    // Extract code locations (paths mentioned with backticks)
    const pathMatches = content.match(/`[^`]+\/[^`]+`/g) || [];
    rules.codeLocations.push(...pathMatches.map(m => m.replace(/`/g, '')));

    // Also extract paths mentioned with pattern like "path/to/something"
    const inlinePathMatches = content.match(/\bdocroot\/[\w/-]+/g) || [];
    rules.codeLocations.push(...inlinePathMatches);

    // Deduplicate code locations
    rules.codeLocations = [...new Set(rules.codeLocations)];

    return rules;
  }

  /**
   * Merge constitution with framework-specific rules
   */
  mergeWithFramework(
    constitution: ConstitutionRules,
    framework?: FrameworkPlugin
  ): ConstitutionRules {
    if (!framework) return constitution;

    // Get framework constraints if available
    const frameworkConstraints = framework.getConstraints?.() || [];
    const frameworkPatterns = framework.getPatterns?.() || [];
    const codeLocationRules = framework.getCodeLocationRules?.() || {};

    // Convert code location rules to array
    const frameworkLocations = Object.values(codeLocationRules);

    return {
      constraints: [...new Set([...constitution.constraints, ...frameworkConstraints])],
      patterns: [...constitution.patterns, ...frameworkPatterns],
      avoid: constitution.avoid,
      codeLocations: [...new Set([...constitution.codeLocations, ...frameworkLocations])],
    };
  }

  /**
   * Convert constitution rules to prompt-injectable format
   */
  toPromptFormat(rules: ConstitutionRules): string {
    const sections: string[] = [];

    if (rules.constraints.length > 0) {
      sections.push('## Constraints (MUST FOLLOW)\n' + rules.constraints.map(c => `- ${c}`).join('\n'));
    }

    if (rules.patterns.length > 0) {
      sections.push('## Required Patterns\n' + rules.patterns.map(p => `- Use **${p.pattern}** when ${p.when}`).join('\n'));
    }

    if (rules.avoid.length > 0) {
      sections.push('## Avoid\n' + rules.avoid.map(a => `- ${a}`).join('\n'));
    }

    if (rules.codeLocations.length > 0) {
      sections.push('## Code Locations\n' + rules.codeLocations.map(l => `- \`${l}\``).join('\n'));
    }

    return sections.join('\n\n');
  }
}
