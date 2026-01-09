import { PrdSet } from '../prd/coordination/coordinator';
import { PrdMetadata } from '../prd/parser/config-parser';
import { logger } from './logger';

export interface ExecutionLevel {
  level: number;
  prds: string[]; // PRD IDs that can execute in parallel
}

export interface DependencyGraph {
  nodes: Map<string, string[]>; // PRD ID -> array of dependent PRD IDs
  inDegree: Map<string, number>; // PRD ID -> number of dependencies
}

/**
 * Dependency Graph Builder
 *
 * Builds and resolves dependency graphs for PRD sets, enabling parallel execution.
 */
export class DependencyGraphBuilder {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Build dependency graph from PRD set
   */
  buildGraph(prdSet: PrdSet): DependencyGraph {
    const nodes = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize all PRDs
    for (const prd of prdSet.prds) {
      nodes.set(prd.id, []);
      inDegree.set(prd.id, 0);
    }

    // Build graph from dependencies
    for (const prd of prdSet.prds) {
      const dependencies = this.extractDependencies(prd.metadata);

      for (const depId of dependencies) {
        if (nodes.has(depId)) {
          // Add edge: depId -> prd.id (depId must complete before prd.id)
          const current = nodes.get(depId) || [];
          current.push(prd.id);
          nodes.set(depId, current);

          // Increment in-degree of prd.id
          inDegree.set(prd.id, (inDegree.get(prd.id) || 0) + 1);
        }
      }
    }

    return { nodes, inDegree };
  }

  /**
   * Resolve execution levels using topological sort
   */
  resolveExecutionLevels(graph: DependencyGraph): ExecutionLevel[] {
    const levels: ExecutionLevel[] = [];
    const remaining = new Map(graph.inDegree);
    const nodes = new Map(graph.nodes);

    let currentLevel = 0;

    while (remaining.size > 0) {
      // Find all PRDs with no remaining dependencies (in-degree = 0)
      const readyPrds: string[] = [];

      for (const [prdId, degree] of remaining.entries()) {
        if (degree === 0) {
          readyPrds.push(prdId);
        }
      }

      if (readyPrds.length === 0) {
        // Cycle detected - remaining PRDs have dependencies
        const remainingIds = Array.from(remaining.keys());
        throw new Error(`Dependency cycle detected. Remaining PRDs: ${remainingIds.join(', ')}`);
      }

      // Add level
      levels.push({
        level: currentLevel,
        prds: readyPrds,
      });

      // Remove ready PRDs and update in-degrees
      for (const prdId of readyPrds) {
        remaining.delete(prdId);

        // Decrement in-degree of dependent PRDs
        const dependents = nodes.get(prdId) || [];
        for (const dependentId of dependents) {
          const currentDegree = remaining.get(dependentId);
          if (currentDegree !== undefined && currentDegree > 0) {
            remaining.set(dependentId, currentDegree - 1);
          }
        }
      }

      currentLevel++;
    }

    return levels;
  }

  /**
   * Detect cycles in dependency graph
   */
  detectCycles(graph: DependencyGraph): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
      if (recStack.has(node)) {
        return true; // Cycle detected
      }
      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      recStack.add(node);

      const neighbors = graph.nodes.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) {
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const node of graph.nodes.keys()) {
      if (!visited.has(node)) {
        if (hasCycle(node)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract PRD dependencies from metadata
   */
  private extractDependencies(metadata: PrdMetadata): string[] {
    const dependencies: string[] = [];
    const dependsOn = metadata.relationships?.dependsOn || [];

    for (const dep of dependsOn) {
      if (typeof dep === 'string') {
        dependencies.push(dep);
      } else if (dep.prd) {
        dependencies.push(dep.prd);
      }
    }

    return dependencies;
  }
}






