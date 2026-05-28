/**
 * Mapping of German umlauts and special characters to their ASCII equivalents.
 */
const UMLAUT_MAP: Record<string, string> = {
  'ä': 'ae',
  'ö': 'oe',
  'ü': 'ue',
  'Ä': 'Ae',
  'Ö': 'Oe',
  'Ü': 'Ue',
  'ß': 'ss',
};

/**
 * Generates a URL-compatible slug from a given string.
 * Handles German umlauts (ä→ae, ö→oe, ü→ue, ß→ss), converts to lowercase,
 * replaces non-alphanumeric characters with hyphens, and collapses multiple hyphens.
 */
export function generateSlug(input: string): string {
  let result = input;

  // Replace German umlauts and ß
  for (const [char, replacement] of Object.entries(UMLAUT_MAP)) {
    result = result.replaceAll(char, replacement);
  }

  // Convert to lowercase
  result = result.toLowerCase();

  // Replace non-alphanumeric characters (except hyphens) with hyphens
  result = result.replace(/[^a-z0-9-]/g, '-');

  // Collapse multiple consecutive hyphens into one
  result = result.replace(/-+/g, '-');

  // Remove leading and trailing hyphens
  result = result.replace(/^-+|-+$/g, '');

  return result;
}
