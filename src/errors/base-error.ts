/**
 * Error hierarchy for the Codebase Explorer Power.
 *
 * Categories:
 * - filesystem: Unreadable directories, locked files
 * - parse: Invalid JSON/YAML configuration
 * - validation: Invalid tool parameters, invalid profiles
 * - timeout: Analysis exceeds time limit
 * - internal: Unexpected runtime exceptions
 */

export type ErrorCategory =
  | 'filesystem'
  | 'parse'
  | 'validation'
  | 'timeout'
  | 'internal';

/**
 * Abstract base class for all Codebase Explorer errors.
 */
export abstract class CodebaseExplorerError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  readonly timestamp: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.context = context;
  }
}

/**
 * Thrown when a file system operation fails (e.g., directory not readable, file locked).
 * Strategy: Warning in result, analysis continues.
 */
export class FileSystemError extends CodebaseExplorerError {
  readonly code = 'FS_ERROR' as const;
  readonly category = 'filesystem' as const;
  readonly path: string;

  constructor(message: string, path: string, context?: Record<string, unknown>) {
    super(message, context);
    this.path = path;
  }
}

/**
 * Thrown when input validation fails (e.g., invalid tool parameters, invalid profile).
 * Strategy: Structured error response with details, fail-fast before analysis begins.
 */
export class ValidationError extends CodebaseExplorerError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly category = 'validation' as const;
  readonly invalidFields: { field: string; value: unknown; validOptions: string[] }[];

  constructor(
    message: string,
    invalidFields: { field: string; value: unknown; validOptions: string[] }[],
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.invalidFields = invalidFields;
  }
}

/**
 * Thrown when parsing a configuration or source file fails (e.g., invalid JSON/YAML).
 * Strategy: Error message with line/column, abort processing of the affected file.
 */
export class ParseError extends CodebaseExplorerError {
  readonly code = 'PARSE_ERROR' as const;
  readonly category = 'parse' as const;
  readonly filePath: string;
  readonly line?: number;
  readonly column?: number;

  constructor(
    message: string,
    filePath: string,
    options?: { line?: number; column?: number; context?: Record<string, unknown> },
  ) {
    super(message, options?.context);
    this.filePath = filePath;
    this.line = options?.line;
    this.column = options?.column;
  }
}

/**
 * Thrown when analysis exceeds the configured timeout.
 * Strategy: Abort with partial result after configurable timeout.
 */
export class AnalysisTimeoutError extends CodebaseExplorerError {
  readonly code = 'TIMEOUT_ERROR' as const;
  readonly category = 'timeout' as const;
  readonly partialResult?: Record<string, unknown>;

  constructor(
    message: string,
    partialResult?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.partialResult = partialResult;
  }
}

// ---------------------------------------------------------------------------
// MCP Error Response formatting
// ---------------------------------------------------------------------------

/**
 * Structured MCP error response format.
 * Used to return errors to the MCP client in a standardized way.
 */
export interface McpErrorResponse {
  content: [{ type: 'text'; text: string }];
  isError: true;
  _meta?: {
    errorCode: string;
    toolName: string;
    invalidParams?: { name: string; reason: string; expected: string }[];
    availableTools?: string[];
  };
}

/**
 * Formats a CodebaseExplorerError into an MCP-compatible error response.
 */
export function formatMcpError(
  error: CodebaseExplorerError,
  toolName: string,
): McpErrorResponse {
  const response: McpErrorResponse = {
    content: [{ type: 'text', text: error.message }],
    isError: true,
    _meta: {
      errorCode: error.code,
      toolName,
    },
  };

  if (error instanceof ValidationError && response._meta) {
    response._meta.invalidParams = error.invalidFields.map((f) => ({
      name: f.field,
      reason: `Invalid value: ${JSON.stringify(f.value)}`,
      expected: f.validOptions.join(' | '),
    }));
  }

  return response;
}

/**
 * Creates an MCP error response for an unknown tool name.
 */
export function formatUnknownToolError(
  unknownToolName: string,
  availableTools: string[],
): McpErrorResponse {
  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: "${unknownToolName}". Available tools: ${availableTools.join(', ')}`,
      },
    ],
    isError: true,
    _meta: {
      errorCode: 'UNKNOWN_TOOL',
      toolName: unknownToolName,
      availableTools,
    },
  };
}
