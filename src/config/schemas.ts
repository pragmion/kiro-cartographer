import { z } from 'zod';
import type { UserProfile, TeamConventions, AnalysisProfile } from '../types.js';

// ─── Valid Options (extractable for error messages) ─────────────────────────

export const VALID_OPTIONS = {
  commentStyle: ['jsdoc', 'inline', 'minimal', 'verbose'] as const,
  namingPreference: ['camelCase', 'snake_case', 'PascalCase', 'kebab-case'] as const,
  fileNaming: ['camelCase', 'kebab-case', 'PascalCase', 'snake_case'] as const,
  variableNaming: ['camelCase', 'snake_case'] as const,
  classNaming: ['PascalCase'] as const,
  constantNaming: ['UPPER_SNAKE_CASE'] as const,
  indentation: ['spaces', 'tabs'] as const,
  focusAreas: ['api', 'data-model', 'state-management', 'security', 'error-handling', 'build-pipeline'] as const,
} as const;

// ─── UserProfile Schema ─────────────────────────────────────────────────────

export const UserProfileSchema = z.object({
  commentStyle: z.enum(VALID_OPTIONS.commentStyle).optional(),
  namingPreference: z.enum(VALID_OPTIONS.namingPreference).optional(),
  preferredPatterns: z.array(z.string()).optional(),
  language: z.string().optional(),
  maxSkillCount: z.number().int().positive().optional(),
});

// ─── TeamConventions Schema ─────────────────────────────────────────────────

const NamingSchema = z.object({
  files: z.enum(VALID_OPTIONS.fileNaming).optional(),
  variables: z.enum(VALID_OPTIONS.variableNaming).optional(),
  classes: z.enum(VALID_OPTIONS.classNaming).optional(),
  constants: z.enum(VALID_OPTIONS.constantNaming).optional(),
});

const FormattingSchema = z.object({
  indentation: z.enum(VALID_OPTIONS.indentation).optional(),
  indentSize: z.number().int().positive().optional(),
  maxLineLength: z.number().int().positive().optional(),
  trailingComma: z.boolean().optional(),
  semicolons: z.boolean().optional(),
});

const ArchitectureSchema = z.object({
  allowedLayers: z.array(z.string()).optional(),
  forbiddenDependencies: z.array(z.object({
    from: z.string(),
    to: z.string(),
  })).optional(),
});

const ImportsSchema = z.object({
  order: z.array(z.string()).optional(),
  groupSeparator: z.boolean().optional(),
});

export const TeamConventionsSchema = z.object({
  naming: NamingSchema.optional(),
  formatting: FormattingSchema.optional(),
  architecture: ArchitectureSchema.optional(),
  imports: ImportsSchema.optional(),
});

// ─── AnalysisProfile Schema ─────────────────────────────────────────────────

export const AnalysisProfileSchema = z.object({
  focusAreas: z.array(z.enum(VALID_OPTIONS.focusAreas)),
  excludePaths: z.array(z.string()).optional(),
  maxDepth: z.number().int().positive().max(100).optional(),
  includeCodeExamples: z.boolean().optional(),
});

// ─── Field-by-Field Validation Types ────────────────────────────────────────

export interface InvalidField {
  field: string;
  value: unknown;
  validOptions?: readonly string[];
  reason: string;
}

export interface ValidationResult<T> {
  valid: Partial<T>;
  invalid: InvalidField[];
  allInvalid: boolean;
}

// ─── Field-by-Field Validation Helper ───────────────────────────────────────

/**
 * Validates a profile object field-by-field, accepting valid fields
 * and reporting invalid ones. This enables partial acceptance:
 * valid fields are applied while invalid ones fall back to defaults.
 */
export function validateProfile<T extends Record<string, unknown>>(
  data: Record<string, unknown>,
  schema: z.ZodObject<z.ZodRawShape>,
): ValidationResult<T> {
  const valid: Record<string, unknown> = {};
  const invalid: InvalidField[] = [];

  const shape = schema.shape;

  for (const [key, value] of Object.entries(data)) {
    if (!(key in shape)) {
      invalid.push({
        field: key,
        value,
        reason: `Unknown field "${key}"`,
      });
      continue;
    }

    const fieldSchema = shape[key];
    const result = fieldSchema.safeParse(value);

    if (result.success) {
      valid[key] = result.data;
    } else {
      const options = extractValidOptions(fieldSchema);
      invalid.push({
        field: key,
        value,
        validOptions: options.length > 0 ? options : undefined,
        reason: result.error.issues.map(i => i.message).join('; '),
      });
    }
  }

  return {
    valid: valid as Partial<T>,
    invalid,
    allInvalid: Object.keys(valid).length === 0 && invalid.length > 0,
  };
}

/**
 * Validates a nested profile (like TeamConventions) field-by-field at the
 * top-level section granularity. Each top-level key (naming, formatting, etc.)
 * is validated independently.
 */
export function validateNestedProfile<T extends Record<string, unknown>>(
  data: Record<string, unknown>,
  schema: z.ZodObject<z.ZodRawShape>,
): ValidationResult<T> {
  const valid: Record<string, unknown> = {};
  const invalid: InvalidField[] = [];

  const shape = schema.shape;

  for (const [key, value] of Object.entries(data)) {
    if (!(key in shape)) {
      invalid.push({
        field: key,
        value,
        reason: `Unknown field "${key}"`,
      });
      continue;
    }

    const fieldSchema = shape[key];
    const result = fieldSchema.safeParse(value);

    if (result.success) {
      valid[key] = result.data;
    } else {
      // For nested objects, validate sub-fields individually
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const innerSchema = unwrapOptional(fieldSchema);
        if (innerSchema instanceof z.ZodObject) {
          const innerResult = validateProfile(
            value as Record<string, unknown>,
            innerSchema,
          );
          if (Object.keys(innerResult.valid).length > 0) {
            valid[key] = innerResult.valid;
          }
          for (const inv of innerResult.invalid) {
            invalid.push({
              field: `${key}.${inv.field}`,
              value: inv.value,
              validOptions: inv.validOptions,
              reason: inv.reason,
            });
          }
          continue;
        }
      }

      const options = extractValidOptions(fieldSchema);
      invalid.push({
        field: key,
        value,
        validOptions: options.length > 0 ? options : undefined,
        reason: result.error.issues.map(i => i.message).join('; '),
      });
    }
  }

  return {
    valid: valid as Partial<T>,
    invalid,
    allInvalid: Object.keys(valid).length === 0 && invalid.length > 0,
  };
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Extracts valid options from a Zod schema (supports enums and optionals wrapping enums).
 */
export function extractValidOptions(schema: z.ZodTypeAny): readonly string[] {
  const unwrapped = unwrapOptional(schema);

  if (unwrapped instanceof z.ZodEnum) {
    return unwrapped.options as readonly string[];
  }

  if (unwrapped instanceof z.ZodArray) {
    const element = unwrapped.element;
    if (element instanceof z.ZodEnum) {
      return element.options as readonly string[];
    }
  }

  return [];
}

/**
 * Unwraps a ZodOptional to get the inner schema.
 */
function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return schema.unwrap();
  }
  return schema;
}

// ─── Profile Size Validation ────────────────────────────────────────────────

/** Maximum allowed profile file size in bytes (64 KB) */
export const MAX_PROFILE_SIZE_BYTES = 64 * 1024;

/**
 * Checks if a profile file content exceeds the maximum allowed size.
 */
export function isProfileTooLarge(content: string | Buffer): boolean {
  const size = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.length;
  return size > MAX_PROFILE_SIZE_BYTES;
}
