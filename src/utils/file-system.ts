import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Result type for safe operations.
 * On success: { value: T }
 * On error: { isError: true, error: string }
 */
export type Result<T> =
  | { value: T; isError?: never }
  | { isError: true; error: string };

/**
 * Safely reads a directory and returns its entries.
 * Returns a Result with directory entries on success, or an error message on failure.
 */
export async function safeReadDir(path: string): Promise<Result<string[]>> {
  try {
    const entries = await readdir(path);
    return { value: entries };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, error: `Failed to read directory "${path}": ${message}` };
  }
}

/**
 * Safely reads a file and returns its content as a string.
 * Returns a Result with file content on success, or an error message on failure.
 */
export async function safeReadFile(path: string): Promise<Result<string>> {
  try {
    const content = await readFile(path, 'utf-8');
    return { value: content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, error: `Failed to read file "${path}": ${message}` };
  }
}

/**
 * Safely writes content to a file, creating parent directories if needed.
 * Returns a Result with void on success, or an error message on failure.
 */
export async function safeWriteFile(path: string, content: string): Promise<Result<void>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
    return { value: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, error: `Failed to write file "${path}": ${message}` };
  }
}
