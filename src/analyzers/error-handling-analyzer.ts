// Codebase Explorer Power - Error Handling Analyzer
// Detects error handling patterns, hierarchies, and logging strategies.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type {
  FileTreeNode,
  ErrorHandlingAnalysis,
  ErrorPattern,
  ErrorHierarchy,
  LoggingStrategy,
} from '../types.js';

// ─── Detection Patterns ─────────────────────────────────────────────────────

const TRY_CATCH_REGEX = /try\s*\{/g;
const RESULT_TYPE_PATTERNS = [
  /from\s+['"](?:fp-ts|neverthrow|oxide\.ts|true-myth)['"]/,
  /Result<|Either<|Ok\(|Err\(|right\(|left\(/,
];
const ERROR_BOUNDARY_PATTERNS = [
  /class\s+\w+\s+extends\s+(?:React\.)?Component[^{]*\{[^}]*componentDidCatch/s,
  /ErrorBoundary/,
];
const GLOBAL_HANDLER_PATTERNS = [
  /process\.on\s*\(\s*['"]uncaughtException['"]/,
  /process\.on\s*\(\s*['"]unhandledRejection['"]/,
  /app\.use\s*\([^)]*err[^)]*\)/,
  /\.setGlobalPrefix|GlobalExceptionFilter|@Catch\(\)/,
  /window\.onerror|window\.addEventListener\s*\(\s*['"]error['"]/,
];

const RETRY_PATTERNS = /retry|retries|maxRetries|backoff|exponentialBackoff/i;
const FALLBACK_PATTERNS = /fallback|default[Vv]alue|getOrElse|orElse|unwrapOr/i;
const PROPAGATION_PATTERNS = /throw\s+|rethrow|throw\s+err|throw\s+error/i;
const LOGGING_PATTERNS = /console\.(error|warn|log|info|debug)|logger\.|log\.(error|warn|info|debug|fatal)/i;

// Error class detection
const ERROR_CLASS_REGEX = /class\s+(\w+(?:Error|Exception))\s+extends\s+(\w+)/g;

// Logging framework detection
const LOG_LEVEL_PATTERNS = {
  debug: /\.debug\s*\(|log\.debug|logger\.debug|LOG\.debug/,
  info: /\.info\s*\(|log\.info|logger\.info|LOG\.info/,
  warn: /\.warn\s*\(|log\.warn|logger\.warn|LOG\.warn|console\.warn/,
  error: /\.error\s*\(|log\.error|logger\.error|LOG\.error|console\.error/,
  fatal: /\.fatal\s*\(|log\.fatal|logger\.fatal|LOG\.fatal/,
};

// ─── Error Handling Analyzer ────────────────────────────────────────────────

export class ErrorHandlingAnalyzer implements Analyzer<ErrorHandlingAnalysis> {
  readonly name = 'ErrorHandlingAnalyzer';

  async analyze(context: AnalysisContext): Promise<ErrorHandlingAnalysis> {
    await context.reportProgress('Starting error handling analysis', 0, 100);

    const filePaths = this.collectFiles(context.fileTree, '');
    const sourceFiles = filePaths.filter(fp =>
      /\.[tj]sx?$/.test(fp) && !fp.includes('.test.') && !fp.includes('.spec.')
    );

    const patterns: ErrorPattern[] = [];
    const hierarchy: ErrorHierarchy[] = [];
    const detectedLevels = new Set<string>();
    const categoryMapping: Record<string, string> = {};

    await context.reportProgress('Scanning for error patterns', 20, 100);

    const tryCatchFiles: string[] = [];
    const resultTypeFiles: string[] = [];
    const errorBoundaryFiles: string[] = [];
    const globalHandlerFiles: string[] = [];

    for (const filePath of sourceFiles.slice(0, 300)) {
      const fullPath = join(context.rootPath, filePath);
      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      // Detect try-catch
      if (TRY_CATCH_REGEX.test(content)) {
        TRY_CATCH_REGEX.lastIndex = 0;
        tryCatchFiles.push(filePath);
      }

      // Detect result types
      if (RESULT_TYPE_PATTERNS.some(p => p.test(content))) {
        resultTypeFiles.push(filePath);
      }

      // Detect error boundaries
      if (ERROR_BOUNDARY_PATTERNS.some(p => p.test(content))) {
        errorBoundaryFiles.push(filePath);
      }

      // Detect global handlers
      if (GLOBAL_HANDLER_PATTERNS.some(p => p.test(content))) {
        globalHandlerFiles.push(filePath);
      }

      // Extract error class hierarchy
      let classMatch: RegExpExecArray | null;
      const classRegex = new RegExp(ERROR_CLASS_REGEX.source, ERROR_CLASS_REGEX.flags);
      while ((classMatch = classRegex.exec(content)) !== null) {
        hierarchy.push({
          name: classMatch[1],
          parent: classMatch[2],
          filePath,
          usageContext: this.inferUsageContext(classMatch[1]),
        });
      }

      // Detect log levels
      for (const [level, pattern] of Object.entries(LOG_LEVEL_PATTERNS)) {
        if (pattern.test(content)) {
          detectedLevels.add(level);
        }
      }

      // Map error categories to log levels
      this.mapErrorCategoriesToLogLevels(content, categoryMapping);
    }

    // Build patterns
    if (tryCatchFiles.length > 0) {
      const strategy = await this.inferStrategy(tryCatchFiles, context.rootPath);
      patterns.push({
        type: 'try-catch',
        strategy,
        files: tryCatchFiles.slice(0, 20),
        description: `Try-catch blocks found in ${tryCatchFiles.length} files`,
      });
    }

    if (resultTypeFiles.length > 0) {
      patterns.push({
        type: 'result-type',
        strategy: 'propagation',
        files: resultTypeFiles.slice(0, 20),
        description: `Result/Either types used in ${resultTypeFiles.length} files`,
      });
    }

    if (errorBoundaryFiles.length > 0) {
      patterns.push({
        type: 'error-boundary',
        strategy: 'fallback',
        files: errorBoundaryFiles.slice(0, 20),
        description: `Error boundaries found in ${errorBoundaryFiles.length} files`,
      });
    }

    if (globalHandlerFiles.length > 0) {
      patterns.push({
        type: 'global-handler',
        strategy: 'logging',
        files: globalHandlerFiles.slice(0, 20),
        description: `Global error handlers found in ${globalHandlerFiles.length} files`,
      });
    }

    // Build logging strategy
    const loggingStrategy: LoggingStrategy = {
      levels: [...detectedLevels].sort(),
      categoryMapping,
    };

    await context.reportProgress('Error handling analysis complete', 100, 100);

    return {
      patterns,
      hierarchy,
      loggingStrategy,
      noPatternsFound: patterns.length === 0,
    };
  }

  /**
   * Maps error categories to log levels based on code patterns.
   */
  private mapErrorCategoriesToLogLevels(content: string, categoryMapping: Record<string, string>): void {
    // Look for patterns like: logger.error('ValidationError: ...') or log.warn('Timeout')
    const errorLogPatterns = [
      { category: 'ValidationError', pattern: /(?:logger|log|console)\.(?:error|warn)\s*\([^)]*validation/i },
      { category: 'NotFoundError', pattern: /(?:logger|log|console)\.(?:error|warn)\s*\([^)]*not\s*found/i },
      { category: 'AuthError', pattern: /(?:logger|log|console)\.(?:error|warn)\s*\([^)]*auth/i },
      { category: 'TimeoutError', pattern: /(?:logger|log|console)\.(?:error|warn)\s*\([^)]*timeout/i },
      { category: 'NetworkError', pattern: /(?:logger|log|console)\.(?:error|warn)\s*\([^)]*(?:network|http|fetch)/i },
      { category: 'DatabaseError', pattern: /(?:logger|log|console)\.(?:error|warn)\s*\([^)]*(?:database|db|sql)/i },
    ];

    for (const { category, pattern } of errorLogPatterns) {
      const match = content.match(pattern);
      if (match) {
        // Extract log level from the match
        const levelMatch = match[0].match(/\.(error|warn|info|debug|fatal)/);
        if (levelMatch && !categoryMapping[category]) {
          categoryMapping[category] = levelMatch[1];
        }
      }
    }
  }

  /**
   * Infers the dominant error handling strategy from try-catch files.
   */
  private async inferStrategy(
    tryCatchFiles: string[],
    rootPath: string,
  ): Promise<'propagation' | 'retry' | 'fallback' | 'logging'> {
    const strategyCounts = {
      retry: 0,
      fallback: 0,
      propagation: 0,
      logging: 0,
    };

    // Sample up to 20 files to determine strategy
    const samplesToCheck = tryCatchFiles.slice(0, 20);

    for (const filePath of samplesToCheck) {
      const fullPath = join(rootPath, filePath);
      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      if (RETRY_PATTERNS.test(content)) strategyCounts.retry++;
      if (FALLBACK_PATTERNS.test(content)) strategyCounts.fallback++;
      if (PROPAGATION_PATTERNS.test(content)) strategyCounts.propagation++;
      if (LOGGING_PATTERNS.test(content)) strategyCounts.logging++;
    }

    // Return the most common strategy
    const entries = Object.entries(strategyCounts) as Array<[keyof typeof strategyCounts, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    
    return entries[0][1] > 0 ? entries[0][0] : 'logging';
  }

  /**
   * Infers usage context from error class name.
   */
  private inferUsageContext(className: string): string {
    const lower = className.toLowerCase();
    if (lower.includes('validation')) return 'Input validation';
    if (lower.includes('notfound') || lower.includes('not_found')) return 'Resource not found';
    if (lower.includes('auth')) return 'Authentication/Authorization';
    if (lower.includes('timeout')) return 'Operation timeout';
    if (lower.includes('network') || lower.includes('http')) return 'Network communication';
    if (lower.includes('database') || lower.includes('db')) return 'Database operations';
    if (lower.includes('parse') || lower.includes('syntax')) return 'Data parsing';
    if (lower.includes('config')) return 'Configuration';
    return 'General error handling';
  }

  private collectFiles(nodes: FileTreeNode[], prefix: string): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
      const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'file') {
        paths.push(nodePath);
      } else if (node.type === 'directory' && node.children) {
        paths.push(...this.collectFiles(node.children, nodePath));
      }
    }
    return paths;
  }
}
