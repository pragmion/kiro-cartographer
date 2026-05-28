// Codebase Explorer Power - Build Analyzer
// Detects build tools, scripts, CI/CD configs, and dependencies.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type {
  FileTreeNode,
  BuildPipelineAnalysis,
  BuildToolInfo,
  BuildScript,
  CiCdConfig,
  PipelineStep,
  DependencyInfo,
} from '../types.js';

// ─── Build Tool Detection ───────────────────────────────────────────────────

interface BuildToolDef {
  name: string;
  configFiles: string[];
}

const BUILD_TOOLS: BuildToolDef[] = [
  { name: 'Vite', configFiles: ['vite.config.ts', 'vite.config.js', 'vite.config.mts'] },
  { name: 'Webpack', configFiles: ['webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs'] },
  { name: 'esbuild', configFiles: ['esbuild.config.js', 'esbuild.config.ts'] },
  { name: 'Rollup', configFiles: ['rollup.config.js', 'rollup.config.ts', 'rollup.config.mjs'] },
  { name: 'Turbopack', configFiles: ['turbo.json'] },
  { name: 'Maven', configFiles: ['pom.xml'] },
  { name: 'Gradle', configFiles: ['build.gradle', 'build.gradle.kts'] },
  { name: 'Cargo', configFiles: ['Cargo.toml'] },
  { name: 'Make', configFiles: ['Makefile', 'makefile', 'GNUmakefile'] },
  { name: 'CMake', configFiles: ['CMakeLists.txt'] },
  { name: 'Bazel', configFiles: ['BUILD', 'WORKSPACE', 'BUILD.bazel'] },
];

// ─── CI/CD Detection ────────────────────────────────────────────────────────

interface CiCdDef {
  platform: string;
  configPatterns: RegExp[];
}

const CICD_PLATFORMS: CiCdDef[] = [
  { platform: 'GitHub Actions', configPatterns: [/^\.github\/workflows\/[^/]+\.ya?ml$/] },
  { platform: 'GitLab CI', configPatterns: [/^\.gitlab-ci\.ya?ml$/] },
  { platform: 'Jenkins', configPatterns: [/^Jenkinsfile$/] },
  { platform: 'Azure Pipelines', configPatterns: [/^azure-pipelines\.ya?ml$/] },
  { platform: 'CircleCI', configPatterns: [/^\.circleci\/config\.ya?ml$/] },
  { platform: 'Travis CI', configPatterns: [/^\.travis\.ya?ml$/] },
];

// ─── Build Analyzer ─────────────────────────────────────────────────────────

export class BuildAnalyzer implements Analyzer<BuildPipelineAnalysis> {
  readonly name = 'BuildAnalyzer';

  async analyze(context: AnalysisContext): Promise<BuildPipelineAnalysis> {
    await context.reportProgress('Starting build pipeline analysis', 0, 100);

    const filePaths = this.collectFiles(context.fileTree, '');

    // Detect build tool
    await context.reportProgress('Detecting build tools', 10, 100);
    const buildTool = this.detectBuildTool(filePaths);

    // Extract scripts from package.json
    await context.reportProgress('Extracting build scripts', 30, 100);
    const scripts = await this.extractScripts(context.rootPath, filePaths);

    // Detect CI/CD
    await context.reportProgress('Detecting CI/CD configurations', 50, 100);
    const cicd = await this.detectCiCd(context.rootPath, filePaths);

    // Extract dependencies
    await context.reportProgress('Extracting dependencies', 70, 100);
    const dependencies = await this.extractDependencies(context.rootPath, filePaths);

    await context.reportProgress('Build pipeline analysis complete', 100, 100);

    return {
      buildTool,
      scripts,
      cicd,
      dependencies,
      noBuildToolFound: buildTool === null && scripts.length === 0,
    };
  }

  /**
   * Detects the primary build tool based on config files.
   */
  private detectBuildTool(filePaths: string[]): BuildToolInfo | null {
    for (const tool of BUILD_TOOLS) {
      const configFile = filePaths.find(fp =>
        tool.configFiles.some(cf => fp === cf || fp.endsWith(`/${cf}`))
      );
      if (configFile) {
        return {
          name: tool.name,
          configFile,
        };
      }
    }

    // Check for TypeScript compiler as build tool
    if (filePaths.some(fp => fp === 'tsconfig.json' || fp.endsWith('/tsconfig.json'))) {
      return {
        name: 'TypeScript Compiler',
        configFile: 'tsconfig.json',
      };
    }

    return null;
  }

  /**
   * Extracts build/test/lint scripts from package.json or Makefile.
   */
  private async extractScripts(rootPath: string, filePaths: string[]): Promise<BuildScript[]> {
    const scripts: BuildScript[] = [];

    // package.json scripts
    const pkgJsonPath = filePaths.find(fp => fp === 'package.json');
    if (pkgJsonPath) {
      try {
        const content = await readFile(join(rootPath, pkgJsonPath), 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          for (const [name, command] of Object.entries(pkg.scripts)) {
            if (typeof command !== 'string') continue;
            scripts.push({
              name,
              command,
              type: this.classifyScript(name, command),
            });
          }
        }
      } catch {
        // Invalid package.json
      }
    }

    // Makefile targets
    const makefilePath = filePaths.find(fp =>
      fp === 'Makefile' || fp === 'makefile' || fp === 'GNUmakefile'
    );
    if (makefilePath) {
      try {
        const content = await readFile(join(rootPath, makefilePath), 'utf-8');
        const targetRegex = /^([a-zA-Z_][\w-]*)\s*:/gm;
        let match: RegExpExecArray | null;
        while ((match = targetRegex.exec(content)) !== null) {
          const name = match[1];
          if (name.startsWith('.') || name === 'all') continue;
          scripts.push({
            name,
            command: `make ${name}`,
            type: this.classifyScript(name, ''),
          });
        }
      } catch {
        // Unreadable Makefile
      }
    }

    return scripts;
  }

  /**
   * Classifies a script as build, test, lint, or other.
   */
  private classifyScript(name: string, command: string): BuildScript['type'] {
    const combined = `${name} ${command}`.toLowerCase();
    if (/\btest\b|jest|vitest|mocha|pytest|cargo\s+test/.test(combined)) return 'test';
    if (/\blint\b|eslint|prettier|clippy|flake8|rubocop/.test(combined)) return 'lint';
    if (/\bbuild\b|compile|tsc|webpack|vite\s+build|cargo\s+build|mvn\s+package/.test(combined)) return 'build';
    return 'other';
  }

  /**
   * Detects CI/CD configurations and extracts pipeline steps.
   */
  private async detectCiCd(rootPath: string, filePaths: string[]): Promise<CiCdConfig[]> {
    const configs: CiCdConfig[] = [];

    for (const platform of CICD_PLATFORMS) {
      const matchingFiles = filePaths.filter(fp =>
        platform.configPatterns.some(p => p.test(fp))
      );

      for (const configFile of matchingFiles) {
        try {
          const content = await readFile(join(rootPath, configFile), 'utf-8');
          const steps = this.extractPipelineSteps(content, platform.platform);
          configs.push({
            platform: platform.platform,
            configFile,
            steps,
          });
        } catch {
          configs.push({
            platform: platform.platform,
            configFile,
            steps: [],
          });
        }
      }
    }

    return configs;
  }

  /**
   * Extracts pipeline steps from CI/CD config content.
   */
  private extractPipelineSteps(content: string, platform: string): PipelineStep[] {
    const steps: PipelineStep[] = [];

    if (platform === 'GitHub Actions') {
      // Extract jobs
      const jobRegex = /^\s{2}(\w[\w-]*):\s*$/gm;
      let match: RegExpExecArray | null;
      let order = 0;
      while ((match = jobRegex.exec(content)) !== null) {
        const name = match[1];
        if (name === 'jobs' || name === 'on' || name === 'name' || name === 'env') continue;
        steps.push({ name, order: order++ });
      }

      // Extract trigger
      const triggerMatch = /^on:\s*(.+)$/m.exec(content);
      if (triggerMatch && steps.length > 0) {
        steps[0].trigger = triggerMatch[1].trim();
      }
    } else if (platform === 'GitLab CI') {
      // Extract stages and jobs
      const stageRegex = /^(\w[\w-]*):\s*$/gm;
      let match: RegExpExecArray | null;
      let order = 0;
      while ((match = stageRegex.exec(content)) !== null) {
        const name = match[1];
        if (['stages', 'variables', 'default', 'include', 'image'].includes(name)) continue;
        steps.push({ name, order: order++ });
      }
    } else {
      // Generic: look for named steps/stages
      const stepRegex = /(?:name|stage)\s*:\s*['"]?([^'"\n]+)['"]?/g;
      let match: RegExpExecArray | null;
      let order = 0;
      while ((match = stepRegex.exec(content)) !== null) {
        steps.push({ name: match[1].trim(), order: order++ });
      }
    }

    return steps;
  }

  /**
   * Extracts direct dependencies from package.json, Cargo.toml, etc.
   */
  private async extractDependencies(rootPath: string, filePaths: string[]): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];

    // package.json dependencies
    const pkgJsonPath = filePaths.find(fp => fp === 'package.json');
    if (pkgJsonPath) {
      try {
        const content = await readFile(join(rootPath, pkgJsonPath), 'utf-8');
        const pkg = JSON.parse(content);

        const addDeps = (deps: Record<string, string> | undefined) => {
          if (!deps || typeof deps !== 'object') return;
          for (const [name, version] of Object.entries(deps)) {
            if (typeof version !== 'string') continue;
            dependencies.push({
              name,
              version,
              type: 'direct',
              depth: 0,
              status: 'ok',
            });
          }
        };

        addDeps(pkg.dependencies);
        addDeps(pkg.devDependencies);
      } catch {
        // Invalid package.json
      }
    }

    // Cargo.toml dependencies
    const cargoPath = filePaths.find(fp => fp === 'Cargo.toml');
    if (cargoPath) {
      try {
        const content = await readFile(join(rootPath, cargoPath), 'utf-8');
        const depRegex = /^\[(?:dev-)?dependencies\]\s*\n((?:[^\[]*\n)*)/gm;
        let sectionMatch: RegExpExecArray | null;
        while ((sectionMatch = depRegex.exec(content)) !== null) {
          const section = sectionMatch[1];
          const lineRegex = /^(\w[\w-]*)\s*=\s*(?:"([^"]+)"|{[^}]*version\s*=\s*"([^"]+)")/gm;
          let lineMatch: RegExpExecArray | null;
          while ((lineMatch = lineRegex.exec(section)) !== null) {
            dependencies.push({
              name: lineMatch[1],
              version: lineMatch[2] || lineMatch[3],
              type: 'direct',
              depth: 0,
              status: 'ok',
            });
          }
        }
      } catch {
        // Invalid Cargo.toml
      }
    }

    // go.mod dependencies
    const goModPath = filePaths.find(fp => fp === 'go.mod');
    if (goModPath) {
      try {
        const content = await readFile(join(rootPath, goModPath), 'utf-8');
        const requireRegex = /require\s*\(\s*\n([\s\S]*?)\n\s*\)/g;
        let reqMatch: RegExpExecArray | null;
        while ((reqMatch = requireRegex.exec(content)) !== null) {
          const block = reqMatch[1];
          const lineRegex = /^\s*(\S+)\s+(\S+)/gm;
          let lineMatch: RegExpExecArray | null;
          while ((lineMatch = lineRegex.exec(block)) !== null) {
            dependencies.push({
              name: lineMatch[1],
              version: lineMatch[2],
              type: 'direct',
              depth: 0,
              status: 'ok',
            });
          }
        }
      } catch {
        // Invalid go.mod
      }
    }

    return dependencies;
  }

  private collectFiles(nodes: FileTreeNode[], prefix: string): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
      const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'file') {
        paths.push(nodePath);
      } else if (node.type === 'directory' && node.children) {
        paths.push(...this.collectFiles(node.children, nodePath));
      }
    }
    return paths;
  }
}
