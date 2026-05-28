// Codebase Explorer Power - Base Analyzer Interface

import type { FileTreeNode, FocusArea, ResolvedConfig } from '../types.js';

/**
 * Progress reporter callback for long-running analysis operations.
 */
export type ProgressReporter = (message: string, progress: number, total: number) => Promise<void>;

/**
 * Context provided to each analyzer during execution.
 * Contains the file tree, configuration, and utilities needed for analysis.
 */
export interface AnalysisContext {
  rootPath: string;
  fileTree: FileTreeNode[];
  focusAreas: FocusArea[];
  config: ResolvedConfig;
  cache: StateCache;
  reportProgress: ProgressReporter;
}

/**
 * Interface for the state cache used during incremental analysis.
 */
export interface StateCache {
  getFileHash(path: string): string | undefined;
  setFileHash(path: string, hash: string): void;
  getArtifactsForFile(path: string): string[];
  setArtifactsForFile(path: string, artifacts: string[]): void;
}

/**
 * Base interface for all analyzers.
 * Each analyzer examines a specific aspect of the codebase and returns
 * a typed result.
 *
 * @template TResult - The type of the analysis result produced by this analyzer.
 */
export interface Analyzer<TResult> {
  /** Human-readable name of this analyzer. */
  name: string;

  /** Perform the analysis and return the result. */
  analyze(context: AnalysisContext): Promise<TResult>;
}
