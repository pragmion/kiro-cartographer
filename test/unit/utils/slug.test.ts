import { describe, it, expect } from 'vitest';
import { generateSlug } from '../../../src/utils/slug.js';

describe('generateSlug', () => {
  it('converts a simple string to lowercase slug', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('replaces German umlauts correctly', () => {
    expect(generateSlug('Über Öffnung')).toBe('ueber-oeffnung');
    expect(generateSlug('Größe')).toBe('groesse');
    expect(generateSlug('Ärger')).toBe('aerger');
    expect(generateSlug('Fünf Würfel')).toBe('fuenf-wuerfel');
  });

  it('replaces ß with ss', () => {
    expect(generateSlug('Straße')).toBe('strasse');
  });

  it('removes special characters and replaces with hyphens', () => {
    expect(generateSlug('hello@world!')).toBe('hello-world');
    expect(generateSlug('foo/bar/baz')).toBe('foo-bar-baz');
  });

  it('collapses multiple hyphens into one', () => {
    expect(generateSlug('hello---world')).toBe('hello-world');
    expect(generateSlug('a   b   c')).toBe('a-b-c');
  });

  it('removes leading and trailing hyphens', () => {
    expect(generateSlug('--hello--')).toBe('hello');
    expect(generateSlug('  hello  ')).toBe('hello');
  });

  it('handles a realistic skill title', () => {
    expect(generateSlug('Neuen API-Endpunkt anlegen')).toBe('neuen-api-endpunkt-anlegen');
  });

  it('handles uppercase umlauts', () => {
    expect(generateSlug('Ärger Über Öl')).toBe('aerger-ueber-oel');
  });

  it('returns empty string for empty input', () => {
    expect(generateSlug('')).toBe('');
  });

  it('preserves numbers', () => {
    expect(generateSlug('Version 2.0 Release')).toBe('version-2-0-release');
  });
});
