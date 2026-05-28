// Integration test to verify Task 4.2: File categorization and language distribution
// This test demonstrates that all requirements for task 4.2 are implemented and working

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StructureAnalyzer } from '../../src/analyzers/structure-analyzer.js';
import type { AnalysisContext } from '../../src/analyzers/base-analyzer.js';
import type { ResolvedConfig } from '../../src/types.js';

function createMockContext(rootPath: string): AnalysisContext {
  return {
    rootPath,
    fileTree: [],
    focusAreas: [],
    config: {
      userProfile: {},
      teamConventions: {},
      analysisProfile: { focusAreas: [] },
      overriddenFields: [],
    } as ResolvedConfig,
    cache: {
      getFileHash: () => undefined,
      setFileHash: () => {},
      getArtifactsForFile: () => [],
      setArtifactsForFile: () => {},
    },
    reportProgress: async () => {},
  };
}

describe('Task 4.2: File Categorization and Language Distribution', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'task-4.2-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('correctly categorizes files by extension: source, config, test, documentation, asset, unknown', async () => {
    // Create files of different categories
    await mkdir(join(tempDir, 'src'));
    await mkdir(join(tempDir, 'test'));
    await mkdir(join(tempDir, 'docs'));
    await mkdir(join(tempDir, 'assets'));

    // Source files
    await writeFile(join(tempDir, 'src', 'main.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'src', 'utils.js'), 'module.exports = {};');
    await writeFile(join(tempDir, 'src', 'script.py'), 'x = 1');

    // Config files
    await writeFile(join(tempDir, 'package.json'), '{}');
    await writeFile(join(tempDir, 'tsconfig.json'), '{}');
    await writeFile(join(tempDir, 'config.yaml'), 'key: value');

    // Test files
    await writeFile(join(tempDir, 'test', 'main.test.ts'), 'test("x", () => {});');
    await writeFile(join(tempDir, 'src', 'utils.spec.js'), 'describe("utils", () => {});');

    // Documentation files
    await writeFile(join(tempDir, 'README.md'), '# Project');
    await writeFile(join(tempDir, 'docs', 'guide.rst'), 'Guide');

    // Asset files
    await writeFile(join(tempDir, 'assets', 'logo.png'), 'fake-png');
    await writeFile(join(tempDir, 'assets', 'styles.css'), 'body {}');

    // Unknown files
    await writeFile(join(tempDir, 'data.xyz'), 'unknown');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // Verify categorization counts
    expect(result.statistics.categoryCounts.source).toBe(3); // main.ts, utils.js, script.py
    expect(result.statistics.categoryCounts.config).toBe(3); // package.json, tsconfig.json, config.yaml
    expect(result.statistics.categoryCounts.test).toBe(2); // main.test.ts, utils.spec.js
    expect(result.statistics.categoryCounts.documentation).toBe(2); // README.md, guide.rst
    expect(result.statistics.categoryCounts.asset).toBe(2); // logo.png, styles.css
    expect(result.statistics.categoryCounts.unknown).toBe(1); // data.xyz

    // Verify total counts
    expect(result.statistics.totalFiles).toBe(13);
  });

  it('computes language distribution with line counts and percentages', async () => {
    await mkdir(join(tempDir, 'src'));

    // Create files with known line counts
    // TypeScript: 60 lines total (60%)
    await writeFile(join(tempDir, 'src', 'app.ts'), 'const x = 1;\n'.repeat(40));
    await writeFile(join(tempDir, 'src', 'utils.ts'), 'export {};\n'.repeat(20));

    // Python: 30 lines total (30%)
    await writeFile(join(tempDir, 'src', 'script.py'), 'x = 1\n'.repeat(30));

    // JavaScript: 10 lines total (10%)
    await writeFile(join(tempDir, 'src', 'legacy.js'), 'var x = 1;\n'.repeat(10));

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // Verify language distribution
    const tsLang = result.statistics.languageDistribution.find(l => l.language === 'TypeScript');
    const pyLang = result.statistics.languageDistribution.find(l => l.language === 'Python');
    const jsLang = result.statistics.languageDistribution.find(l => l.language === 'JavaScript');

    expect(tsLang).toBeDefined();
    expect(pyLang).toBeDefined();
    expect(jsLang).toBeDefined();

    // Verify line counts
    expect(tsLang!.lineCount).toBe(60);
    expect(pyLang!.lineCount).toBe(30);
    expect(jsLang!.lineCount).toBe(10);

    // Verify file counts
    expect(tsLang!.fileCount).toBe(2);
    expect(pyLang!.fileCount).toBe(1);
    expect(jsLang!.fileCount).toBe(1);

    // Verify percentages (should be 60%, 30%, 10%)
    expect(tsLang!.percentage).toBe(60);
    expect(pyLang!.percentage).toBe(30);
    expect(jsLang!.percentage).toBe(10);

    // Verify percentages sum to 100%
    const totalPercentage = result.statistics.languageDistribution.reduce(
      (sum, l) => sum + l.percentage,
      0
    );
    expect(totalPercentage).toBe(100);

    // Verify sorting by line count (descending)
    expect(result.statistics.languageDistribution[0].language).toBe('TypeScript');
    expect(result.statistics.languageDistribution[1].language).toBe('Python');
    expect(result.statistics.languageDistribution[2].language).toBe('JavaScript');
  });

  it('provides complete statistics: totalFiles, totalDirectories, categoryCounts, languageDistribution', async () => {
    await mkdir(join(tempDir, 'src'));
    await mkdir(join(tempDir, 'test'));
    await mkdir(join(tempDir, 'docs'));

    await writeFile(join(tempDir, 'src', 'main.ts'), 'const x = 1;\n'.repeat(10));
    await writeFile(join(tempDir, 'test', 'main.test.ts'), 'test("x", () => {});\n'.repeat(5));
    await writeFile(join(tempDir, 'docs', 'README.md'), '# Project\n');
    await writeFile(join(tempDir, 'package.json'), '{}');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // Verify all required statistics are present
    expect(result.statistics).toHaveProperty('totalFiles');
    expect(result.statistics).toHaveProperty('totalDirectories');
    expect(result.statistics).toHaveProperty('categoryCounts');
    expect(result.statistics).toHaveProperty('languageDistribution');

    // Verify values
    expect(result.statistics.totalFiles).toBe(4);
    expect(result.statistics.totalDirectories).toBe(3); // src, test, docs

    // Verify categoryCounts has all categories
    expect(result.statistics.categoryCounts).toHaveProperty('source');
    expect(result.statistics.categoryCounts).toHaveProperty('config');
    expect(result.statistics.categoryCounts).toHaveProperty('test');
    expect(result.statistics.categoryCounts).toHaveProperty('documentation');
    expect(result.statistics.categoryCounts).toHaveProperty('asset');
    expect(result.statistics.categoryCounts).toHaveProperty('unknown');

    // Verify languageDistribution structure
    expect(Array.isArray(result.statistics.languageDistribution)).toBe(true);
    expect(result.statistics.languageDistribution.length).toBeGreaterThan(0);
    
    const firstLang = result.statistics.languageDistribution[0];
    expect(firstLang).toHaveProperty('language');
    expect(firstLang).toHaveProperty('lineCount');
    expect(firstLang).toHaveProperty('percentage');
    expect(firstLang).toHaveProperty('fileCount');
  });

  it('handles edge case: empty project with no source files', async () => {
    // Create a project with only documentation
    await writeFile(join(tempDir, 'README.md'), '# Empty Project\n');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // Should have empty language distribution
    expect(result.statistics.languageDistribution).toHaveLength(0);

    // But should still have file counts
    expect(result.statistics.totalFiles).toBe(1);
    expect(result.statistics.categoryCounts.documentation).toBe(1);
  });

  it('handles edge case: files with no extension', async () => {
    await writeFile(join(tempDir, 'Makefile'), 'all:\n\techo "build"');
    await writeFile(join(tempDir, 'Dockerfile'), 'FROM node:18');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // These should be categorized as config (known filenames)
    expect(result.statistics.categoryCounts.config).toBe(2);
  });
});
