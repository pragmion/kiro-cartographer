// Codebase Explorer Power - State Cache for Incremental Analysis

import { join } from 'node:path';
import type { StateCache } from '../analyzers/base-analyzer.js';
import type { AnalysisState, IncrementalDiff } from '../types.js';
import { computeFileHash } from '../utils/hash.js';
import { safeReadFile, safeWriteFile } from '../utils/file-system.js';

const STATE_DIR = '.cartographer';
const STATE_FILE = 'analysis-state.json';
const STATE_VERSION = '1.0.0';

/**
 * Manages analysis state persistence and incremental diff detection.
 * Implements the StateCache interface for use during analysis.
 */
export class AnalysisStateCache implements StateCache {
  private state: AnalysisState;

  constructor() {
    this.state = createEmptyState('');
  }

  // ─── StateCache Interface ───────────────────────────────────────────────────

  getFileHash(path: string): string | undefined {
    return this.state.fileHashes[path];
  }

  setFileHash(path: string, hash: string): void {
    this.state.fileHashes[path] = hash;
  }

  getArtifactsForFile(path: string): string[] {
    return this.state.fileToArtifactMap[path] ?? [];
  }

  setArtifactsForFile(path: string, artifacts: string[]): void {
    this.state.fileToArtifactMap[path] = artifacts;
  }

  // ─── State Persistence ──────────────────────────────────────────────────────

  /**
   * Loads analysis state from `.cartographer/analysis-state.json`.
   * If the file does not exist or is invalid, initializes empty state.
   */
  async load(rootPath: string): Promise<void> {
    const statePath = join(rootPath, STATE_DIR, STATE_FILE);
    const result = await safeReadFile(statePath);

    if (result.isError) {
      this.state = createEmptyState(rootPath);
      return;
    }

    try {
      const parsed = JSON.parse(result.value) as AnalysisState;
      if (parsed.version && parsed.fileHashes && parsed.fileToArtifactMap) {
        this.state = parsed;
      } else {
        this.state = createEmptyState(rootPath);
      }
    } catch {
      this.state = createEmptyState(rootPath);
    }
  }

  /**
   * Saves current analysis state to `.cartographer/analysis-state.json`.
   */
  async save(rootPath: string): Promise<void> {
    this.state.rootPath = rootPath;
    const statePath = join(rootPath, STATE_DIR, STATE_FILE);
    const content = JSON.stringify(this.state, null, 2);
    await safeWriteFile(statePath, content);
  }

  // ─── Incremental Diff ───────────────────────────────────────────────────────

  /**
   * Compares current file hashes against stored state to produce an incremental diff.
   * Identifies added, modified, deleted, and unchanged files.
   */
  async computeDiff(rootPath: string, filePaths: string[]): Promise<IncrementalDiff> {
    const diff: IncrementalDiff = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const currentFiles = new Set(filePaths);
    const storedPaths = new Set(Object.keys(this.state.fileHashes));

    // Check current files against stored hashes
    for (const filePath of filePaths) {
      const fullPath = join(rootPath, filePath);
      const hashResult = await computeFileHash(fullPath);

      if (hashResult.isError) {
        // Cannot hash file — treat as added if not in state, skip otherwise
        if (!storedPaths.has(filePath)) {
          diff.added.push(filePath);
        }
        continue;
      }

      const currentHash = hashResult.value;
      const storedHash = this.state.fileHashes[filePath];

      if (storedHash === undefined) {
        diff.added.push(filePath);
      } else if (storedHash !== currentHash) {
        diff.modified.push(filePath);
      } else {
        diff.unchanged.push(filePath);
      }
    }

    // Detect deleted files: in stored state but not in current file list
    for (const storedPath of storedPaths) {
      if (!currentFiles.has(storedPath)) {
        diff.deleted.push(storedPath);
      }
    }

    return diff;
  }

  // ─── Timestamp ──────────────────────────────────────────────────────────────

  /**
   * Updates the lastAnalysis timestamp to the current ISO time.
   */
  updateTimestamp(): void {
    this.state.lastAnalysis = new Date().toISOString();
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  /**
   * Returns the current analysis state (read-only snapshot).
   */
  getState(): Readonly<AnalysisState> {
    return this.state;
  }

  /**
   * Returns whether a previous analysis state was loaded successfully.
   */
  hasPreviousState(): boolean {
    return Object.keys(this.state.fileHashes).length > 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createEmptyState(rootPath: string): AnalysisState {
  return {
    version: STATE_VERSION,
    lastAnalysis: '',
    rootPath,
    fileHashes: {},
    fileToArtifactMap: {},
    analysisConfig: {
      focusAreas: [],
      excludePaths: [],
    },
  };
}
