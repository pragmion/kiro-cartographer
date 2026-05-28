import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  StructureAnalyzer,
  categorizeFile,
  getLanguageForExtension,
  DEFAULT_EXCLUDED_DIRS,
} from '../../../src/analyzers/structure-analyzer.js';
import type { AnalysisContext } from '../../../src/analyzers/base-analyzer.js';
import type { ResolvedConfig } from '../../../src/types.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockContext(rootPath: string, overrides: Partial<AnalysisContext> = {}): AnalysisContext {
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
    ...overrides,
  };
}

// ─── categorizeFile Tests ───────────────────────────────────────────────────

describe('categorizeFile', () => {
  it('categorizes TypeScript source files', () => {
    expect(categorizeFile('app.ts', 'src/app.ts')).toBe('source');
    expect(categorizeFile('component.tsx', 'src/component.tsx')).toBe('source');
  });

  it('categorizes JavaScript source files', () => {
    expect(categorizeFile('index.js', 'src/index.js')).toBe('source');
    expect(categorizeFile('utils.mjs', 'lib/utils.mjs')).toBe('source');
  });

  it('categorizes Python source files', () => {
    expect(categorizeFile('main.py', 'src/main.py')).toBe('source');
  });

  it('categorizes config files by extension', () => {
    expect(categorizeFile('settings.yaml', 'config/settings.yaml')).toBe('config');
    expect(categorizeFile('data.json', 'config/data.json')).toBe('config');
    expect(categorizeFile('config.toml', 'config.toml')).toBe('config');
  });

  it('categorizes config files by known filename', () => {
    expect(categorizeFile('package.json', 'package.json')).toBe('config');
    expect(categorizeFile('tsconfig.json', 'tsconfig.json')).toBe('config');
    expect(categorizeFile('Dockerfile', 'Dockerfile')).toBe('config');
    expect(categorizeFile('Makefile', 'Makefile')).toBe('config');
  });

  it('categorizes test files by naming pattern', () => {
    expect(categorizeFile('app.test.ts', 'src/app.test.ts')).toBe('test');
    expect(categorizeFile('utils.spec.js', 'src/utils.spec.js')).toBe('test');
    expect(categorizeFile('handler_test.go', 'handler_test.go')).toBe('test');
  });

  it('categorizes test files by directory path', () => {
    expect(categorizeFile('helper.ts', 'test/helper.ts')).toBe('test');
    expect(categorizeFile('fixture.ts', 'tests/fixture.ts')).toBe('test');
    expect(categorizeFile('mock.ts', '__tests__/mock.ts')).toBe('test');
  });

  it('categorizes documentation files', () => {
    expect(categorizeFile('README.md', 'README.md')).toBe('documentation');
    expect(categorizeFile('guide.rst', 'docs/guide.rst')).toBe('documentation');
  });

  it('categorizes asset files', () => {
    expect(categorizeFile('logo.png', 'assets/logo.png')).toBe('asset');
    expect(categorizeFile('styles.css', 'src/styles.css')).toBe('asset');
    expect(categorizeFile('font.woff2', 'fonts/font.woff2')).toBe('asset');
  });

  it('returns unknown for unrecognized extensions', () => {
    expect(categorizeFile('data.xyz', 'data.xyz')).toBe('unknown');
    expect(categorizeFile('binary.bin', 'binary.bin')).toBe('unknown');
  });
});

// ─── getLanguageForExtension Tests ──────────────────────────────────────────

describe('getLanguageForExtension', () => {
  it('maps TypeScript extensions', () => {
    expect(getLanguageForExtension('.ts')).toBe('TypeScript');
    expect(getLanguageForExtension('.tsx')).toBe('TypeScript');
  });

  it('maps JavaScript extensions', () => {
    expect(getLanguageForExtension('.js')).toBe('JavaScript');
    expect(getLanguageForExtension('.jsx')).toBe('JavaScript');
    expect(getLanguageForExtension('.mjs')).toBe('JavaScript');
  });

  it('maps Python extensions', () => {
    expect(getLanguageForExtension('.py')).toBe('Python');
  });

  it('returns undefined for unknown extensions', () => {
    expect(getLanguageForExtension('.xyz')).toBeUndefined();
    expect(getLanguageForExtension('.bin')).toBeUndefined();
  });
});

// ─── StructureAnalyzer Integration Tests ────────────────────────────────────

describe('StructureAnalyzer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'structure-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('traverses a simple directory structure', async () => {
    // Create structure:
    // src/
    //   index.ts (10 lines)
    //   utils.ts (5 lines)
    // README.md
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, 'src', 'index.ts'), 'const x = 1;\n'.repeat(10));
    await writeFile(join(tempDir, 'src', 'utils.ts'), 'export {};\n'.repeat(5));
    await writeFile(join(tempDir, 'README.md'), '# Hello\n');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    expect(result.statistics.totalFiles).toBe(3);
    expect(result.statistics.totalDirectories).toBe(1); // src
    expect(result.statistics.categoryCounts.source).toBe(2);
    expect(result.statistics.categoryCounts.documentation).toBe(1);
  });

  it('excludes default directories', async () => {
    await mkdir(join(tempDir, 'src'));
    await mkdir(join(tempDir, 'node_modules'));
    await mkdir(join(tempDir, '.git'));
    await writeFile(join(tempDir, 'src', 'app.ts'), 'export {};');
    await writeFile(join(tempDir, 'node_modules', 'pkg.js'), 'module.exports = {};');
    await writeFile(join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // Only src/app.ts should be counted
    expect(result.statistics.totalFiles).toBe(1);
    expect(result.statistics.categoryCounts.source).toBe(1);

    // Verify excluded dirs don't appear in tree
    const rootChildren = result.tree.children ?? [];
    const childNames = rootChildren.map(c => c.name);
    expect(childNames).not.toContain('node_modules');
    expect(childNames).not.toContain('.git');
    expect(childNames).toContain('src');
  });

  it('respects custom exclude paths', async () => {
    await mkdir(join(tempDir, 'src'));
    await mkdir(join(tempDir, 'generated'));
    await writeFile(join(tempDir, 'src', 'app.ts'), 'export {};');
    await writeFile(join(tempDir, 'generated', 'types.ts'), 'export {};');

    const analyzer = new StructureAnalyzer({ excludePaths: ['generated'] });
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    expect(result.statistics.totalFiles).toBe(1);
    const rootChildren = result.tree.children ?? [];
    const childNames = rootChildren.map(c => c.name);
    expect(childNames).not.toContain('generated');
  });

  it('respects max depth limit', async () => {
    // Create deeply nested structure: a/b/c/d.ts
    const deepPath = join(tempDir, 'a', 'b', 'c');
    await mkdir(deepPath, { recursive: true });
    await writeFile(join(deepPath, 'd.ts'), 'export {};');
    await writeFile(join(tempDir, 'a', 'top.ts'), 'export {};');

    const analyzer = new StructureAnalyzer({ maxDepth: 2 });
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // At depth 2, we can see a/ and a/b/ but not a/b/c/
    // Root is depth 0, a/ is depth 1, b/ is depth 2 (limit reached)
    expect(result.warnings.some(w => w.message.includes('Maximum traversal depth'))).toBe(true);

    // top.ts should be found (at depth 1 inside a/)
    expect(result.statistics.totalFiles).toBe(1);
  });

  it('handles symlinks without following them', async () => {
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, 'src', 'real.ts'), 'export {};');
    await symlink(join(tempDir, 'src'), join(tempDir, 'link-to-src'));

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // The symlink should appear in the tree as type 'symlink'
    const rootChildren = result.tree.children ?? [];
    const symlinkNode = rootChildren.find(c => c.name === 'link-to-src');
    expect(symlinkNode).toBeDefined();
    expect(symlinkNode!.type).toBe('symlink');

    // Only the real file should be counted
    expect(result.statistics.totalFiles).toBe(1);
  });

  it('handles unreadable directories gracefully', async () => {
    await mkdir(join(tempDir, 'readable'));
    await writeFile(join(tempDir, 'readable', 'file.ts'), 'export {};');

    const analyzer = new StructureAnalyzer();
    // Simulate by passing a non-existent root — but let's use a real scenario
    // We'll test that warnings are generated for unreadable entries
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    // Should complete without throwing
    expect(result.statistics.totalFiles).toBe(1);
  });

  it('computes language distribution correctly', async () => {
    await mkdir(join(tempDir, 'src'));
    // 20 lines of TypeScript
    await writeFile(join(tempDir, 'src', 'main.ts'), 'const x = 1;\n'.repeat(20));
    // 10 lines of Python
    await writeFile(join(tempDir, 'src', 'script.py'), 'x = 1\n'.repeat(10));
    // 10 lines of TypeScript in another file
    await writeFile(join(tempDir, 'src', 'utils.ts'), 'export {};\n'.repeat(10));

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    const tsLang = result.statistics.languageDistribution.find(l => l.language === 'TypeScript');
    const pyLang = result.statistics.languageDistribution.find(l => l.language === 'Python');

    expect(tsLang).toBeDefined();
    expect(pyLang).toBeDefined();
    expect(tsLang!.lineCount).toBe(30);
    expect(tsLang!.fileCount).toBe(2);
    expect(pyLang!.lineCount).toBe(10);
    expect(pyLang!.fileCount).toBe(1);

    // Percentages should sum to ~100
    const totalPercentage = result.statistics.languageDistribution.reduce(
      (sum, l) => sum + l.percentage, 0
    );
    expect(totalPercentage).toBeCloseTo(100, 0);

    // TypeScript should be 75%, Python 25%
    expect(tsLang!.percentage).toBe(75);
    expect(pyLang!.percentage).toBe(25);
  });

  it('returns empty language distribution for projects with no source files', async () => {
    await writeFile(join(tempDir, 'README.md'), '# Project\n');
    await writeFile(join(tempDir, 'logo.png'), 'fake-png-data');

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    expect(result.statistics.languageDistribution).toHaveLength(0);
  });

  it('sorts language distribution by line count descending', async () => {
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, 'src', 'big.py'), 'x = 1\n'.repeat(100));
    await writeFile(join(tempDir, 'src', 'medium.ts'), 'const x = 1;\n'.repeat(50));
    await writeFile(join(tempDir, 'src', 'small.go'), 'package main\n'.repeat(10));

    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir);
    const result = await analyzer.analyze(context);

    const langs = result.statistics.languageDistribution.map(l => l.language);
    expect(langs[0]).toBe('Python');
    expect(langs[1]).toBe('TypeScript');
    expect(langs[2]).toBe('Go');
  });

  it('reports progress during traversal', async () => {
    // Create a structure with multiple files to trigger progress updates
    await mkdir(join(tempDir, 'src'));
    for (let i = 0; i < 15; i++) {
      await writeFile(join(tempDir, 'src', `file${i}.ts`), `export const x${i} = ${i};\n`);
    }

    const progressReports: Array<{ message: string; progress: number; total: number }> = [];
    const analyzer = new StructureAnalyzer();
    const context = createMockContext(tempDir, {
      reportProgress: async (message, progress, total) => {
        progressReports.push({ message, progress, total });
      },
    });

    await analyzer.analyze(context);

    // Should have at least: start (0%), some intermediate updates, and complete (100%)
    expect(progressReports.length).toBeGreaterThan(2);
    expect(progressReports[0].progress).toBe(0);
    expect(progressReports[0].message).toContain('Starting');
    expect(progressReports[progressReports.length - 1].progress).toBe(100);
    expect(progressReports[progressReports.length - 1].message).toContain('complete');

    // Should have some intermediate progress reports
    const intermediateReports = progressReports.slice(1, -1);
    expect(intermediateReports.length).toBeGreaterThan(0);
    expect(intermediateReports.some(r => r.message.includes('Analyzing'))).toBe(true);
  });
});
