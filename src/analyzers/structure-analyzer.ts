// Codebase Explorer Power - Structure Analyzer
// Traverses the file system, categorizes files, and computes language distribution.

import { readdir, lstat, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type {
  FileTreeNode,
  FileCategory,
  ProjectStructure,
  LanguageDistribution,
  AnalysisWarning,
} from '../types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default directories excluded from traversal. */
export const DEFAULT_EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.cache',
  '.turbo',
  '.parcel-cache',
  'target',        // Rust/Java
  'vendor',        // Go/PHP
  '.venv',
  'venv',
  'env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  '.idea',
  '.vscode',
]);

/** Maximum traversal depth (default). */
export const DEFAULT_MAX_DEPTH = 20;

// ─── File Category Mapping ──────────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.java', '.kt', '.kts', '.scala',
  '.rs',
  '.go',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.dart',
  '.lua',
  '.r', '.R',
  '.m', '.mm',       // Objective-C
  '.ex', '.exs',     // Elixir
  '.erl', '.hrl',    // Erlang
  '.hs',             // Haskell
  '.clj', '.cljs',   // Clojure
  '.vue', '.svelte',
]);

const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.env', '.properties', '.xml', '.conf',
  '.lock', '.editorconfig', '.prettierrc', '.eslintrc',
]);

const CONFIG_FILENAMES = new Set([
  'tsconfig.json', 'package.json', 'package-lock.json',
  'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb',
  'webpack.config.js', 'webpack.config.ts',
  'vite.config.js', 'vite.config.ts',
  'rollup.config.js', 'rollup.config.ts',
  'jest.config.js', 'jest.config.ts',
  'vitest.config.js', 'vitest.config.ts',
  'babel.config.js', '.babelrc',
  'Makefile', 'CMakeLists.txt',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'Cargo.toml', 'Cargo.lock',
  'go.mod', 'go.sum',
  'build.gradle', 'build.gradle.kts', 'pom.xml',
  'Gemfile', 'Gemfile.lock',
  'requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile',
  '.gitignore', '.dockerignore', '.npmignore',
]);

const TEST_PATTERNS = [
  /\.test\.[a-z]+$/,
  /\.spec\.[a-z]+$/,
  /_test\.[a-z]+$/,
  /_spec\.[a-z]+$/,
  /\.tests\.[a-z]+$/,
  /\.specs\.[a-z]+$/,
];

const DOCUMENTATION_EXTENSIONS = new Set([
  '.md', '.mdx', '.rst', '.txt', '.adoc', '.tex',
]);

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.tar', '.gz',
  '.css', '.scss', '.sass', '.less', '.styl',
]);

// ─── Language Mapping ───────────────────────────────────────────────────────

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.pyw': 'Python',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.scala': 'Scala',
  '.rs': 'Rust',
  '.go': 'Go',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hxx': 'C++',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.r': 'R', '.R': 'R',
  '.m': 'Objective-C', '.mm': 'Objective-C',
  '.ex': 'Elixir', '.exs': 'Elixir',
  '.erl': 'Erlang', '.hrl': 'Erlang',
  '.hs': 'Haskell',
  '.clj': 'Clojure', '.cljs': 'Clojure',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
  '.html': 'HTML', '.htm': 'HTML',
  '.sql': 'SQL',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.ps1': 'PowerShell',
};

// ─── Categorization ─────────────────────────────────────────────────────────

/**
 * Determines the category of a file based on its name and extension.
 */
export function categorizeFile(fileName: string, filePath: string): FileCategory {
  // Check test patterns first (before source, since test files have source extensions)
  const lowerPath = filePath.toLowerCase();
  if (
    TEST_PATTERNS.some(p => p.test(fileName)) ||
    lowerPath.includes('/test/') ||
    lowerPath.includes('/tests/') ||
    lowerPath.includes('/__tests__/') ||
    lowerPath.startsWith('test/') ||
    lowerPath.startsWith('tests/') ||
    lowerPath.startsWith('__tests__/')
  ) {
    return 'test';
  }

  // Check config by filename
  if (CONFIG_FILENAMES.has(fileName)) {
    return 'config';
  }

  const ext = extname(fileName).toLowerCase();

  if (SOURCE_EXTENSIONS.has(ext)) return 'source';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  if (DOCUMENTATION_EXTENSIONS.has(ext)) return 'documentation';
  if (ASSET_EXTENSIONS.has(ext)) return 'asset';

  return 'unknown';
}

/**
 * Returns the programming language for a given file extension, or undefined.
 */
export function getLanguageForExtension(ext: string): string | undefined {
  return EXTENSION_TO_LANGUAGE[ext];
}

// ─── Line Counting ──────────────────────────────────────────────────────────

/**
 * Counts lines in a file. Returns 0 on read failure.
 */
async function countLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf-8');
    // Count newlines; empty file = 0 lines, file with content but no trailing newline = at least 1
    if (content.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') count++;
    }
    // If file doesn't end with newline, add 1 for the last line
    if (content[content.length - 1] !== '\n') count++;
    return count;
  } catch {
    return 0;
  }
}

// ─── Structure Analyzer ─────────────────────────────────────────────────────

export interface StructureAnalyzerOptions {
  maxDepth?: number;
  excludePaths?: string[];
}

export class StructureAnalyzer implements Analyzer<ProjectStructure> {
  readonly name = 'StructureAnalyzer';

  private maxDepth: number;
  private excludedDirs: Set<string>;
  private additionalExcludes: string[];

  constructor(options: StructureAnalyzerOptions = {}) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.excludedDirs = new Set(DEFAULT_EXCLUDED_DIRS);
    this.additionalExcludes = options.excludePaths ?? [];
    for (const p of this.additionalExcludes) {
      this.excludedDirs.add(p);
    }
  }

  async analyze(context: AnalysisContext): Promise<ProjectStructure> {
    const warnings: AnalysisWarning[] = [];
    const languageLines: Map<string, { lines: number; files: number }> = new Map();
    const categoryCounts: Record<FileCategory, number> = {
      source: 0,
      config: 0,
      test: 0,
      documentation: 0,
      asset: 0,
      unknown: 0,
    };
    let totalFiles = 0;
    let totalDirectories = 0;

    await context.reportProgress('Starting structure analysis', 0, 100);

    // Progress tracking state
    const progressState = {
      processedItems: 0,
      estimatedTotal: 100, // Initial estimate
      lastReportedProgress: 0,
    };

    const tree = await this.traverseDirectory(
      context.rootPath,
      context.rootPath,
      0,
      warnings,
      languageLines,
      categoryCounts,
      { files: (n) => { totalFiles = n; }, dirs: (n) => { totalDirectories = n; } },
      context.reportProgress,
      progressState,
    );

    // Compute final counts from traversal
    totalFiles = this.countFiles(tree);
    totalDirectories = this.countDirectories(tree);

    // Compute language distribution
    const languageDistribution = this.computeLanguageDistribution(languageLines);

    await context.reportProgress('Structure analysis complete', 100, 100);

    return {
      tree,
      statistics: {
        totalFiles,
        totalDirectories,
        categoryCounts,
        languageDistribution,
      },
      excludedPaths: [...this.excludedDirs],
      warnings,
    };
  }

  /**
   * Recursively traverses a directory, building the file tree.
   */
  private async traverseDirectory(
    dirPath: string,
    rootPath: string,
    depth: number,
    warnings: AnalysisWarning[],
    languageLines: Map<string, { lines: number; files: number }>,
    categoryCounts: Record<FileCategory, number>,
    _counters: { files: (n: number) => void; dirs: (n: number) => void },
    reportProgress: AnalysisContext['reportProgress'],
    progressState: { processedItems: number; estimatedTotal: number; lastReportedProgress: number },
  ): Promise<FileTreeNode> {
    const relPath = relative(rootPath, dirPath) || '.';
    const dirName = dirPath === rootPath ? '.' : dirPath.split('/').pop() ?? dirPath;

    const node: FileTreeNode = {
      path: relPath,
      name: dirName,
      type: 'directory',
      children: [],
    };

    // Depth limit reached
    if (depth >= this.maxDepth) {
      warnings.push({
        path: relPath,
        message: `Maximum traversal depth (${this.maxDepth}) reached`,
        severity: 'warning',
      });
      return node;
    }

    let entries: string[];
    try {
      const dirEntries = await readdir(dirPath);
      entries = dirEntries.sort();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push({
        path: relPath,
        message: `Cannot read directory: ${message}`,
        severity: 'warning',
      });
      return node;
    }

    if (depth === 0) {
      await reportProgress(`Scanning ${entries.length} entries in root`, 5, 100);
      // Update estimate based on root directory size
      progressState.estimatedTotal = Math.max(entries.length * 2, 100);
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const entryRelPath = relative(rootPath, fullPath);

      // Check exclusion
      if (this.excludedDirs.has(entry)) {
        continue;
      }

      let stats;
      try {
        stats = await lstat(fullPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push({
          path: entryRelPath,
          message: `Cannot stat entry: ${message}`,
          severity: 'warning',
        });
        continue;
      }

      // Update progress periodically (every 10 items or when progress increases by 5%)
      progressState.processedItems++;
      const currentProgress = Math.min(
        95,
        Math.floor((progressState.processedItems / progressState.estimatedTotal) * 90) + 5
      );
      
      if (
        currentProgress - progressState.lastReportedProgress >= 5 ||
        progressState.processedItems % 10 === 0
      ) {
        progressState.lastReportedProgress = currentProgress;
        await reportProgress(
          `Analyzing: ${entryRelPath}`,
          currentProgress,
          100
        );
      }

      if (stats.isSymbolicLink()) {
        // Record symlink but don't follow it
        node.children!.push({
          path: entryRelPath,
          name: entry,
          type: 'symlink',
          symlinkTarget: undefined, // We don't resolve the target
        });
        continue;
      }

      if (stats.isDirectory()) {
        const childNode = await this.traverseDirectory(
          fullPath,
          rootPath,
          depth + 1,
          warnings,
          languageLines,
          categoryCounts,
          _counters,
          reportProgress,
          progressState,
        );
        node.children!.push(childNode);
      } else if (stats.isFile()) {
        const ext = extname(entry).toLowerCase();
        const category = categorizeFile(entry, entryRelPath);
        categoryCounts[category]++;

        const fileNode: FileTreeNode = {
          path: entryRelPath,
          name: entry,
          type: 'file',
          size: stats.size,
          extension: ext || undefined,
          category,
        };
        node.children!.push(fileNode);

        // Track language lines for source files
        const language = getLanguageForExtension(ext);
        if (language && (category === 'source' || category === 'test')) {
          const lines = await countLines(fullPath);
          const existing = languageLines.get(language);
          if (existing) {
            existing.lines += lines;
            existing.files += 1;
          } else {
            languageLines.set(language, { lines, files: 1 });
          }
        }
      }
    }

    return node;
  }

  /**
   * Counts total files in the tree (recursive).
   */
  private countFiles(node: FileTreeNode): number {
    if (node.type === 'file') return 1;
    if (node.type === 'symlink') return 0;
    let count = 0;
    for (const child of node.children ?? []) {
      count += this.countFiles(child);
    }
    return count;
  }

  /**
   * Counts total directories in the tree (recursive), excluding the root.
   */
  private countDirectories(node: FileTreeNode): number {
    if (node.type !== 'directory') return 0;
    let count = 0;
    for (const child of node.children ?? []) {
      if (child.type === 'directory') {
        count += 1 + this.countDirectories(child);
      }
    }
    return count;
  }

  /**
   * Computes language distribution from collected line counts.
   */
  private computeLanguageDistribution(
    languageLines: Map<string, { lines: number; files: number }>,
  ): LanguageDistribution[] {
    const totalLines = [...languageLines.values()].reduce((sum, v) => sum + v.lines, 0);
    if (totalLines === 0) return [];

    const distribution: LanguageDistribution[] = [];
    for (const [language, { lines, files }] of languageLines) {
      distribution.push({
        language,
        lineCount: lines,
        percentage: Math.round((lines / totalLines) * 10000) / 100, // 2 decimal places
        fileCount: files,
      });
    }

    // Sort by line count descending
    distribution.sort((a, b) => b.lineCount - a.lineCount);
    return distribution;
  }
}
