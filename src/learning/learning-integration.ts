// Kiro Cartographer - Self-Improvement Integration
// Wraps @pragmion/kiro-learning to provide cartographer-specific learning helpers.

import { join } from 'node:path';
import { LearningEngine } from '@pragmion/kiro-learning';
import type {
  SkillCandidate,
  EnrichmentTarget,
  UsageStats,
  FeedbackEntry,
} from '@pragmion/kiro-learning';

/** Default location for the learning state file (relative to project root). */
const DEFAULT_STATE_FILE = '.cartographer/learning-state.json';

/** Threshold for marking artifacts as unused (no access in N days). */
const UNUSED_THRESHOLD_DAYS = 60;

/** Threshold for high-usage artifacts (≥ N accesses in last 30 days). */
const HIGH_USAGE_THRESHOLD = 5;

/**
 * Wrapper around the shared LearningEngine that provides
 * cartographer-specific helpers and integrates with the analysis/generation
 * pipeline.
 */
export class CartographerLearning {
  private readonly engine: LearningEngine;
  private loaded = false;

  constructor(rootPath: string, statePath?: string) {
    const path = statePath ?? join(rootPath, DEFAULT_STATE_FILE);
    this.engine = new LearningEngine({ statePath: path });
  }

  /** Loads the persisted learning state. Idempotent. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.engine.load();
    this.loaded = true;
  }

  /** Saves the learning state, applying auto-pruning. */
  async save(): Promise<void> {
    await this.engine.save();
  }

  // ─── Recording API ────────────────────────────────────────────────────────

  /**
   * Records a skill correction. Call when the user adjusts Kiro's output
   * after using a generated skill.
   */
  async recordSkillCorrection(skillName: string, correction: string): Promise<void> {
    await this.ensureLoaded();
    await this.engine.recordFeedback(skillName, correction);
  }

  /**
   * Records artifact usage. Call when an artifact (steering file or skill)
   * is loaded by Kiro.
   */
  async recordArtifactUsage(artifactPath: string): Promise<void> {
    await this.ensureLoaded();
    await this.engine.recordUsage(artifactPath);
  }

  /**
   * Records a recurring code pattern that no existing skill covers.
   * Used by analyzers to suggest new skills after enough occurrences.
   */
  async recordPattern(description: string, files: string[]): Promise<void> {
    if (files.length === 0) return; // Library validates this; guard early
    await this.ensureLoaded();
    await this.engine.recordPattern(description, files);
  }

  /**
   * Records a convention violation. Call when Kiro generates code that
   * doesn't match a documented steering file rule.
   */
  async recordConventionViolation(
    steeringFile: string,
    rule: string,
    example: string,
  ): Promise<void> {
    await this.ensureLoaded();
    await this.engine.recordConventionViolation(steeringFile, rule, example);
  }

  // ─── Query API ────────────────────────────────────────────────────────────

  /** Returns skill candidates (patterns with ≥ 3 occurrences). */
  async getSuggestedSkills(): Promise<SkillCandidate[]> {
    await this.ensureLoaded();
    return this.engine.getSuggestedSkills();
  }

  /** Returns steering files that need enrichment (≥ 3 violations per rule). */
  async getEnrichmentTargets(): Promise<EnrichmentTarget[]> {
    await this.ensureLoaded();
    return this.engine.getEnrichmentTargets();
  }

  /** Returns feedback entries for a specific skill. */
  async getFeedbackForSkill(skillName: string): Promise<FeedbackEntry[]> {
    await this.ensureLoaded();
    return this.engine.getFeedbackForSkill(skillName);
  }

  /** Returns usage statistics for all tracked artifacts. */
  async getUsageStats(): Promise<UsageStats[]> {
    await this.ensureLoaded();
    return this.engine.getUsageStats();
  }

  /**
   * Returns artifacts that haven't been accessed in UNUSED_THRESHOLD_DAYS days.
   * Useful for suggesting cleanup or consolidation.
   */
  async getUnusedArtifacts(): Promise<UsageStats[]> {
    const stats = await this.getUsageStats();
    const cutoff = Date.now() - UNUSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    return stats.filter(s => new Date(s.lastAccess).getTime() < cutoff);
  }

  /**
   * Returns artifacts with high usage (≥ HIGH_USAGE_THRESHOLD accesses).
   * These are good candidates for richer detail in regeneration.
   */
  async getHighUsageArtifacts(): Promise<UsageStats[]> {
    const stats = await this.getUsageStats();
    return stats.filter(s => s.totalAccesses >= HIGH_USAGE_THRESHOLD);
  }

  /**
   * Builds a learning-summary suitable for inclusion in analysis output.
   * Tools can surface this to the user as "what we learned since last run".
   */
  async getLearningSummary(): Promise<{
    suggestedSkills: SkillCandidate[];
    enrichmentTargets: EnrichmentTarget[];
    unusedArtifacts: UsageStats[];
    highUsageArtifacts: UsageStats[];
  }> {
    const [suggestedSkills, enrichmentTargets, unusedArtifacts, highUsageArtifacts] = await Promise.all([
      this.getSuggestedSkills(),
      this.getEnrichmentTargets(),
      this.getUnusedArtifacts(),
      this.getHighUsageArtifacts(),
    ]);
    return { suggestedSkills, enrichmentTargets, unusedArtifacts, highUsageArtifacts };
  }
}
