/**
 * Configuration Manager for the Codebase Explorer Power.
 *
 * Handles loading, validating, and merging configuration from multiple sources:
 * - User Profile: global (~/.cartographer/) with fallback to project directory
 * - Team Conventions: project-level (.cartographer/team-conventions.yaml|json)
 * - Analysis Profile: project-level or inline parameter
 *
 * Merge order (highest priority first): Team > User > Defaults
 *
 * @module config/config-manager
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { UserProfile, TeamConventions, AnalysisProfile, ResolvedConfig } from '../types.js';
import { safeReadFile } from '../utils/file-system.js';
import {
  isProfileTooLarge,
  validateProfile,
  validateNestedProfile,
  UserProfileSchema,
  TeamConventionsSchema,
  AnalysisProfileSchema,
} from './schemas.js';
import {
  DEFAULT_USER_PROFILE,
  DEFAULT_TEAM_CONVENTIONS,
  DEFAULT_ANALYSIS_PROFILE,
} from './defaults.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIG_DIR = '.cartographer';
const USER_PROFILE_FILENAME = 'user-profile';
const TEAM_CONVENTIONS_FILENAME = 'team-conventions';
const ANALYSIS_PROFILE_FILENAME = 'analysis-profile';

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Attempts to load and parse a configuration file from multiple candidate paths.
 * Tries both .yaml and .json extensions for each base path.
 * Returns the parsed content and any warnings, or null if no file was found.
 */
async function loadConfigFile(
  basePaths: string[],
  filename: string,
): Promise<{ content: Record<string, unknown>; rawContent: string } | null> {
  const extensions = ['.yaml', '.json'];

  for (const basePath of basePaths) {
    for (const ext of extensions) {
      const filePath = join(basePath, CONFIG_DIR, `${filename}${ext}`);
      const result = await safeReadFile(filePath);

      if (result.isError) {
        continue;
      }

      const rawContent = result.value;

      if (ext === '.json') {
        const parsed = JSON.parse(rawContent);
        return { content: parsed, rawContent };
      } else {
        const parsed = parseYaml(rawContent);
        return { content: parsed ?? {}, rawContent };
      }
    }
  }

  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Loads the user profile from the global home directory or project fallback.
 *
 * Search order:
 * 1. ~/.cartographer/user-profile.yaml
 * 2. ~/.cartographer/user-profile.json
 * 3. <projectRoot>/.cartographer/user-profile.yaml
 * 4. <projectRoot>/.cartographer/user-profile.json
 *
 * Validates the profile against the schema and enforces the 64 KB size limit.
 */
export async function loadUserProfile(
  projectRoot: string,
): Promise<{ profile: UserProfile | null; warnings: string[] }> {
  const warnings: string[] = [];
  const globalPath = homedir();
  const searchPaths = [globalPath, projectRoot];

  let loaded: { content: Record<string, unknown>; rawContent: string } | null;
  try {
    loaded = await loadConfigFile(searchPaths, USER_PROFILE_FILENAME);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse user profile: ${message}`);
    return { profile: null, warnings };
  }

  if (!loaded) {
    return { profile: null, warnings };
  }

  // Check size limit
  if (isProfileTooLarge(loaded.rawContent)) {
    warnings.push('User profile exceeds 64 KB size limit and was rejected.');
    return { profile: null, warnings };
  }

  // Validate field-by-field
  const validation = validateProfile<Record<string, unknown>>(loaded.content, UserProfileSchema);

  if (validation.allInvalid) {
    for (const inv of validation.invalid) {
      const optionsHint = inv.validOptions
        ? ` (valid: ${inv.validOptions.join(', ')})`
        : '';
      warnings.push(`User profile field "${inv.field}" is invalid: ${inv.reason}${optionsHint}`);
    }
    return { profile: null, warnings };
  }

  // Report invalid fields that were ignored
  for (const inv of validation.invalid) {
    const optionsHint = inv.validOptions
      ? ` (valid: ${inv.validOptions.join(', ')})`
      : '';
    warnings.push(
      `User profile field "${inv.field}" ignored: ${inv.reason}${optionsHint}`,
    );
  }

  return { profile: validation.valid as UserProfile, warnings };
}

/**
 * Loads team conventions from the project directory.
 *
 * Search paths:
 * 1. <projectRoot>/.cartographer/team-conventions.yaml
 * 2. <projectRoot>/.cartographer/team-conventions.json
 *
 * Validates the conventions against the schema with nested field-by-field validation.
 */
export async function loadTeamConventions(
  projectRoot: string,
): Promise<{ conventions: TeamConventions | null; warnings: string[] }> {
  const warnings: string[] = [];

  let loaded: { content: Record<string, unknown>; rawContent: string } | null;
  try {
    loaded = await loadConfigFile([projectRoot], TEAM_CONVENTIONS_FILENAME);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse team conventions: ${message}`);
    return { conventions: null, warnings };
  }

  if (!loaded) {
    return { conventions: null, warnings };
  }

  // Validate with nested field-by-field validation
  const validation = validateNestedProfile<Record<string, unknown>>(
    loaded.content,
    TeamConventionsSchema,
  );

  if (validation.allInvalid) {
    for (const inv of validation.invalid) {
      const optionsHint = inv.validOptions
        ? ` (valid: ${inv.validOptions.join(', ')})`
        : '';
      warnings.push(
        `Team conventions field "${inv.field}" is invalid: ${inv.reason}${optionsHint}`,
      );
    }
    return { conventions: null, warnings };
  }

  // Report invalid fields that were ignored
  for (const inv of validation.invalid) {
    const optionsHint = inv.validOptions
      ? ` (valid: ${inv.validOptions.join(', ')})`
      : '';
    warnings.push(
      `Team conventions field "${inv.field}" ignored: ${inv.reason}${optionsHint}`,
    );
  }

  return { conventions: validation.valid as TeamConventions, warnings };
}

/**
 * Loads the analysis profile from the project directory or uses inline parameters.
 *
 * If an inline profile is provided, it takes precedence over file-based configuration.
 * The result is always a complete AnalysisProfile merged with defaults.
 *
 * Search paths (when no inline):
 * 1. <projectRoot>/.cartographer/analysis-profile.yaml
 * 2. <projectRoot>/.cartographer/analysis-profile.json
 */
export async function loadAnalysisProfile(
  projectRoot: string,
  inline?: Partial<AnalysisProfile>,
): Promise<{ profile: AnalysisProfile; warnings: string[] }> {
  const warnings: string[] = [];

  let loadedData: Partial<AnalysisProfile> = {};

  if (!inline) {
    // Try loading from file
    let loaded: { content: Record<string, unknown>; rawContent: string } | null;
    try {
      loaded = await loadConfigFile([projectRoot], ANALYSIS_PROFILE_FILENAME);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse analysis profile: ${message}`);
      loaded = null;
    }

    if (loaded) {
      const validation = validateProfile<Record<string, unknown>>(
        loaded.content,
        AnalysisProfileSchema,
      );

      for (const inv of validation.invalid) {
        const optionsHint = inv.validOptions
          ? ` (valid: ${inv.validOptions.join(', ')})`
          : '';
        warnings.push(
          `Analysis profile field "${inv.field}" ignored: ${inv.reason}${optionsHint}`,
        );
      }

      loadedData = validation.valid as Partial<AnalysisProfile>;
    }
  } else {
    // Validate inline profile
    const validation = validateProfile<Record<string, unknown>>(
      inline as Record<string, unknown>,
      AnalysisProfileSchema,
    );

    for (const inv of validation.invalid) {
      const optionsHint = inv.validOptions
        ? ` (valid: ${inv.validOptions.join(', ')})`
        : '';
      warnings.push(
        `Inline analysis profile field "${inv.field}" ignored: ${inv.reason}${optionsHint}`,
      );
    }

    loadedData = validation.valid as Partial<AnalysisProfile>;
  }

  // Merge with defaults
  const profile: AnalysisProfile = {
    focusAreas: loadedData.focusAreas ?? DEFAULT_ANALYSIS_PROFILE.focusAreas,
    excludePaths: loadedData.excludePaths ?? DEFAULT_ANALYSIS_PROFILE.excludePaths,
    maxDepth: loadedData.maxDepth ?? DEFAULT_ANALYSIS_PROFILE.maxDepth,
    includeCodeExamples: loadedData.includeCodeExamples ?? DEFAULT_ANALYSIS_PROFILE.includeCodeExamples,
  };

  return { profile, warnings };
}

/**
 * Resolves the full configuration by loading all sources and merging them.
 *
 * Merge order (highest priority first):
 * 1. Team Conventions
 * 2. User Profile
 * 3. Defaults
 *
 * Tracks which user profile fields were overridden by team conventions
 * and reports them in `overriddenFields`.
 */
export async function resolveConfig(
  projectRoot: string,
  inlineAnalysisProfile?: Partial<AnalysisProfile>,
): Promise<{ config: ResolvedConfig; warnings: string[] }> {
  const allWarnings: string[] = [];

  // Load all configuration sources
  const [userResult, teamResult, analysisResult] = await Promise.all([
    loadUserProfile(projectRoot),
    loadTeamConventions(projectRoot),
    loadAnalysisProfile(projectRoot, inlineAnalysisProfile),
  ]);

  allWarnings.push(...userResult.warnings);
  allWarnings.push(...teamResult.warnings);
  allWarnings.push(...analysisResult.warnings);

  // Merge user profile with defaults
  const mergedUserProfile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    ...(userResult.profile ?? {}),
  };

  // Merge team conventions with defaults
  const mergedTeamConventions: TeamConventions = mergeTeamConventions(
    DEFAULT_TEAM_CONVENTIONS,
    teamResult.conventions,
  );

  // Determine overridden fields (team overrides user)
  const overriddenFields = computeOverriddenFields(
    mergedUserProfile,
    mergedTeamConventions,
  );

  const config: ResolvedConfig = {
    userProfile: mergedUserProfile,
    teamConventions: mergedTeamConventions,
    analysisProfile: analysisResult.profile,
    overriddenFields,
  };

  return { config, warnings: allWarnings };
}

// ─── Merge Helpers ──────────────────────────────────────────────────────────

/**
 * Deep-merges team conventions with defaults.
 */
function mergeTeamConventions(
  defaults: TeamConventions,
  loaded: TeamConventions | null,
): TeamConventions {
  if (!loaded) {
    return {
      naming: { ...defaults.naming },
      formatting: { ...defaults.formatting },
      architecture: {
        allowedLayers: [...(defaults.architecture?.allowedLayers ?? [])],
        forbiddenDependencies: [...(defaults.architecture?.forbiddenDependencies ?? [])],
      },
      imports: {
        order: [...(defaults.imports?.order ?? [])],
        groupSeparator: defaults.imports?.groupSeparator ?? true,
      },
    };
  }

  return {
    naming: {
      ...defaults.naming,
      ...loaded.naming,
    },
    formatting: {
      ...defaults.formatting,
      ...loaded.formatting,
    },
    architecture: {
      allowedLayers: loaded.architecture?.allowedLayers ?? defaults.architecture?.allowedLayers ?? [],
      forbiddenDependencies: loaded.architecture?.forbiddenDependencies ?? defaults.architecture?.forbiddenDependencies ?? [],
    },
    imports: {
      order: loaded.imports?.order ?? defaults.imports?.order ?? [],
      groupSeparator: loaded.imports?.groupSeparator ?? defaults.imports?.groupSeparator ?? true,
    },
  };
}

/**
 * Computes which user profile fields are overridden by team conventions.
 *
 * A field is considered overridden when:
 * - The user has a naming preference AND the team has a corresponding naming convention
 *   that differs from the user's preference.
 */
function computeOverriddenFields(
  userProfile: UserProfile,
  teamConventions: TeamConventions,
): string[] {
  const overridden: string[] = [];

  // Check if team naming conventions override user naming preference
  if (userProfile.namingPreference && teamConventions.naming) {
    // Team file naming overrides user naming preference for files
    if (
      teamConventions.naming.files &&
      teamConventions.naming.files !== userProfile.namingPreference
    ) {
      overridden.push('namingPreference');
    }
  }

  return overridden;
}
