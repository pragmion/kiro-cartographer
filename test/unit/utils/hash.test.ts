import { describe, it, expect } from 'vitest';
import { computeHash, computeFileHash } from '../../../src/utils/hash.js';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('computeHash', () => {
  it('returns a 64-character hex string', () => {
    const hash = computeHash('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces consistent results for the same input', () => {
    expect(computeHash('test')).toBe(computeHash('test'));
  });

  it('produces different results for different inputs', () => {
    expect(computeHash('a')).not.toBe(computeHash('b'));
  });

  it('computes known SHA-256 hash for empty string', () => {
    // SHA-256 of empty string is well-known
    expect(computeHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

describe('computeFileHash', () => {
  const testDir = join(tmpdir(), 'hash-test-' + Date.now());

  it('returns the SHA-256 hash of a file', async () => {
    await mkdir(testDir, { recursive: true });
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'hello world', 'utf-8');

    const result = await computeFileHash(filePath);
    expect(result).toHaveProperty('value');
    if ('value' in result) {
      expect(result.value).toHaveLength(64);
      expect(result.value).toMatch(/^[a-f0-9]{64}$/);
    }

    await rm(testDir, { recursive: true, force: true });
  });

  it('returns an error for a non-existent file', async () => {
    const result = await computeFileHash('/nonexistent/path/file.txt');
    expect(result).toHaveProperty('isError', true);
    if ('isError' in result) {
      expect(result.error).toContain('Failed to hash file');
    }
  });
});
