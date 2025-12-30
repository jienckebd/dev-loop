import { FastMCP } from 'fastmcp';
import { Config } from '../../config/schema';

export type ConfigLoader = (configPath?: string) => Promise<Config>;

export interface ToolContext {
  mcp: FastMCP;
  getConfig: ConfigLoader;
}
