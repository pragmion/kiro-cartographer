/**
 * Default configuration values for the Codebase Explorer Power.
 *
 * These defaults are used as the lowest-priority layer in the configuration
 * resolution chain: Team Conventions > User Profile > Defaults.
 *
 * @module config/defaults
 */

import type { UserProfile, TeamConventions, AnalysisProfile, ResolvedConfig } from '../types.js';

// ─── User Profile Defaults ──────────────────────────────────────────────────

/**
 * Default user profile settings.
 *
 * - commentStyle: 'jsdoc' — standard JSDoc-style comments
 * - namingPreference: 'camelCase' — most common JS/TS convention
 * - preferredPatterns: [] — no pattern preference
 * - language: 'en' — English output language
 * - maxSkillCount: 10 — maximum generated skills per run
 */
export const DEFAULT_USER_PROFILE: Required<UserProfile> = {
  commentStyle: 'jsdoc',
  namingPreference: 'camelCase',
  preferredPatterns: [],
  language: 'en',
  maxSkillCount: 10,
};

// ─── Team Conventions Defaults ──────────────────────────────────────────────

/**
 * Default team conventions.
 *
 * Naming:
 * - files: 'kebab-case' — widely adopted for file naming
 * - variables: 'camelCase' — standard JS/TS convention
 * - classes: 'PascalCase' — standard class naming
 * - constants: 'UPPER_SNAKE_CASE' — standard constant naming
 *
 * Formatting:
 * - indentation: 'spaces' with size 2
 * - maxLineLength: 100 characters
 * - trailingComma: true — reduces diff noise
 * - semicolons: true — explicit statement termination
 *
 * Imports:
 * - order: builtin → external → internal → relative
 * - groupSeparator: true — blank line between groups
 */
export const DEFAULT_TEAM_CONVENTIONS: TeamConventions = {
  naming: {
    files: 'kebab-case',
    variables: 'camelCase',
    classes: 'PascalCase',
    constants: 'UPPER_SNAKE_CASE',
  },
  formatting: {
    indentation: 'spaces',
    indentSize: 2,
    maxLineLength: 100,
    trailingComma: true,
    semicolons: true,
  },
  architecture: {
    allowedLayers: [],
    forbiddenDependencies: [],
  },
  imports: {
    order: ['builtin', 'external', 'internal', 'relative'],
    groupSeparator: true,
  },
};

// ─── Analysis Profile Defaults ──────────────────────────────────────────────

/**
 * Default analysis profile.
 *
 * - focusAreas: [] — all areas analyzed at standard depth
 * - excludePaths: [] — only built-in exclusions apply
 * - maxDepth: 20 — maximum directory traversal depth
 * - includeCodeExamples: false — no code snippets in output by default
 */
export const DEFAULT_ANALYSIS_PROFILE: Required<AnalysisProfile> = {
  focusAreas: [],
  excludePaths: [],
  maxDepth: 20,
  includeCodeExamples: false,
};

// ─── Combined Default Config ────────────────────────────────────────────────

/**
 * Returns a fully resolved configuration using all default values.
 * This represents the baseline configuration when no user profile
 * or team conventions are provided.
 */
export function getDefaultConfig(): ResolvedConfig {
  return {
    userProfile: { ...DEFAULT_USER_PROFILE },
    teamConventions: {
      naming: { ...DEFAULT_TEAM_CONVENTIONS.naming },
      formatting: { ...DEFAULT_TEAM_CONVENTIONS.formatting },
      architecture: {
        allowedLayers: [...(DEFAULT_TEAM_CONVENTIONS.architecture?.allowedLayers ?? [])],
        forbiddenDependencies: [...(DEFAULT_TEAM_CONVENTIONS.architecture?.forbiddenDependencies ?? [])],
      },
      imports: {
        order: [...(DEFAULT_TEAM_CONVENTIONS.imports?.order ?? [])],
        groupSeparator: DEFAULT_TEAM_CONVENTIONS.imports?.groupSeparator ?? true,
      },
    },
    analysisProfile: {
      focusAreas: [...DEFAULT_ANALYSIS_PROFILE.focusAreas],
      excludePaths: [...(DEFAULT_ANALYSIS_PROFILE.excludePaths ?? [])],
      maxDepth: DEFAULT_ANALYSIS_PROFILE.maxDepth ?? 20,
      includeCodeExamples: DEFAULT_ANALYSIS_PROFILE.includeCodeExamples ?? false,
    },
    overriddenFields: [],
  };
}
