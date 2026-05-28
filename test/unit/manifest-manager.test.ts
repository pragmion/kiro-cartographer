import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManifestManager, GENERATED_HEADER, type ConflictType } from '../../src/generators/manifest-manager.js';
import type { GeneratedFile } from '../../src/types.js';

describe('ManifestManager', () => {
  let tempDir: string;
  let manager: ManifestManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    manager = new ManifestManager();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadManifest', () => {
    it('should start with empty manifest when file does not exist', async () => {
      await manager.loadManifest(tempDir);
      const manifest = manager.getManifest();
      expect(manifest.files).toEqual([]);
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.powerName).toBe('kiro-cartographer');
    });

    it('should load existing manifest from disk', async () => {
      const kiroDir = join(tempDir, '.kiro');
      await mkdir(kiroDir, { recursive: true });
      const manifestData = {
        version: '1.0.0',
        generatedAt: '2024-01-01T00:00:00.000Z',
        powerName: 'kiro-cartographer',
        powerVersion: '1.0.0',
        files: [
          {
            path: '.kiro/steering/coding-standards.md',
            type: 'steering',
            generatedAt: '2024-01-01T00:00:00.000Z',
            hash: 'abc123',
            sourceAnalysis: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
      await writeFile(join(kiroDir, '.generated-manifest.json'), JSON.stringify(manifestData));

      await manager.loadManifest(tempDir);
      const manifest = manager.getManifest();
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0].path).toBe('.kiro/steering/coding-standards.md');
    });

    it('should start fresh when manifest file contains invalid JSON', async () => {
      const kiroDir = join(tempDir, '.kiro');
      await mkdir(kiroDir, { recursive: true });
      await writeFile(join(kiroDir, '.generated-manifest.json'), 'not valid json {{{');

      await manager.loadManifest(tempDir);
      const manifest = manager.getManifest();
      expect(manifest.files).toEqual([]);
    });

    it('should start fresh when manifest has invalid structure', async () => {
      const kiroDir = join(tempDir, '.kiro');
      await mkdir(kiroDir, { recursive: true });
      await writeFile(join(kiroDir, '.generated-manifest.json'), JSON.stringify({ foo: 'bar' }));

      await manager.loadManifest(tempDir);
      const manifest = manager.getManifest();
      expect(manifest.files).toEqual([]);
    });
  });

  describe('saveManifest', () => {
    it('should save manifest to disk and be loadable again', async () => {
      const file: GeneratedFile = {
        path: '.kiro/steering/test.md',
        type: 'steering',
        content: '# Test content',
        inclusionMode: 'auto',
      };
      manager.addEntry(file);
      await manager.saveManifest(tempDir);

      // Load in a new manager instance
      const manager2 = new ManifestManager();
      await manager2.loadManifest(tempDir);
      const manifest = manager2.getManifest();
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0].path).toBe('.kiro/steering/test.md');
      expect(manifest.files[0].type).toBe('steering');
    });
  });

  describe('addEntry', () => {
    it('should add a new entry to the manifest', () => {
      const file: GeneratedFile = {
        path: '.kiro/steering/coding-standards.md',
        type: 'steering',
        content: '# Coding Standards',
        inclusionMode: 'auto',
      };
      manager.addEntry(file);

      const manifest = manager.getManifest();
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0].path).toBe('.kiro/steering/coding-standards.md');
      expect(manifest.files[0].type).toBe('steering');
      expect(manifest.files[0].hash).toBeTruthy();
      expect(manifest.files[0].generatedAt).toBeTruthy();
    });

    it('should update existing entry with same path', () => {
      const file1: GeneratedFile = {
        path: '.kiro/steering/test.md',
        type: 'steering',
        content: 'version 1',
        inclusionMode: 'auto',
      };
      const file2: GeneratedFile = {
        path: '.kiro/steering/test.md',
        type: 'steering',
        content: 'version 2',
        inclusionMode: 'auto',
      };

      manager.addEntry(file1);
      manager.addEntry(file2);

      const manifest = manager.getManifest();
      expect(manifest.files).toHaveLength(1);
      // Hash should differ because content differs
      expect(manifest.files[0].hash).toBeTruthy();
    });

    it('should compute SHA-256 hash of content', () => {
      const file: GeneratedFile = {
        path: '.kiro/skills/test.md',
        type: 'skills',
        content: 'hello world',
        inclusionMode: 'manual',
      };
      manager.addEntry(file);

      const manifest = manager.getManifest();
      // SHA-256 of 'hello world' is known
      expect(manifest.files[0].hash).toBe(
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
    });
  });

  describe('isManuallyCreated', () => {
    it('should return true for file that exists without header and not in manifest', async () => {
      const filePath = '.kiro/steering/my-custom.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });
      await writeFile(fullPath, '# My Custom Steering File\n\nManually written.');

      const result = await manager.isManuallyCreated(tempDir, filePath);
      expect(result).toBe(true);
    });

    it('should return false for file that has the generated header', async () => {
      const filePath = '.kiro/steering/generated.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });
      await writeFile(fullPath, `${GENERATED_HEADER}\n\n# Generated File`);

      const result = await manager.isManuallyCreated(tempDir, filePath);
      expect(result).toBe(false);
    });

    it('should return false for file that is in the manifest', async () => {
      const filePath = '.kiro/steering/tracked.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });
      await writeFile(fullPath, '# Some content without header');

      // Add to manifest
      manager.addEntry({
        path: filePath,
        type: 'steering',
        content: '# Some content without header',
        inclusionMode: 'auto',
      });

      const result = await manager.isManuallyCreated(tempDir, filePath);
      expect(result).toBe(false);
    });

    it('should return false when file does not exist', async () => {
      const result = await manager.isManuallyCreated(tempDir, '.kiro/steering/nonexistent.md');
      expect(result).toBe(false);
    });
  });

  describe('isManuallyAdopted', () => {
    it('should return true when file is in manifest but header was removed', async () => {
      const filePath = '.kiro/steering/adopted.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });

      // Add to manifest (simulating it was previously generated)
      manager.addEntry({
        path: filePath,
        type: 'steering',
        content: `${GENERATED_HEADER}\n\n# Original`,
        inclusionMode: 'auto',
      });

      // Write file without header (user removed it)
      await writeFile(fullPath, '# Modified by user\n\nCustom content.');

      const result = await manager.isManuallyAdopted(tempDir, filePath);
      expect(result).toBe(true);
    });

    it('should return false when file is in manifest and still has header', async () => {
      const filePath = '.kiro/steering/still-generated.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });

      manager.addEntry({
        path: filePath,
        type: 'steering',
        content: `${GENERATED_HEADER}\n\n# Generated`,
        inclusionMode: 'auto',
      });

      await writeFile(fullPath, `${GENERATED_HEADER}\n\n# Generated`);

      const result = await manager.isManuallyAdopted(tempDir, filePath);
      expect(result).toBe(false);
    });

    it('should return false when file is not in manifest', async () => {
      const filePath = '.kiro/steering/unknown.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });
      await writeFile(fullPath, '# Some file');

      const result = await manager.isManuallyAdopted(tempDir, filePath);
      expect(result).toBe(false);
    });

    it('should return false when file in manifest no longer exists on disk', async () => {
      const filePath = '.kiro/steering/deleted.md';
      manager.addEntry({
        path: filePath,
        type: 'steering',
        content: `${GENERATED_HEADER}\n\n# Was here`,
        inclusionMode: 'auto',
      });

      const result = await manager.isManuallyAdopted(tempDir, filePath);
      expect(result).toBe(false);
    });
  });

  describe('getOutputPath', () => {
    it('should return basePath when no subdirectory is specified', () => {
      const result = manager.getOutputPath('.kiro/steering/coding-standards.md');
      expect(result).toBe('.kiro/steering/coding-standards.md');
    });

    it('should return basePath when subdirectory is undefined', () => {
      const result = manager.getOutputPath('.kiro/steering/coding-standards.md', undefined);
      expect(result).toBe('.kiro/steering/coding-standards.md');
    });

    it('should insert subdirectory before filename', () => {
      const result = manager.getOutputPath('.kiro/steering/coding-standards.md', 'generated');
      expect(result).toBe('.kiro/steering/generated/coding-standards.md');
    });

    it('should work with skills path', () => {
      const result = manager.getOutputPath('.kiro/skills/api-endpoint.md', 'generated');
      expect(result).toBe('.kiro/skills/generated/api-endpoint.md');
    });

    it('should return empty subdirectory as-is for empty string', () => {
      const result = manager.getOutputPath('.kiro/steering/test.md', '');
      expect(result).toBe('.kiro/steering/test.md');
    });
  });

  describe('checkConflict', () => {
    it('should return "none" when file does not exist', async () => {
      const result = await manager.checkConflict(tempDir, '.kiro/steering/new-file.md');
      expect(result).toBe('none');
    });

    it('should return "none" when file exists with header and is in manifest', async () => {
      const filePath = '.kiro/steering/generated.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });

      const content = `${GENERATED_HEADER}\n\n# Generated content`;
      await writeFile(fullPath, content);
      manager.addEntry({
        path: filePath,
        type: 'steering',
        content,
        inclusionMode: 'auto',
      });

      const result = await manager.checkConflict(tempDir, filePath);
      expect(result).toBe('none');
    });

    it('should return "manual-file" when file exists but not in manifest and no header', async () => {
      const filePath = '.kiro/steering/custom.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });
      await writeFile(fullPath, '# My custom steering file');

      const result = await manager.checkConflict(tempDir, filePath);
      expect(result).toBe('manual-file');
    });

    it('should return "manual-adopted" when file is in manifest but header removed', async () => {
      const filePath = '.kiro/steering/adopted.md';
      const fullPath = join(tempDir, filePath);
      await mkdir(join(tempDir, '.kiro/steering'), { recursive: true });

      manager.addEntry({
        path: filePath,
        type: 'steering',
        content: `${GENERATED_HEADER}\n\n# Original`,
        inclusionMode: 'auto',
      });

      // User removed the header
      await writeFile(fullPath, '# I took ownership of this file');

      const result = await manager.checkConflict(tempDir, filePath);
      expect(result).toBe('manual-adopted');
    });
  });

  describe('GENERATED_HEADER constant', () => {
    it('should contain the expected header text', () => {
      expect(GENERATED_HEADER).toBe(
        '<!-- Generated by Kiro Cartographer v1.0.0 | Do not edit manually -->'
      );
    });
  });
});
