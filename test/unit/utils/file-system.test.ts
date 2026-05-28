import { describe, it, expect } from 'vitest';
import { safeReadDir, safeReadFile, safeWriteFile } from '../../../src/utils/file-system.js';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('safeReadDir', () => {
  const testDir = join(tmpdir(), 'readdir-test-' + Date.now());

  it('returns directory entries on success', async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, 'a.txt'), 'a');
    await writeFile(join(testDir, 'b.txt'), 'b');

    const result = await safeReadDir(testDir);
    expect(result).toHaveProperty('value');
    if ('value' in result) {
      expect(result.value).toContain('a.txt');
      expect(result.value).toContain('b.txt');
    }

    await rm(testDir, { recursive: true, force: true });
  });

  it('returns an error for a non-existent directory', async () => {
    const result = await safeReadDir('/nonexistent/path');
    expect(result).toHaveProperty('isError', true);
    if ('isError' in result) {
      expect(result.error).toContain('Failed to read directory');
    }
  });
});

describe('safeReadFile', () => {
  const testDir = join(tmpdir(), 'readfile-test-' + Date.now());

  it('returns file content on success', async () => {
    await mkdir(testDir, { recursive: true });
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'hello world', 'utf-8');

    const result = await safeReadFile(filePath);
    expect(result).toHaveProperty('value', 'hello world');

    await rm(testDir, { recursive: true, force: true });
  });

  it('returns an error for a non-existent file', async () => {
    const result = await safeReadFile('/nonexistent/file.txt');
    expect(result).toHaveProperty('isError', true);
    if ('isError' in result) {
      expect(result.error).toContain('Failed to read file');
    }
  });
});

describe('safeWriteFile', () => {
  const testDir = join(tmpdir(), 'writefile-test-' + Date.now());

  it('writes content to a file and creates parent directories', async () => {
    const filePath = join(testDir, 'sub', 'dir', 'output.txt');

    const writeResult = await safeWriteFile(filePath, 'written content');
    expect(writeResult).toHaveProperty('value');

    const readResult = await safeReadFile(filePath);
    expect(readResult).toHaveProperty('value', 'written content');

    await rm(testDir, { recursive: true, force: true });
  });

  it('overwrites existing file content', async () => {
    await mkdir(testDir, { recursive: true });
    const filePath = join(testDir, 'overwrite.txt');
    await writeFile(filePath, 'original', 'utf-8');

    const result = await safeWriteFile(filePath, 'updated');
    expect(result).toHaveProperty('value');

    const readResult = await safeReadFile(filePath);
    expect(readResult).toHaveProperty('value', 'updated');

    await rm(testDir, { recursive: true, force: true });
  });
});
