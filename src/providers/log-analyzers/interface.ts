import { LogSource, LogAnalysis } from '../../types';

export interface LogAnalyzer {
  name: string;
  analyze(sources: LogSource[]): Promise<LogAnalysis>;
}

