import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Result } from './file-system.js';

/**
 * Computes the SHA-256 hash of a string.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Computes the SHA-256 hash of a file's content.
 * Returns a Result with the hex-encoded hash on success, or an error message on failure.
 */
export async function computeFileHash(filePath: string): Promise<Result<string>> {
  try {
    const content = await readFile(filePath);
    const hash = createHash('sha256').update(content).digest('hex');
    return { value: hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, error: `Failed to hash file "${filePath}": ${message}` };
  }
}
