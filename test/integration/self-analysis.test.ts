// End-to-End Self-Test: Cartographer analyzes itself.
//
// Strategy: Run the full analysis pipeline on the project root and verify
// that the output makes sense. This is a self-validating test — if the
// cartographer produces sensible analysis of its own code, it works.
//
// Output is written to a temp directory to avoid polluting the workspace.

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { runAnalysis, runGeneration } from '../../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

describe('Self-Analysis (End-to-End)', () => {
  let workdir: string;
  let analysisResult: Awaited<ReturnType<typeof runAnalysis>>['result'];

  beforeAll(async () => {
    // Create a copy of the source files in a temp directory so generation
    // doesn't write into our actual repo.
    workdir = await mkdtemp(join(tmpdir(), 'cartographer-self-test-'));

    // Copy only the directories needed for analysis (not node_modules/dist)
    await cp(join(PROJECT_ROOT, 'src'), join(workdir, 'src'), { recursive: true });
    await cp(join(PROJECT_ROOT, 'test'), join(workdir, 'test'), { recursive: true });
    await cp(join(PROJECT_ROOT, 'package.json'), join(workdir, 'package.json'));
    await cp(join(PROJECT_ROOT, 'tsconfig.json'), join(workdir, 'tsconfig.json'));
    await cp(join(PROJECT_ROOT, 'vitest.config.ts'), join(workdir, 'vitest.config.ts'));

    const { result } = await runAnalysis({ rootPath: workdir });
    analysisResult = result;
  }, 60_000);

  // ─── Summary ─────────────────────────────────────────────────────────────

  it('produces a complete summary', () => {
    const { summary } = analysisResult;
    expect(summary.projectName).toBeTruthy();
    expect(summary.analyzedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(summary.totalFiles).toBeGreaterThan(0);
    expect(summary.totalDirectories).toBeGreaterThan(0);
    expect(summary.primaryLanguage).toBe('TypeScript');
  });

  // ─── Structure ───────────────────────────────────────────────────────────

  it('detects TypeScript as the primary language', () => {
    const langs = analysisResult.structure.statistics.languageDistribution;
    expect(langs.length).toBeGreaterThan(0);
    expect(langs[0].language).toBe('TypeScript');
    expect(langs[0].percentage).toBeGreaterThan(50);
  });

  it('categorizes files correctly', () => {
    const counts = analysisResult.structure.statistics.categoryCounts;
    expect(counts.source).toBeGreaterThan(0);
    expect(counts.test).toBeGreaterThan(0);
    expect(counts.config).toBeGreaterThan(0);
  });

  it('excludes node_modules and dist', () => {
    const tree = JSON.stringify(analysisResult.structure.tree);
    expect(tree).not.toContain('node_modules');
    expect(tree).not.toContain('"name":"dist"');
  });

  // ─── Patterns ────────────────────────────────────────────────────────────

  it('detects at least one architecture pattern', () => {
    expect(analysisResult.patterns.patterns.length).toBeGreaterThan(0);
  });

  it('marks exactly one pattern as dominant when multiple are detected', () => {
    const patterns = analysisResult.patterns.patterns;
    if (patterns.length > 1) {
      const dominant = patterns.filter((p) => p.isDominant);
      expect(dominant).toHaveLength(1);
    }
  });

  it('builds a non-empty dependency graph', () => {
    // The cartographer has many internal imports — graph should have edges
    expect(analysisResult.patterns.dependencyGraph.length).toBeGreaterThan(10);
  });

  // ─── Build Pipeline ──────────────────────────────────────────────────────

  it('detects the build tool', () => {
    expect(analysisResult.buildPipeline.buildTool).not.toBeNull();
    // Either TypeScript Compiler or some other tool from package.json
    expect(analysisResult.buildPipeline.buildTool?.name).toBeTruthy();
  });

  it('extracts npm scripts', () => {
    const scripts = analysisResult.buildPipeline.scripts;
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.some((s) => s.name === 'build')).toBe(true);
    expect(scripts.some((s) => s.name === 'test')).toBe(true);
  });

  it('classifies build/test scripts correctly', () => {
    const scripts = analysisResult.buildPipeline.scripts;
    const buildScript = scripts.find((s) => s.name === 'build');
    expect(buildScript?.type).toBe('build');
    const testScript = scripts.find((s) => s.name === 'test');
    expect(testScript?.type).toBe('test');
  });

  it('extracts direct dependencies', () => {
    const deps = analysisResult.buildPipeline.dependencies;
    expect(deps.length).toBeGreaterThan(0);
    expect(deps.some((d) => d.name === '@modelcontextprotocol/sdk')).toBe(true);
    expect(deps.some((d) => d.name === 'zod')).toBe(true);
  });

  // ─── Warnings ────────────────────────────────────────────────────────────

  it('does not produce error-level warnings', () => {
    const errors = analysisResult.warnings.filter((w) => w.severity === 'error');
    expect(errors).toEqual([]);
  });

  // ─── Generation ──────────────────────────────────────────────────────────

  it('generates artifacts successfully', async () => {
    const generationResult = await runGeneration({
      rootPath: workdir,
      analysis: analysisResult,
      conflictStrategy: 'skip',
    });

    expect(generationResult.generatedFiles.length).toBeGreaterThan(0);
    // Build-and-Test steering should always be generated since we have scripts
    const buildSteering = generationResult.generatedFiles.find(
      (f) => f.path === '.kiro/steering/build-and-test.md'
    );
    expect(buildSteering).toBeDefined();
  });

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  it('cleans up temp dir without errors', async () => {
    await expect(rm(workdir, { recursive: true, force: true })).resolves.toBeUndefined();
  });
});
