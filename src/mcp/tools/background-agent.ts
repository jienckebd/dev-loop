/**
 * Background Agent Status MCP Tool
 *
 * Provides status and statistics for Cursor background agent operations,
 * including session state, JSON parsing success rates, and error tracking.
 */

import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigLoader, FastMCPType } from './index';
import { GenericSessionManager } from '../../providers/ai/generic-session-manager';

export function registerBackgroundAgentTools(mcp: FastMCPType, getConfig: ConfigLoader): void {
  // devloop_background_agent_status - Get background agent session state and statistics
  mcp.addTool({
    name: 'devloop_background_agent_status',
    description: 'Query background agent session state, JSON parsing success rates, and recent errors',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      sessionId: z.string().optional().describe('Get specific session status'),
      includeHistory: z.boolean().optional().describe('Include conversation history in response'),
      errorCount: z.number().optional().describe('Number of recent errors to return (default: 10)'),
    }),
    execute: async (args: { config?: string; sessionId?: string; includeHistory?: boolean; errorCount?: number }, context: any) => {
      try {
        const config = await getConfig(args.config);
        const cursorConfig = (config as any).cursor || {};
        const agentsConfig = cursorConfig.agents || {};
        const sessionConfig = agentsConfig.sessionManagement || {};

        const sessionsPath = sessionConfig.sessionsPath || '.devloop/execution-state.json'; // Sessions now in execution-state.json
        const resolvedPath = path.resolve(process.cwd(), sessionsPath);

        // Initialize session manager
        const sessionManager = new GenericSessionManager({
          providerName: 'cursor',
          enabled: sessionConfig.enabled !== false,
          maxSessionAge: sessionConfig.maxSessionAge,
          maxHistoryItems: sessionConfig.maxHistoryItems,
          sessionsPath: resolvedPath,
        });

        const response: any = {
          sessionsPath: resolvedPath,
          sessionManagementEnabled: sessionConfig.enabled !== false,
        };

        if (args.sessionId) {
          // Get specific session
          const session = sessionManager.getSession(args.sessionId);
          if (!session) {
            return JSON.stringify({
              error: `Session ${args.sessionId} not found`,
            });
          }

          response.session = {
            sessionId: session.sessionId,
            chatId: session.providerSessionId,  // Use providerSessionId instead of chatId
            createdAt: session.createdAt,
            lastUsed: session.lastUsed,
            context: session.context,
            stats: session.stats,
            historyCount: session.history.length,
            history: args.includeHistory ? session.history : undefined,
          };
        } else {
          // Get all sessions
          const allSessions = sessionManager.getAllSessions();
          const allStats = sessionManager.getAllStats();

          // Aggregate statistics
          let totalCalls = 0;
          let totalSuccessful = 0;
          let totalFailed = 0;
          let totalJsonParsingErrors = 0;

          for (const stats of Object.values(allStats)) {
            totalCalls += stats.totalCalls;
            totalSuccessful += stats.successfulCalls;
            totalFailed += stats.failedCalls;
            totalJsonParsingErrors += stats.jsonParsingErrors;
          }

          response.summary = {
            totalSessions: allSessions.length,
            totalCalls,
            totalSuccessful,
            totalFailed,
            totalJsonParsingErrors,
            successRate: totalCalls > 0 ? (totalSuccessful / totalCalls) : 0,
            jsonParsingErrorRate: totalCalls > 0 ? (totalJsonParsingErrors / totalCalls) : 0,
          };

          response.sessions = allSessions.map(session => ({
            sessionId: session.sessionId,
            chatId: session.providerSessionId,  // Use providerSessionId instead of chatId
            createdAt: session.createdAt,
            lastUsed: session.lastUsed,
            context: session.context,
            stats: session.stats,
            historyCount: session.history.length,
            history: args.includeHistory ? session.history : undefined,
          }));

          // Collect recent errors
          const errorCount = args.errorCount || 10;
          const recentErrors: any[] = [];

          for (const session of allSessions) {
            for (const entry of session.history) {
              if (entry.error) {
                recentErrors.push({
                  sessionId: session.sessionId,
                  requestId: entry.requestId,
                  timestamp: entry.timestamp,
                  error: entry.error,
                  prompt: entry.prompt.substring(0, 200),
                });
              }
            }
          }

          // Sort by timestamp (most recent first) and limit
          recentErrors.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          response.recentErrors = recentErrors.slice(0, errorCount);
        }

        return JSON.stringify(response, null, 2);
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          message: 'Failed to get background agent status',
        });
      }
    },
  });
}


