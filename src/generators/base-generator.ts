// Codebase Explorer Power - Base Generator Interface

import type {
  AnalyzeCodebaseOutput,
  ArtifactType,
  SteeringCategory,
  UserProfile,
  TeamConventions,
} from '../types.js';

/**
 * Resolved user profile with all fields populated (defaults applied).
 */
export type ResolvedUserProfile = Required<UserProfile>;

/**
 * Resolved team conventions with all fields populated (defaults applied).
 */
export type ResolvedTeamConventions = Required<TeamConventions>;

/**
 * Configuration passed to generators controlling what and how to generate.
 */
export interface GenerationConfig {
  userProfile: ResolvedUserProfile;
  teamConventions: ResolvedTeamConventions;
  artifactTypes: ArtifactType[];
  steeringCategories: SteeringCategory[];
}

/**
 * Base interface for all artifact generators.
 * Each generator produces output artifacts from analysis results.
 *
 * @template TInput - The type of input data this generator consumes.
 * @template TOutput - The type of output this generator produces.
 */
export interface ArtifactGenerator<TInput, TOutput> {
  /** Human-readable name of this generator. */
  name: string;

  /** Determine whether this generator can produce output from the given analysis. */
  canGenerate(analysis: AnalyzeCodebaseOutput): boolean;

  /** Generate artifacts from the input data using the provided configuration. */
  generate(input: TInput, config: GenerationConfig): Promise<TOutput>;
}
