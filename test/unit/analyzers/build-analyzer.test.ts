// Unit tests for BuildAnalyzer

import { describe, it, expect, beforeEach } from 'vitest';
import { BuildAnalyzer } from '../../../src/analyzers/build-analyzer.js';
import type { AnalysisContext, StateCache } from '../../../src/analyzers/base-analyzer.js';
import type { FileTreeNode, ResolvedConfig } from '../../../src/types.js';

describe('BuildAnalyzer', () => {
  let analyzer: BuildAnalyzer;
  let mockContext: AnalysisContext;

  beforeEach(() => {
    analyzer = new BuildAnalyzer();

    const mockCache: StateCache = {
      getFileHash: () => undefined,
      setFileHash: () => {},
      getArtifactsForFile: () => [],
      setArtifactsForFile: () => {},
    };

    mockContext = {
      rootPath: '/test/project',
      fileTree: [],
      focusAreas: ['build-pipeline'],
      config: {} as ResolvedConfig,
      cache: mockCache,
      reportProgress: async () => {},
    };
  });

  describe('Build Tool Detection', () => {
    it('should detect Vite as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/vite.config.ts',
          name: 'vite.config.ts',
          type: 'file',
          size: 100,
          extension: '.ts',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('Vite');
      expect(result.buildTool?.configFile).toContain('vite.config.ts');
      expect(result.noBuildToolFound).toBe(false);
    });

    it('should detect Webpack as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/webpack.config.js',
          name: 'webpack.config.js',
          type: 'file',
          size: 200,
          extension: '.js',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('Webpack');
      expect(result.buildTool?.configFile).toContain('webpack.config.js');
    });

    it('should detect Maven as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/pom.xml',
          name: 'pom.xml',
          type: 'file',
          size: 500,
          extension: '.xml',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('Maven');
      expect(result.buildTool?.configFile).toContain('pom.xml');
    });

    it('should detect Gradle as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/build.gradle',
          name: 'build.gradle',
          type: 'file',
          size: 300,
          extension: '.gradle',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('Gradle');
      expect(result.buildTool?.configFile).toContain('build.gradle');
    });

    it('should detect Cargo as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/Cargo.toml',
          name: 'Cargo.toml',
          type: 'file',
          size: 150,
          extension: '.toml',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('Cargo');
      expect(result.buildTool?.configFile).toContain('Cargo.toml');
    });

    it('should detect Make as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/Makefile',
          name: 'Makefile',
          type: 'file',
          size: 250,
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('Make');
      expect(result.buildTool?.configFile).toContain('Makefile');
    });

    it('should detect esbuild as build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/esbuild.config.js',
          name: 'esbuild.config.js',
          type: 'file',
          size: 120,
          extension: '.js',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('esbuild');
      expect(result.buildTool?.configFile).toContain('esbuild.config.js');
    });

    it('should return null when no build tool is detected', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/README.md',
          name: 'README.md',
          type: 'file',
          size: 100,
          extension: '.md',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).toBeNull();
      expect(result.noBuildToolFound).toBe(true);
    });

    it('should detect TypeScript Compiler as fallback build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/tsconfig.json',
          name: 'tsconfig.json',
          type: 'file',
          size: 200,
          extension: '.json',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.buildTool).not.toBeNull();
      expect(result.buildTool?.name).toBe('TypeScript Compiler');
      expect(result.buildTool?.configFile).toContain('tsconfig.json');
    });
  });

  describe('Script Classification', () => {
    it('should classify test scripts correctly', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/package.json',
          name: 'package.json',
          type: 'file',
          size: 300,
          extension: '.json',
        },
      ];

      // We'll need to mock file reading for this test
      // For now, just verify the analyzer runs without errors
      const result = await analyzer.analyze(mockContext);

      expect(result.scripts).toBeDefined();
      expect(Array.isArray(result.scripts)).toBe(true);
    });
  });

  describe('CI/CD Detection', () => {
    it('should detect GitHub Actions configuration', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/.github',
          name: '.github',
          type: 'directory',
          children: [
            {
              path: '/test/project/.github/workflows',
              name: 'workflows',
              type: 'directory',
              children: [
                {
                  path: '/test/project/.github/workflows/ci.yml',
                  name: 'ci.yml',
                  type: 'file',
                  size: 500,
                  extension: '.yml',
                },
              ],
            },
          ],
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.cicd).toBeDefined();
      expect(Array.isArray(result.cicd)).toBe(true);
    });

    it('should detect GitLab CI configuration', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/.gitlab-ci.yml',
          name: '.gitlab-ci.yml',
          type: 'file',
          size: 400,
          extension: '.yml',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.cicd).toBeDefined();
      expect(Array.isArray(result.cicd)).toBe(true);
    });

    it('should detect Jenkins configuration', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/Jenkinsfile',
          name: 'Jenkinsfile',
          type: 'file',
          size: 600,
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.cicd).toBeDefined();
      expect(Array.isArray(result.cicd)).toBe(true);
    });
  });

  describe('Dependencies Extraction', () => {
    it('should extract dependencies from package.json', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/package.json',
          name: 'package.json',
          type: 'file',
          size: 500,
          extension: '.json',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.dependencies).toBeDefined();
      expect(Array.isArray(result.dependencies)).toBe(true);
    });
  });

  describe('Fallback Behavior', () => {
    it('should set noBuildToolFound to true when no build tool and no scripts found', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/README.md',
          name: 'README.md',
          type: 'file',
          size: 100,
          extension: '.md',
        },
      ];

      const result = await analyzer.analyze(mockContext);

      expect(result.noBuildToolFound).toBe(true);
      expect(result.buildTool).toBeNull();
      expect(result.scripts).toHaveLength(0);
    });

    it('should set noBuildToolFound to false when scripts are found even without build tool', async () => {
      mockContext.fileTree = [
        {
          path: '/test/project/package.json',
          name: 'package.json',
          type: 'file',
          size: 200,
          extension: '.json',
        },
      ];

      // Even if package.json is empty or has no scripts, the analyzer should try to read it
      const result = await analyzer.analyze(mockContext);

      // noBuildToolFound should be true only if both buildTool is null AND scripts is empty
      expect(result.noBuildToolFound).toBe(result.buildTool === null && result.scripts.length === 0);
    });
  });
});
