import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CartographerLearning } from '../../../src/learning/learning-integration.js';

describe('CartographerLearning', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'learning-integration-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('records skill corrections and retrieves them', async () => {
    const learning = new CartographerLearning(tempDir);
    await learning.recordSkillCorrection('create-api-endpoint', 'Use zod for validation');
    await learning.recordSkillCorrection('create-api-endpoint', 'Add error handler middleware');

    const feedback = await learning.getFeedbackForSkill('create-api-endpoint');
    expect(feedback).toHaveLength(2);
    expect(feedback[0].correction).toBe('Use zod for validation');
    expect(feedback[1].correction).toBe('Add error handler middleware');
  });

  it('records artifact usage and computes stats', async () => {
    const learning = new CartographerLearning(tempDir);
    await learning.recordArtifactUsage('.kiro/steering/coding-standards.md');
    await learning.recordArtifactUsage('.kiro/steering/coding-standards.md');
    await learning.recordArtifactUsage('.kiro/skills/api.md');

    const stats = await learning.getUsageStats();
    expect(stats).toHaveLength(2);

    const standardsStats = stats.find(s => s.artifactPath === '.kiro/steering/coding-standards.md');
    expect(standardsStats?.totalAccesses).toBe(2);
  });

  it('suggests skills after 3+ pattern occurrences', async () => {
    const learning = new CartographerLearning(tempDir);

    // Record same pattern 3 times with different files
    await learning.recordPattern('REST endpoint with auth', ['src/routes/users.ts']);
    await learning.recordPattern('REST endpoint with auth', ['src/routes/orders.ts']);
    await learning.recordPattern('REST endpoint with auth', ['src/routes/products.ts']);

    const candidates = await learning.getSuggestedSkills();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].description).toBe('REST endpoint with auth');
    expect(candidates[0].occurrences).toBe(3);
  });

  it('does not suggest skills with fewer than 3 occurrences', async () => {
    const learning = new CartographerLearning(tempDir);
    await learning.recordPattern('Rare pattern', ['src/foo.ts']);
    await learning.recordPattern('Rare pattern', ['src/bar.ts']);

    const candidates = await learning.getSuggestedSkills();
    expect(candidates).toHaveLength(0);
  });

  it('flags steering files for enrichment after 3+ violations', async () => {
    const learning = new CartographerLearning(tempDir);

    await learning.recordConventionViolation('.kiro/steering/naming.md', 'camelCase variables', 'const MyVar = 1');
    await learning.recordConventionViolation('.kiro/steering/naming.md', 'camelCase variables', 'let SomeName = 2');
    await learning.recordConventionViolation('.kiro/steering/naming.md', 'camelCase variables', 'var Other_Var = 3');

    const targets = await learning.getEnrichmentTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].steeringFile).toBe('.kiro/steering/naming.md');
    expect(targets[0].rules[0].rule).toBe('camelCase variables');
    expect(targets[0].rules[0].occurrences).toBe(3);
  });

  it('persists state across instances', async () => {
    const first = new CartographerLearning(tempDir);
    await first.recordSkillCorrection('test-skill', 'Do X instead of Y');
    await first.save();

    const second = new CartographerLearning(tempDir);
    const feedback = await second.getFeedbackForSkill('test-skill');
    expect(feedback).toHaveLength(1);
    expect(feedback[0].correction).toBe('Do X instead of Y');
  });

  it('aggregates a complete learning summary', async () => {
    const learning = new CartographerLearning(tempDir);

    await learning.recordPattern('Repeated pattern', ['a.ts']);
    await learning.recordPattern('Repeated pattern', ['b.ts']);
    await learning.recordPattern('Repeated pattern', ['c.ts']);
    await learning.recordArtifactUsage('.kiro/steering/build.md');

    const summary = await learning.getLearningSummary();
    expect(summary.suggestedSkills.length).toBeGreaterThan(0);
    expect(summary.enrichmentTargets).toEqual([]);
    expect(summary.unusedArtifacts).toEqual([]);
    expect(summary.highUsageArtifacts).toEqual([]);
  });

  it('ignores empty files array in recordPattern (no-op)', async () => {
    const learning = new CartographerLearning(tempDir);
    // Should not throw — internal validation happens in the engine, but the
    // wrapper guards early to avoid unnecessary load.
    await expect(learning.recordPattern('test', [])).resolves.toBeUndefined();
    const candidates = await learning.getSuggestedSkills();
    expect(candidates).toHaveLength(0);
  });
});
