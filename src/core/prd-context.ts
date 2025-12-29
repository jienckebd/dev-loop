import * as fs from 'fs-extra';
import * as path from 'path';
import { TestResult } from '../types';

export interface Requirement {
  id: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'must' | 'should' | 'could';
  status: 'pending' | 'tested' | 'passing' | 'failing';
}

export interface TestState {
  id: string;
  requirementId: string;
  testPath: string;
  testCode: string;
  status: 'stub' | 'implemented' | 'passing' | 'failing' | 'skipped';
  lastResult?: TestResult;
  attempts: number;
}

export interface IterationRecord {
  iteration: number;
  timestamp: string;
  tasksExecuted: string[];
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  errors: string[];
  changesApplied: FileChange[];
  duration: number;
}

export interface FileChange {
  path: string;
  operation: 'create' | 'update' | 'delete' | 'patch';
  summary: string;
}

export interface Pattern {
  id: string;
  description: string;
  code: string;
  context: string;
  discoveredAt: string;
}

export interface Approach {
  id: string;
  description: string;
  reason: string;
  attemptedAt: string;
}

export interface Issue {
  id: string;
  description: string;
  testId: string;
  discoveredAt: string;
}

export interface FileKnowledge {
  path: string;
  purpose: string;
  relevantFunctions?: string[];
  discoveredAt: string;
}

export interface PrdContext {
  // PRD metadata
  prdId: string;
  prdPath: string;
  startedAt: string;

  // Requirements extracted from PRD
  requirements: Requirement[];

  // Test state
  tests: TestState[];

  // Iteration history
  iterations: IterationRecord[];

  // Accumulated knowledge
  knowledge: {
    workingPatterns: Pattern[];      // What worked
    failedApproaches: Approach[];    // What didn't work
    discoveredIssues: Issue[];       // Root causes found
    codeLocations: FileKnowledge[];  // File/function mappings
  };

  // Current state
  currentIteration: number;
  status: 'initializing' | 'generating-tests' | 'running' | 'complete' | 'blocked';
}

export class PrdContextManager {
  private contextPath: string;
  private debug: boolean;

  constructor(contextPath: string = '.devloop/prd-context', debug: boolean = false) {
    this.contextPath = path.resolve(process.cwd(), contextPath);
    this.debug = debug;
  }

  /**
   * Generate a PRD ID from the file path
   */
  private getPrdId(prdPath: string): string {
    const basename = path.basename(prdPath, path.extname(prdPath));
    // Sanitize for filesystem
    return basename.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Get the context file path for a PRD
   */
  private getContextFilePath(prdId: string): string {
    return path.join(this.contextPath, `${prdId}.json`);
  }

  /**
   * Load existing context or create new one
   */
  async loadOrCreate(prdPath: string): Promise<PrdContext> {
    await fs.ensureDir(this.contextPath);

    const prdId = this.getPrdId(prdPath);
    const contextFile = this.getContextFilePath(prdId);

    if (await fs.pathExists(contextFile)) {
      try {
        const data = await fs.readJson(contextFile);
        if (this.debug) {
          console.log(`[PrdContextManager] Loaded existing context for ${prdId}`);
        }
        return data as PrdContext;
      } catch (error) {
        console.warn(`[PrdContextManager] Failed to load context, creating new: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create new context
    const context: PrdContext = {
      prdId,
      prdPath: path.resolve(process.cwd(), prdPath),
      startedAt: new Date().toISOString(),
      requirements: [],
      tests: [],
      iterations: [],
      knowledge: {
        workingPatterns: [],
        failedApproaches: [],
        discoveredIssues: [],
        codeLocations: [],
      },
      currentIteration: 0,
      status: 'initializing',
    };

    await this.save(context);
    return context;
  }

  /**
   * Save context to disk
   */
  async save(context: PrdContext): Promise<void> {
    await fs.ensureDir(this.contextPath);
    const contextFile = this.getContextFilePath(context.prdId);
    await fs.writeJson(contextFile, context, { spaces: 2 });
    if (this.debug) {
      console.log(`[PrdContextManager] Saved context for ${context.prdId}`);
    }
  }

  /**
   * Get context by PRD ID
   */
  async get(prdId: string): Promise<PrdContext | null> {
    const contextFile = this.getContextFilePath(prdId);
    if (await fs.pathExists(contextFile)) {
      try {
        return await fs.readJson(contextFile) as PrdContext;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * List all PRD contexts
   */
  async list(): Promise<string[]> {
    await fs.ensureDir(this.contextPath);
    const files = await fs.readdir(this.contextPath);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json'));
  }
}
