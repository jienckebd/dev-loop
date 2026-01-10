import { Config } from '../../config/schema/core';

// Use 'any' type for FastMCP since it's dynamically imported
export type FastMCPType = any;

export type ConfigLoader = (configPath?: string) => Promise<Config>;

export interface ToolContext {
  mcp: FastMCPType;
  getConfig: ConfigLoader;
}

// Re-export tool registration functions
export { registerCoreTools } from './core';
export { registerDebugTools } from './debug';
export { registerControlTools } from './control';
export { registerContributionTools } from './contribution';
export { registerCursorAITools } from './cursor-ai';
export { registerCursorChatTools } from './cursor-chat';
export { registerContributionModeTools } from './contribution-mode';
export { registerEventMonitoringTools } from './event-monitoring';
export { registerObservationEnhancedTools } from './observation-enhanced';