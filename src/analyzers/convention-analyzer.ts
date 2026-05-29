// Kiro Cartographer - Convention Analyzer
// Samples source files to detect actual coding conventions:
// indentation, semicolons, trailing commas, naming patterns, comment style,
// and reads config files (.eslintrc, .prettierrc, .editorconfig) when present.

import { readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type { FileTreeNode, ConventionAnalysis, DetectedConvention } from '../types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of source files to sample for convention detection. */
const MAX_SAMPLE_FILES = 20;

/** Maximum file size to read (skip very large files). */
const MAX_FILE_SIZE = 100_000;

/** Source extensions worth sampling. */
const SAMPLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.java', '.kt', '.scala',
  '.rs', '.go', '.cs', '.rb', '.php', '.swift',
]);

/** Config files that define conventions explicitly. */
const CONVENTION_CONFIG_FILES = [
  '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yml', '.prettierrc.yaml',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  '.editorconfig',
  'biome.json', 'biome.jsonc',
  'deno.json', 'deno.jsonc',
];

// ─── Convention Analyzer ────────────────────────────────────────────────────

export class ConventionAnalyzer implements Analyzer<ConventionAnalysis> {
  readonly name = 'ConventionAnalyzer';

  async analyze(context: AnalysisContext): Promise<ConventionAnalysis> {
    await context.reportProgress('Detecting coding conventions', 0, 100);

    const sourceFiles = this.collectSourceFiles(context.fileTree, '');
    const samplePaths = sourceFiles.slice(0, MAX_SAMPLE_FILES);

    // Read source file contents
    const fileContents: { path: string; content: string }[] = [];
    for (const relPath of samplePaths) {
      try {
        const fullPath = join(context.rootPath, relPath);
        const content = await readFile(fullPath, 'utf-8');
        if (content.length <= MAX_FILE_SIZE) {
          fileContents.push({ path: relPath, content });
        }
      } catch {
        // Skip unreadable files
      }
    }

    await context.reportProgress('Analyzing indentation and formatting', 30, 100);

    // Detect conventions from source code
    const indentation = this.detectIndentation(fileContents);
    const semicolons = this.detectSemicolons(fileContents);
    const trailingCommas = this.detectTrailingCommas(fileContents);
    const naming = this.detectNamingConventions(sourceFiles);
    const commentStyle = this.detectCommentStyle(fileContents);
    const importStyle = this.detectImportStyle(fileContents);

    await context.reportProgress('Checking config files', 60, 100);

    // Check for explicit config files
    const configConventions = await this.readConfigFiles(context.rootPath, context.fileTree);

    await context.reportProgress('Convention analysis complete', 100, 100);

    // Merge: config files take precedence over detected conventions
    return this.buildResult(
      { indentation, semicolons, trailingCommas, naming, commentStyle, importStyle },
      configConventions,
      fileContents.length,
    );
  }

  // ─── File Collection ────────────────────────────────────────────────────

  private collectSourceFiles(nodes: FileTreeNode[], prefix: string): string[] {
    const files: string[] = [];
    for (const node of nodes) {
      const path = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'file' && node.category === 'source') {
        const ext = extname(node.name).toLowerCase();
        if (SAMPLE_EXTENSIONS.has(ext)) {
          files.push(path);
        }
      } else if (node.type === 'directory' && node.children) {
        files.push(...this.collectSourceFiles(node.children, path));
      }
    }
    return files;
  }

  // ─── Indentation Detection ──────────────────────────────────────────────

  private detectIndentation(
    files: { path: string; content: string }[],
  ): DetectedConvention<{ type: 'spaces' | 'tabs'; size: number }> {
    let spacesCount = 0;
    let tabsCount = 0;
    const indentSizes: number[] = [];

    for (const { content } of files) {
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.length === 0) continue;
        const match = line.match(/^(\s+)/);
        if (!match) continue;
        const indent = match[1];
        if (indent.includes('\t')) {
          tabsCount++;
        } else {
          spacesCount++;
          // Detect indent size from first indentation level
          if (indent.length <= 8) {
            indentSizes.push(indent.length);
          }
        }
      }
    }

    const total = spacesCount + tabsCount;
    if (total === 0) {
      return { value: { type: 'spaces', size: 2 }, confidence: 'low', source: 'default' };
    }

    const type = spacesCount >= tabsCount ? 'spaces' : 'tabs';
    const confidence = (Math.max(spacesCount, tabsCount) / total) > 0.9 ? 'high' : 'medium';

    // Determine indent size (most common smallest indent)
    let size = 2;
    if (type === 'spaces' && indentSizes.length > 0) {
      const sizeCounts = new Map<number, number>();
      for (const s of indentSizes) {
        sizeCounts.set(s, (sizeCounts.get(s) ?? 0) + 1);
      }
      // Find the smallest indent that appears frequently (likely the base indent)
      const candidates = [...sizeCounts.entries()]
        .filter(([s]) => s >= 2 && s <= 8)
        .sort((a, b) => a[0] - b[0]);

      if (candidates.length > 0) {
        // The most common small indent is likely the base
        size = candidates[0][0];
        // But check if 2 or 4 dominates
        const twoCount = sizeCounts.get(2) ?? 0;
        const fourCount = sizeCounts.get(4) ?? 0;
        if (fourCount > twoCount * 2) size = 4;
        else if (twoCount > 0) size = 2;
      }
    }

    return { value: { type, size }, confidence, source: 'detected' };
  }

  // ─── Semicolon Detection ────────────────────────────────────────────────

  private detectSemicolons(
    files: { path: string; content: string }[],
  ): DetectedConvention<boolean> {
    let withSemicolon = 0;
    let withoutSemicolon = 0;

    for (const { content, path } of files) {
      const ext = extname(path).toLowerCase();
      // Only relevant for JS/TS
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) continue;

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (trimmed.endsWith('{') || trimmed.endsWith('}') || trimmed.endsWith('(') || trimmed.endsWith(',')) continue;
        if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
          if (trimmed.endsWith(';')) withSemicolon++;
          else if (!trimmed.endsWith('{') && !trimmed.endsWith(',')) withoutSemicolon++;
        }
      }
    }

    const total = withSemicolon + withoutSemicolon;
    if (total === 0) {
      return { value: true, confidence: 'low', source: 'default' };
    }

    const value = withSemicolon > withoutSemicolon;
    const ratio = Math.max(withSemicolon, withoutSemicolon) / total;
    const confidence = ratio > 0.9 ? 'high' : ratio > 0.7 ? 'medium' : 'low';

    return { value, confidence, source: 'detected' };
  }

  // ─── Trailing Comma Detection ───────────────────────────────────────────

  private detectTrailingCommas(
    files: { path: string; content: string }[],
  ): DetectedConvention<boolean> {
    let withTrailing = 0;
    let withoutTrailing = 0;

    for (const { content, path } of files) {
      const ext = extname(path).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const trimmed = lines[i].trim();
        const nextTrimmed = lines[i + 1]?.trim() ?? '';

        // Look for lines before closing brackets
        if (nextTrimmed === ')' || nextTrimmed === ']' || nextTrimmed === '}' ||
            nextTrimmed === ');' || nextTrimmed === '];' || nextTrimmed === '};' ||
            nextTrimmed === '),' || nextTrimmed === '],' || nextTrimmed === '},') {
          if (trimmed.endsWith(',')) withTrailing++;
          else if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
            withoutTrailing++;
          }
        }
      }
    }

    const total = withTrailing + withoutTrailing;
    if (total === 0) {
      return { value: true, confidence: 'low', source: 'default' };
    }

    const value = withTrailing > withoutTrailing;
    const ratio = Math.max(withTrailing, withoutTrailing) / total;
    const confidence = ratio > 0.8 ? 'high' : ratio > 0.6 ? 'medium' : 'low';

    return { value, confidence, source: 'detected' };
  }

  // ─── Naming Convention Detection ────────────────────────────────────────

  private detectNamingConventions(
    filePaths: string[],
  ): DetectedConvention<'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case'> {
    let kebab = 0;
    let camel = 0;
    let pascal = 0;
    let snake = 0;

    for (const filePath of filePaths) {
      const name = basename(filePath, extname(filePath));
      if (name.includes('-')) kebab++;
      else if (name.includes('_')) snake++;
      else if (name[0] === name[0].toUpperCase() && name.length > 1) pascal++;
      else camel++;
    }

    const total = kebab + camel + pascal + snake;
    if (total === 0) {
      return { value: 'kebab-case', confidence: 'low', source: 'default' };
    }

    const max = Math.max(kebab, camel, pascal, snake);
    const value = max === kebab ? 'kebab-case'
      : max === camel ? 'camelCase'
      : max === pascal ? 'PascalCase'
      : 'snake_case';

    const confidence = (max / total) > 0.8 ? 'high' : (max / total) > 0.6 ? 'medium' : 'low';

    return { value, confidence, source: 'detected' };
  }

  // ─── Comment Style Detection ────────────────────────────────────────────

  private detectCommentStyle(
    files: { path: string; content: string }[],
  ): DetectedConvention<'jsdoc' | 'inline' | 'minimal' | 'none'> {
    let jsdocCount = 0;
    let inlineCount = 0;
    let totalFunctions = 0;

    for (const { content } of files) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Count exported/public function/method declarations (these should be documented)
        const isPublicDeclaration =
          line.match(/^export\s+(async\s+)?function\s/) ||
          line.match(/^export\s+(class|interface|type|enum)\s/) ||
          line.match(/^\s*(public|protected)\s+(async\s+)?\w+\s*\(/) ||
          line.match(/^\s+(async\s+)?\w+\s*\([^)]*\)\s*[:{]/) ||
          line.match(/^(async\s+)?function\s/);

        if (isPublicDeclaration) {
          totalFunctions++;

          // Check if preceded by JSDoc
          let j = i - 1;
          while (j >= 0 && lines[j].trim() === '') j--;
          if (j >= 0 && lines[j].trim().endsWith('*/')) {
            // Walk back to find /**
            let k = j;
            while (k >= 0 && !lines[k].trim().startsWith('/**')) k--;
            if (k >= 0) jsdocCount++;
          } else if (j >= 0 && lines[j].trim().startsWith('//')) {
            inlineCount++;
          }
        }
      }
    }

    if (totalFunctions === 0) {
      return { value: 'none', confidence: 'low', source: 'default' };
    }

    const jsdocRatio = jsdocCount / totalFunctions;
    const inlineRatio = inlineCount / totalFunctions;
    const commentedRatio = (jsdocCount + inlineCount) / totalFunctions;

    let value: 'jsdoc' | 'inline' | 'minimal' | 'none';
    if (jsdocRatio > 0.4) value = 'jsdoc';
    else if (inlineRatio > 0.3) value = 'inline';
    else if (commentedRatio < 0.1) value = 'none';
    else value = 'minimal';

    const confidence = jsdocRatio > 0.5 || commentedRatio < 0.05 ? 'high' : 'medium';

    return { value, confidence, source: 'detected' };
  }

  // ─── Import Style Detection ─────────────────────────────────────────────

  private detectImportStyle(
    files: { path: string; content: string }[],
  ): DetectedConvention<{ hasGroupSeparator: boolean; order: string[] }> {
    let separatedCount = 0;
    let unseparatedCount = 0;

    for (const { content, path } of files) {
      const ext = extname(path).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) continue;

      const lines = content.split('\n');
      let inImportBlock = false;
      let hasBlankInImports = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('import ')) {
          inImportBlock = true;
        } else if (inImportBlock) {
          if (trimmed === '') {
            hasBlankInImports = true;
          } else if (!trimmed.startsWith('import ')) {
            break;
          }
        }
      }

      if (inImportBlock) {
        if (hasBlankInImports) separatedCount++;
        else unseparatedCount++;
      }
    }

    const total = separatedCount + unseparatedCount;
    const hasGroupSeparator = separatedCount > unseparatedCount;
    const confidence = total === 0 ? 'low'
      : (Math.max(separatedCount, unseparatedCount) / total) > 0.7 ? 'high' : 'medium';

    return {
      value: { hasGroupSeparator, order: ['builtin', 'external', 'internal', 'relative'] },
      confidence,
      source: total > 0 ? 'detected' : 'default',
    };
  }

  // ─── Config File Reading ────────────────────────────────────────────────

  private async readConfigFiles(
    rootPath: string,
    fileTree: FileTreeNode[],
  ): Promise<Partial<ConfigConventions>> {
    const result: Partial<ConfigConventions> = {};

    // Find config files in root
    const rootFiles = fileTree
      .filter((n) => n.type === 'file')
      .map((n) => n.name);

    // .editorconfig
    if (rootFiles.includes('.editorconfig')) {
      try {
        const content = await readFile(join(rootPath, '.editorconfig'), 'utf-8');
        Object.assign(result, this.parseEditorConfig(content));
      } catch { /* skip */ }
    }

    // .prettierrc (JSON format)
    for (const name of ['.prettierrc', '.prettierrc.json']) {
      if (rootFiles.includes(name)) {
        try {
          const content = await readFile(join(rootPath, name), 'utf-8');
          Object.assign(result, this.parsePrettierConfig(content));
        } catch { /* skip */ }
        break;
      }
    }

    // biome.json
    if (rootFiles.includes('biome.json') || rootFiles.includes('biome.jsonc')) {
      const name = rootFiles.includes('biome.json') ? 'biome.json' : 'biome.jsonc';
      try {
        const content = await readFile(join(rootPath, name), 'utf-8');
        Object.assign(result, this.parseBiomeConfig(content));
      } catch { /* skip */ }
    }

    return result;
  }

  private parseEditorConfig(content: string): Partial<ConfigConventions> {
    const result: Partial<ConfigConventions> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

      const [key, value] = trimmed.split('=').map((s) => s.trim());
      if (!key || !value) continue;

      switch (key) {
        case 'indent_style':
          result.indentType = value === 'tab' ? 'tabs' : 'spaces';
          break;
        case 'indent_size':
          result.indentSize = parseInt(value, 10) || undefined;
          break;
        case 'max_line_length':
          result.maxLineLength = parseInt(value, 10) || undefined;
          break;
      }
    }

    return result;
  }

  private parsePrettierConfig(content: string): Partial<ConfigConventions> {
    const result: Partial<ConfigConventions> = {};
    try {
      const config = JSON.parse(content);
      if (config.useTabs !== undefined) result.indentType = config.useTabs ? 'tabs' : 'spaces';
      if (config.tabWidth !== undefined) result.indentSize = config.tabWidth;
      if (config.printWidth !== undefined) result.maxLineLength = config.printWidth;
      if (config.semi !== undefined) result.semicolons = config.semi;
      if (config.trailingComma !== undefined) result.trailingComma = config.trailingComma !== 'none';
      if (config.singleQuote !== undefined) result.singleQuote = config.singleQuote;
    } catch { /* invalid JSON */ }
    return result;
  }

  private parseBiomeConfig(content: string): Partial<ConfigConventions> {
    const result: Partial<ConfigConventions> = {};
    try {
      // Strip JSONC comments
      const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(cleaned);
      const formatter = config.formatter;
      if (formatter) {
        if (formatter.indentStyle) result.indentType = formatter.indentStyle === 'tab' ? 'tabs' : 'spaces';
        if (formatter.indentWidth) result.indentSize = formatter.indentWidth;
        if (formatter.lineWidth) result.maxLineLength = formatter.lineWidth;
      }
      const js = config.javascript?.formatter;
      if (js) {
        if (js.semicolons !== undefined) result.semicolons = js.semicolons !== 'asNeeded';
        if (js.trailingCommas !== undefined) result.trailingComma = js.trailingCommas !== 'none';
        if (js.quoteStyle !== undefined) result.singleQuote = js.quoteStyle === 'single';
      }
    } catch { /* invalid JSON */ }
    return result;
  }

  // ─── Result Building ────────────────────────────────────────────────────

  private buildResult(
    detected: {
      indentation: DetectedConvention<{ type: 'spaces' | 'tabs'; size: number }>;
      semicolons: DetectedConvention<boolean>;
      trailingCommas: DetectedConvention<boolean>;
      naming: DetectedConvention<'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case'>;
      commentStyle: DetectedConvention<'jsdoc' | 'inline' | 'minimal' | 'none'>;
      importStyle: DetectedConvention<{ hasGroupSeparator: boolean; order: string[] }>;
    },
    configOverrides: Partial<ConfigConventions>,
    sampledFiles: number,
  ): ConventionAnalysis {
    // Config files override detected values
    const indentType = configOverrides.indentType ?? detected.indentation.value.type;
    const indentSize = configOverrides.indentSize ?? detected.indentation.value.size;
    const semicolons = configOverrides.semicolons ?? detected.semicolons.value;
    const trailingComma = configOverrides.trailingComma ?? detected.trailingCommas.value;
    const maxLineLength = configOverrides.maxLineLength ?? undefined;

    const hasConfigFile = Object.keys(configOverrides).length > 0;

    return {
      sampledFiles,
      hasConfigFile,
      formatting: {
        indentation: {
          value: indentType,
          confidence: configOverrides.indentType ? 'high' : detected.indentation.confidence,
          source: configOverrides.indentType ? 'config-file' : detected.indentation.source,
        },
        indentSize: {
          value: indentSize,
          confidence: configOverrides.indentSize ? 'high' : detected.indentation.confidence,
          source: configOverrides.indentSize ? 'config-file' : detected.indentation.source,
        },
        semicolons: {
          value: semicolons,
          confidence: configOverrides.semicolons !== undefined ? 'high' : detected.semicolons.confidence,
          source: configOverrides.semicolons !== undefined ? 'config-file' : detected.semicolons.source,
        },
        trailingComma: {
          value: trailingComma,
          confidence: configOverrides.trailingComma !== undefined ? 'high' : detected.trailingCommas.confidence,
          source: configOverrides.trailingComma !== undefined ? 'config-file' : detected.trailingCommas.source,
        },
        maxLineLength: maxLineLength ? {
          value: maxLineLength,
          confidence: 'high' as const,
          source: 'config-file' as const,
        } : undefined,
      },
      naming: {
        files: detected.naming,
      },
      commentStyle: detected.commentStyle,
      imports: {
        groupSeparator: {
          value: detected.importStyle.value.hasGroupSeparator,
          confidence: detected.importStyle.confidence,
          source: detected.importStyle.source,
        },
        order: detected.importStyle.value.order,
      },
    };
  }
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface ConfigConventions {
  indentType: 'spaces' | 'tabs';
  indentSize: number;
  maxLineLength: number;
  semicolons: boolean;
  trailingComma: boolean;
  singleQuote: boolean;
}
