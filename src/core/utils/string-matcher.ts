/**
 * String Matching Utilities
 *
 * Extracted from workflow.ts for reuse across LangGraph nodes.
 * Provides fuzzy matching, similarity calculation, and aggressive matching
 * for code patching operations.
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Calculate similarity between two strings (Levenshtein-based)
 * Returns a value between 0 and 1, where 1 is identical
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Find fuzzy match for search string with whitespace tolerance
 */
export function findFuzzyMatch(content: string, search: string): string | null {
  // Normalize whitespace in search string
  const normalizedSearch = search.replace(/\s+/g, ' ').trim();
  const searchLines = normalizedSearch.split('\n');

  if (searchLines.length === 0) return null;

  // Try to find first line of search string
  const firstLine = searchLines[0].trim();
  if (firstLine.length < 10) return null; // Too short for reliable matching

  // Find all occurrences of first line (with whitespace tolerance)
  const contentLines = content.split('\n');
  const candidates: Array<{ startIdx: number; match: string }> = [];

  for (let i = 0; i < contentLines.length; i++) {
    const normalizedLine = contentLines[i].replace(/\s+/g, ' ').trim();
    if (normalizedLine.includes(firstLine) || firstLine.includes(normalizedLine)) {
      // Found potential match, try to match full search string
      const matchedLines: string[] = [];
      let searchIdx = 0;
      let contentIdx = i;

      // Try to match consecutive lines
      while (searchIdx < searchLines.length && contentIdx < contentLines.length) {
        const normalizedSearchLine = searchLines[searchIdx].replace(/\s+/g, ' ').trim();
        const normalizedContentLine = contentLines[contentIdx].replace(/\s+/g, ' ').trim();

        if (normalizedContentLine.includes(normalizedSearchLine) ||
            normalizedSearchLine.includes(normalizedContentLine) ||
            (normalizedSearchLine.length > 20 && normalizedContentLine.length > 20 &&
             calculateSimilarity(normalizedSearchLine, normalizedContentLine) > 0.8)) {
          matchedLines.push(contentLines[contentIdx]);
          searchIdx++;
          contentIdx++;
        } else {
          // Allow skipping blank lines in content
          if (normalizedContentLine.trim() === '') {
            contentIdx++;
            continue;
          }
          break;
        }
      }

      // If we matched most of the search string, consider it a match
      if (matchedLines.length >= Math.max(1, searchLines.length * 0.7)) {
        candidates.push({
          startIdx: i,
          match: matchedLines.join('\n')
        });
      }
    }
  }

  // Return the first candidate that's close enough
  if (candidates.length > 0) {
    return candidates[0].match;
  }

  return null;
}

export interface AggressiveMatchResult {
  newContent: string;
  lineNumber: number;
}

/**
 * Aggressive content matching - try to find the right place to apply a patch
 * even when exact and fuzzy matching fail
 */
export function findAggressiveMatch(
  content: string,
  search: string,
  replace: string
): AggressiveMatchResult | null {
  const searchLines = search.split('\n');
  const contentLines = content.split('\n');

  if (searchLines.length === 0) return null;

  // Strategy 1: Find a unique identifier in the search string (method name, variable, etc.)
  const identifierMatch = search.match(/(?:function|class|const|public|private|protected)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (identifierMatch) {
    const identifier = identifierMatch[1];

    // Find lines containing this identifier
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].includes(identifier)) {
        // Check if this looks like the right context
        // Get context around the identifier
        const contextStart = Math.max(0, i - 5);
        const contextEnd = Math.min(contentLines.length, i + searchLines.length + 5);
        const contextBlock = contentLines.slice(contextStart, contextEnd).join('\n');

        // Check similarity of context to search string
        const similarity = calculateSimilarity(
          contextBlock.replace(/\s+/g, ' ').trim().substring(0, 500),
          search.replace(/\s+/g, ' ').trim().substring(0, 500)
        );

        if (similarity > 0.5) {
          // Found a good match - try to determine the exact replacement range
          const replaceStart = i;
          const replaceEnd = Math.min(contentLines.length, i + searchLines.length);

          // Create new content with the replacement
          const newLines = [
            ...contentLines.slice(0, replaceStart),
            replace,
            ...contentLines.slice(replaceEnd)
          ];

          return {
            newContent: newLines.join('\n'),
            lineNumber: i + 1
          };
        }
      }
    }
  }

  // Strategy 2: Look for first and last line anchors
  const firstSearchLine = searchLines[0].trim();
  const lastSearchLine = searchLines[searchLines.length - 1].trim();

  if (firstSearchLine.length > 15 && lastSearchLine.length > 15) {
    for (let i = 0; i < contentLines.length - searchLines.length; i++) {
      const contentFirstLine = contentLines[i].trim();
      const contentLastLine = contentLines[i + searchLines.length - 1]?.trim() || '';

      const firstSimilarity = calculateSimilarity(firstSearchLine, contentFirstLine);
      const lastSimilarity = calculateSimilarity(lastSearchLine, contentLastLine);

      if (firstSimilarity > 0.8 && lastSimilarity > 0.8) {
        // Found matching anchors
        const newLines = [
          ...contentLines.slice(0, i),
          replace,
          ...contentLines.slice(i + searchLines.length)
        ];

        return {
          newContent: newLines.join('\n'),
          lineNumber: i + 1
        };
      }
    }
  }

  return null;
}

/**
 * Normalize whitespace in a string for comparison
 */
export function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Check if two strings are similar enough to be considered a match
 */
export function isSimilarEnough(str1: string, str2: string, threshold: number = 0.8): boolean {
  return calculateSimilarity(str1, str2) >= threshold;
}

/**
 * Extract identifiers from code (method names, class names, etc.)
 */
export function extractIdentifiers(code: string): string[] {
  const identifiers: string[] = [];

  // Match various identifier patterns
  const patterns = [
    /(?:function|class|interface|type|const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    /(?:public|protected|private|static)\s+(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const id = match[1];
      if (!identifiers.includes(id)) {
        identifiers.push(id);
      }
    }
  }

  return identifiers;
}

/**
 * Find the best matching line in content for a search string
 * Returns the line number (1-indexed) or -1 if not found
 */
export function findBestMatchingLine(content: string, searchLine: string, threshold: number = 0.7): number {
  const contentLines = content.split('\n');
  const normalizedSearch = normalizeWhitespace(searchLine);

  let bestMatch = -1;
  let bestSimilarity = threshold;

  for (let i = 0; i < contentLines.length; i++) {
    const normalizedContent = normalizeWhitespace(contentLines[i]);
    const similarity = calculateSimilarity(normalizedSearch, normalizedContent);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = i + 1; // 1-indexed
    }
  }

  return bestMatch;
}
