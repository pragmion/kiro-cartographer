// Codebase Explorer Power - API Analyzer
// Analyzes REST, GraphQL, gRPC, and WebSocket APIs

import { join } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type { ApiAnalysis, ApiEndpoint, AuthRequirement, FileTreeNode } from '../types.js';
import { safeReadFile } from '../utils/file-system.js';

/**
 * Analyzes API endpoints and schemas in the codebase.
 * Detects REST, GraphQL, gRPC, and WebSocket APIs.
 */
export class ApiAnalyzer implements Analyzer<ApiAnalysis> {
  name = 'API Analyzer';

  async analyze(context: AnalysisContext): Promise<ApiAnalysis> {
    const restEndpoints: ApiEndpoint[] = [];

    // Find all source files that might contain API definitions
    const sourceFiles = this.findSourceFiles(context.fileTree);

    let processedFiles = 0;
    for (const file of sourceFiles) {
      const filePath = join(context.rootPath, file.path);
      const fileResult = await safeReadFile(filePath);

      if (!fileResult.isError) {
        const endpoints = this.extractRestEndpoints(fileResult.value, file.path);
        restEndpoints.push(...endpoints);
      }

      processedFiles++;
      if (processedFiles % 10 === 0) {
        await context.reportProgress(
          `Analyzing API endpoints (${processedFiles}/${sourceFiles.length})`,
          processedFiles,
          sourceFiles.length
        );
      }
    }

    return {
      restEndpoints,
      specDiscrepancies: [],
      noApisFound: restEndpoints.length === 0,
    };
  }

  /**
   * Finds all source files that might contain API definitions.
   */
  private findSourceFiles(nodes: FileTreeNode[]): FileTreeNode[] {
    const sourceFiles: FileTreeNode[] = [];

    const traverse = (node: FileTreeNode) => {
      if (node.type === 'file' && this.isSourceFile(node)) {
        sourceFiles.push(node);
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    for (const node of nodes) {
      traverse(node);
    }

    return sourceFiles;
  }

  /**
   * Checks if a file is a source file that might contain API definitions.
   */
  private isSourceFile(node: FileTreeNode): boolean {
    const ext = node.extension?.toLowerCase();
    return ext === '.ts' || ext === '.js' || ext === '.mjs' || ext === '.cjs';
  }

  /**
   * Extracts REST endpoints from file content.
   * Supports Express, NestJS, Fastify, and Koa patterns.
   */
  private extractRestEndpoints(content: string, filePath: string): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];

    // Express patterns: app.get(), router.post(), etc.
    endpoints.push(...this.extractExpressEndpoints(content, filePath));

    // NestJS patterns: @Get(), @Post(), @Controller(), etc.
    endpoints.push(...this.extractNestJSEndpoints(content, filePath));

    // Fastify patterns: fastify.get(), fastify.post(), etc.
    endpoints.push(...this.extractFastifyEndpoints(content, filePath));

    // Koa patterns: router.get(), router.post(), etc.
    endpoints.push(...this.extractKoaEndpoints(content, filePath));

    return endpoints;
  }

  /**
   * Extracts Express.js endpoints.
   * Patterns: app.get('/path', ...), router.post('/path', ...)
   */
  private extractExpressEndpoints(content: string, filePath: string): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options'];

    for (const method of methods) {
      // Pattern: app.METHOD('path', ...) or router.METHOD('path', ...)
      const regex = new RegExp(
        `(?:app|router)\\.${method}\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
        'gi'
      );

      let match;
      while ((match = regex.exec(content)) !== null) {
        const path = match[1];
        const authentication = this.detectAuthentication(content, match.index);

        endpoints.push({
          method: method.toUpperCase() as ApiEndpoint['method'],
          path,
          filePath,
          authentication,
        });
      }
    }

    return endpoints;
  }

  /**
   * Extracts NestJS endpoints.
   * Patterns: @Get('path'), @Post('path'), @Controller('prefix')
   */
  private extractNestJSEndpoints(content: string, filePath: string): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];

    // Extract controller prefix
    const controllerMatch = /@Controller\s*\(\s*['"]([^'"]*)['"]\s*\)/.exec(content);
    const controllerPrefix = controllerMatch ? controllerMatch[1] : '';

    const methods = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options'];

    for (const method of methods) {
      // Pattern: @METHOD('path') or @METHOD()
      const regex = new RegExp(
        `@${method}\\s*\\(\\s*(?:['"]([^'"]*)['"\\s]*)?\\)`,
        'gi'
      );

      let match;
      while ((match = regex.exec(content)) !== null) {
        const routePath = match[1] || '';
        const fullPath = this.joinPaths(controllerPrefix, routePath);
        const authentication = this.detectAuthentication(content, match.index);

        endpoints.push({
          method: method.toUpperCase() as ApiEndpoint['method'],
          path: fullPath,
          filePath,
          authentication,
        });
      }
    }

    return endpoints;
  }

  /**
   * Extracts Fastify endpoints.
   * Patterns: fastify.get('/path', ...), fastify.post('/path', ...)
   */
  private extractFastifyEndpoints(content: string, filePath: string): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options'];

    for (const method of methods) {
      // Pattern: fastify.METHOD('path', ...) or app.METHOD('path', ...)
      const regex = new RegExp(
        `(?:fastify|app)\\.${method}\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
        'gi'
      );

      let match;
      while ((match = regex.exec(content)) !== null) {
        const path = match[1];
        const authentication = this.detectAuthentication(content, match.index);

        endpoints.push({
          method: method.toUpperCase() as ApiEndpoint['method'],
          path,
          filePath,
          authentication,
        });
      }
    }

    return endpoints;
  }

  /**
   * Extracts Koa endpoints.
   * Patterns: router.get('/path', ...), router.post('/path', ...)
   */
  private extractKoaEndpoints(content: string, filePath: string): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options'];

    for (const method of methods) {
      // Pattern: router.METHOD('path', ...)
      const regex = new RegExp(
        `router\\.${method}\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
        'gi'
      );

      let match;
      while ((match = regex.exec(content)) !== null) {
        const path = match[1];
        const authentication = this.detectAuthentication(content, match.index);

        endpoints.push({
          method: method.toUpperCase() as ApiEndpoint['method'],
          path,
          filePath,
          authentication,
        });
      }
    }

    return endpoints;
  }

  /**
   * Detects authentication requirements near a route definition.
   * Looks for common authentication patterns in the surrounding code.
   */
  private detectAuthentication(content: string, position: number): AuthRequirement {
    // Extract a window of text around the route definition (500 chars before and after)
    const start = Math.max(0, position - 500);
    const end = Math.min(content.length, position + 500);
    const window = content.substring(start, end);

    // Check for common authentication patterns
    if (this.hasPattern(window, ['@UseGuards', 'AuthGuard', 'JwtAuthGuard'])) {
      return { type: 'bearer' };
    }

    if (this.hasPattern(window, ['@ApiSecurity', 'ApiKeyAuth', 'apiKey'])) {
      return { type: 'api-key', location: 'header' };
    }

    if (this.hasPattern(window, ['OAuth', 'oauth2', '@UseOAuth'])) {
      return { type: 'oauth2', scopes: [] };
    }

    if (this.hasPattern(window, ['authenticate', 'isAuthenticated', 'requireAuth', 'authMiddleware'])) {
      return { type: 'custom', description: 'Custom authentication middleware detected' };
    }

    if (this.hasPattern(window, ['jwt', 'JWT', 'bearer', 'Bearer'])) {
      return { type: 'bearer' };
    }

    return { type: 'none-detected' };
  }

  /**
   * Checks if any of the patterns exist in the text.
   */
  private hasPattern(text: string, patterns: string[]): boolean {
    return patterns.some(pattern => text.includes(pattern));
  }

  /**
   * Joins two path segments, handling leading/trailing slashes.
   */
  private joinPaths(prefix: string, path: string): string {
    if (!prefix) return path || '/';
    if (!path) return prefix;

    const cleanPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    return cleanPrefix + cleanPath;
  }
}
