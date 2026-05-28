import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AnalysisStateCache } from '../../src/cache/state-cache.js';

describe('AnalysisStateCache', () => {
  let cache: AnalysisStateCache;
  let tempDir: string;

  beforeEach(async () => {
    cache = new AnalysisStateCache();
    tempDir = await mkdtemp(join(tmpdir(), 'state-cache-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('StateCache interface', () => {
    it('should return undefined for unknown file hash', () => {
      expect(cache.getFileHash('unknown.ts')).toBeUndefined();
    });

    it('should store and retrieve file hashes', () => {
      cache.setFileHash('src/index.ts', 'abc123');
      expect(cache.getFileHash('src/index.ts')).toBe('abc123');
    });

    it('should return empty array for unknown file artifacts', () => {
      expect(cache.getArtifactsForFile('unknown.ts')).toEqual([]);
    });

    it('should store and retrieve artifacts for a file', () => {
      const artifacts = ['.kiro/steering/build.md', '.kiro/skills/api.md'];
      cache.setArtifactsForFile('src/server.ts', artifacts);
      expect(cache.getArtifactsForFile('src/server.ts')).toEqual(artifacts);
    });
  });

  describe('load', () => {
    it('should initialize empty state when no state file exists', async () => {
      await cache.load(tempDir);
      expect(cache.hasPreviousState()).toBe(false);
    });

    it('should load valid state from file', async () => {
      const stateDir = join(tempDir, '.cartographer');
      await mkdir(stateDir, { recursive: true });

      const state = {
        version: '1.0.0',
        lastAnalysis: '2024-01-01T00:00:00.000Z',
        rootPath: tempDir,
        fileHashes: { 'src/index.ts': 'hash123' },
        fileToArtifactMap: { 'src/index.ts': ['artifact.md'] },
        analysisConfig: { focusAreas: [], excludePaths: [] },
      };
      await writeFile(join(stateDir, 'analysis-state.json'), JSON.stringify(state));

      await cache.load(tempDir);
      expect(cache.hasPreviousState()).toBe(true);
      expect(cache.getFileHash('src/index.ts')).toBe('hash123');
      expect(cache.getArtifactsForFile('src/index.ts')).toEqual(['artifact.md']);
    });

    it('should initialize empty state when file contains invalid JSON', async () => {
      const stateDir = join(tempDir, '.cartographer');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'analysis-state.json'), 'not valid json');

      await cache.load(tempDir);
      expect(cache.hasPreviousState()).toBe(false);
    });

    it('should initialize empty state when file has invalid structure', async () => {
      const stateDir = join(tempDir, '.cartographer');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'analysis-state.json'), JSON.stringify({ foo: 'bar' }));

      await cache.load(tempDir);
      expect(cache.hasPreviousState()).toBe(false);
    });
  });

  describe('save', () => {
    it('should persist state to disk and reload it', async () => {
      cache.setFileHash('src/app.ts', 'hashA');
      cache.setArtifactsForFile('src/app.ts', ['steering.md']);
      cache.updateTimestamp();

      await cache.save(tempDir);

      // Load in a new cache instance
      const cache2 = new AnalysisStateCache();
      await cache2.load(tempDir);

      expect(cache2.getFileHash('src/app.ts')).toBe('hashA');
      expect(cache2.getArtifactsForFile('src/app.ts')).toEqual(['steering.md']);
      expect(cache2.hasPreviousState()).toBe(true);
    });
  });

  describe('computeDiff', () => {
    it('should detect added files (not in stored state)', async () => {
      // Create a file on disk
      const filePath = 'new-file.txt';
      await writeFile(join(tempDir, filePath), 'hello world');

      const diff = await cache.computeDiff(tempDir, [filePath]);

      expect(diff.added).toContain(filePath);
      expect(diff.modified).toHaveLength(0);
      expect(diff.deleted).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('should detect modified files (different hash)', async () => {
      const filePath = 'existing.txt';
      await writeFile(join(tempDir, filePath), 'original content');

      // Store a different hash
      cache.setFileHash(filePath, 'old-hash-that-does-not-match');

      const diff = await cache.computeDiff(tempDir, [filePath]);

      expect(diff.modified).toContain(filePath);
      expect(diff.added).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('should detect unchanged files (same hash)', async () => {
      const filePath = 'stable.txt';
      const content = 'stable content';
      await writeFile(join(tempDir, filePath), content);

      // Compute the real hash and store it
      const { createHash } = await import('node:crypto');
      const { readFile } = await import('node:fs/promises');
      const fileContent = await readFile(join(tempDir, filePath));
      const realHash = createHash('sha256').update(fileContent).digest('hex');
      cache.setFileHash(filePath, realHash);

      const diff = await cache.computeDiff(tempDir, [filePath]);

      expect(diff.unchanged).toContain(filePath);
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });

    it('should detect deleted files (in state but not in current list)', async () => {
      cache.setFileHash('deleted-file.ts', 'some-hash');

      const diff = await cache.computeDiff(tempDir, []);

      expect(diff.deleted).toContain('deleted-file.ts');
    });

    it('should handle mixed changes correctly', async () => {
      // Set up stored state
      const { createHash } = await import('node:crypto');
      const { readFile } = await import('node:fs/promises');

      // File that will be unchanged
      const unchangedFile = 'unchanged.txt';
      await writeFile(join(tempDir, unchangedFile), 'same');
      const unchangedContent = await readFile(join(tempDir, unchangedFile));
      const unchangedHash = createHash('sha256').update(unchangedContent).digest('hex');
      cache.setFileHash(unchangedFile, unchangedHash);

      // File that will be modified
      const modifiedFile = 'modified.txt';
      await writeFile(join(tempDir, modifiedFile), 'new content');
      cache.setFileHash(modifiedFile, 'old-hash');

      // File that was deleted (in state but not in current list)
      cache.setFileHash('gone.txt', 'hash-of-gone');

      // File that is new (not in state)
      const addedFile = 'added.txt';
      await writeFile(join(tempDir, addedFile), 'brand new');

      const diff = await cache.computeDiff(tempDir, [unchangedFile, modifiedFile, addedFile]);

      expect(diff.unchanged).toContain(unchangedFile);
      expect(diff.modified).toContain(modifiedFile);
      expect(diff.added).toContain(addedFile);
      expect(diff.deleted).toContain('gone.txt');
    });
  });

  describe('updateTimestamp', () => {
    it('should set lastAnalysis to a valid ISO timestamp', () => {
      cache.updateTimestamp();
      const state = cache.getState();
      expect(state.lastAnalysis).toBeTruthy();
      expect(new Date(state.lastAnalysis).getTime()).not.toBeNaN();
    });
  });

  describe('getState', () => {
    it('should return the current state', () => {
      const state = cache.getState();
      expect(state.version).toBe('1.0.0');
      expect(state.fileHashes).toEqual({});
      expect(state.fileToArtifactMap).toEqual({});
    });
  });
});
