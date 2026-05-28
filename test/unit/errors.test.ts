import { describe, it, expect } from 'vitest';
import {
  CodebaseExplorerError,
  FileSystemError,
  ValidationError,
  ParseError,
  AnalysisTimeoutError,
  formatMcpError,
  formatUnknownToolError,
} from '../../src/errors/index.js';

describe('Error Hierarchy', () => {
  describe('FileSystemError', () => {
    it('should set code, category, and path', () => {
      const err = new FileSystemError('Cannot read directory', '/some/path');
      expect(err.code).toBe('FS_ERROR');
      expect(err.category).toBe('filesystem');
      expect(err.path).toBe('/some/path');
      expect(err.message).toBe('Cannot read directory');
      expect(err.name).toBe('FileSystemError');
    });

    it('should be an instance of CodebaseExplorerError and Error', () => {
      const err = new FileSystemError('fail', '/p');
      expect(err).toBeInstanceOf(CodebaseExplorerError);
      expect(err).toBeInstanceOf(Error);
    });

    it('should include timestamp and optional context', () => {
      const err = new FileSystemError('fail', '/p', { operation: 'readdir' });
      expect(err.timestamp).toBeDefined();
      expect(new Date(err.timestamp).getTime()).not.toBeNaN();
      expect(err.context).toEqual({ operation: 'readdir' });
    });
  });

  describe('ValidationError', () => {
    it('should set code, category, and invalidFields', () => {
      const fields = [
        { field: 'maxDepth', value: -1, validOptions: ['1-100'] },
      ];
      const err = new ValidationError('Invalid parameters', fields);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.category).toBe('validation');
      expect(err.invalidFields).toEqual(fields);
      expect(err.name).toBe('ValidationError');
    });

    it('should be an instance of CodebaseExplorerError', () => {
      const err = new ValidationError('bad', []);
      expect(err).toBeInstanceOf(CodebaseExplorerError);
    });
  });

  describe('ParseError', () => {
    it('should set code, category, filePath, line, and column', () => {
      const err = new ParseError('Unexpected token', '/config.yaml', {
        line: 10,
        column: 5,
      });
      expect(err.code).toBe('PARSE_ERROR');
      expect(err.category).toBe('parse');
      expect(err.filePath).toBe('/config.yaml');
      expect(err.line).toBe(10);
      expect(err.column).toBe(5);
      expect(err.name).toBe('ParseError');
    });

    it('should allow optional line and column', () => {
      const err = new ParseError('Bad format', '/file.json');
      expect(err.line).toBeUndefined();
      expect(err.column).toBeUndefined();
    });
  });

  describe('AnalysisTimeoutError', () => {
    it('should set code, category, and optional partialResult', () => {
      const partial = { structure: { totalFiles: 42 } };
      const err = new AnalysisTimeoutError('Timeout after 30s', partial);
      expect(err.code).toBe('TIMEOUT_ERROR');
      expect(err.category).toBe('timeout');
      expect(err.partialResult).toEqual(partial);
      expect(err.name).toBe('AnalysisTimeoutError');
    });

    it('should allow no partialResult', () => {
      const err = new AnalysisTimeoutError('Timeout');
      expect(err.partialResult).toBeUndefined();
    });
  });
});

describe('MCP Error Response Formatting', () => {
  describe('formatMcpError', () => {
    it('should format a basic error', () => {
      const err = new FileSystemError('Cannot read', '/dir');
      const response = formatMcpError(err, 'analyze_codebase');

      expect(response.isError).toBe(true);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('Cannot read');
      expect(response._meta?.errorCode).toBe('FS_ERROR');
      expect(response._meta?.toolName).toBe('analyze_codebase');
    });

    it('should include invalidParams for ValidationError', () => {
      const fields = [
        { field: 'focusAreas', value: 'invalid', validOptions: ['api', 'data-model', 'security'] },
      ];
      const err = new ValidationError('Invalid input', fields);
      const response = formatMcpError(err, 'configure_profile');

      expect(response._meta?.invalidParams).toHaveLength(1);
      expect(response._meta?.invalidParams?.[0].name).toBe('focusAreas');
      expect(response._meta?.invalidParams?.[0].expected).toBe('api | data-model | security');
    });
  });

  describe('formatUnknownToolError', () => {
    it('should include unknown tool name and available tools', () => {
      const response = formatUnknownToolError('unknown_tool', [
        'analyze_codebase',
        'generate_artifacts',
        'configure_profile',
      ]);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('unknown_tool');
      expect(response.content[0].text).toContain('analyze_codebase');
      expect(response._meta?.errorCode).toBe('UNKNOWN_TOOL');
      expect(response._meta?.toolName).toBe('unknown_tool');
      expect(response._meta?.availableTools).toEqual([
        'analyze_codebase',
        'generate_artifacts',
        'configure_profile',
      ]);
    });
  });
});
