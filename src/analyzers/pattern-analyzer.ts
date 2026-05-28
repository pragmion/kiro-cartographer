// Codebase Explorer Power - Pattern Analyzer
// Detects architecture patterns, builds dependency graphs, and identifies layers.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type {
  FileTreeNode,
  ArchitecturePatterns,
  DetectedPattern,
  PatternEvidence,
  PatternType,
  Confidence,
  DependencyEdge,
  LayerDefinition,
} from '../types.js';

// ─── Pattern Detection Rules ────────────────────────────────────────────────

interface PatternIndicator {
  role: string;
  /** Matches against file paths (relative). */
  pathPatterns: RegExp[];
  /** Also match against file names (without directory). */
  namePatterns?: RegExp[];
  description: string;
  weight: number;
}

interface PatternRule {
  type: PatternType;
  indicators: PatternIndicator[];
  /** If true, pattern is suppressed when other non-low patterns exist. */
  suppressWhenOthersExist?: boolean;
}

const PATTERN_RULES: PatternRule[] = [
  {
    type: 'mvc',
    indicators: [
      {
        role: 'controllers',
        pathPatterns: [/controllers?\//i],
        namePatterns: [/Controller\.[tj]sx?$/],
        description: 'Request handling and routing layer',
        weight: 3,
      },
      {
        role: 'models',
        pathPatterns: [/models?\//i, /entities?\//i],
        namePatterns: [/Model\.[tj]sx?$/],
        description: 'Data and business logic layer',
        weight: 2,
      },
      {
        role: 'views',
        pathPatterns: [/views?\//i, /templates?\//i, /pages?\//i],
        namePatterns: [/View\.[tj]sx?$/],
        description: 'Presentation and rendering layer',
        weight: 2,
      },
      {
        role: 'routes',
        pathPatterns: [/routes?\//i],
        namePatterns: [/[Rr]outer\.[tj]sx?$/, /\.routes?\.[tj]sx?$/],
        description: 'URL routing definitions',
        weight: 1,
      },
      {
        role: 'middleware',
        pathPatterns: [/middlewares?\//i],
        namePatterns: [/[Mm]iddleware\.[tj]sx?$/],
        description: 'Request processing middleware',
        weight: 1,
      },
    ],
  },
  {
    type: 'hexagonal',
    indicators: [
      {
        role: 'ports',
        pathPatterns: [/ports?\//i],
        description: 'Interface definitions (ports)',
        weight: 3,
      },
      {
        role: 'adapters',
        pathPatterns: [/adapters?\//i],
        description: 'External system adapters',
        weight: 3,
      },
      {
        role: 'domain',
        pathPatterns: [/domain\//i, /core\//i],
        description: 'Core business logic',
        weight: 2,
      },
      {
        role: 'application',
        pathPatterns: [/application\//i, /use-?cases?\//i],
        description: 'Application services / use cases',
        weight: 2,
      },
      {
        role: 'infrastructure',
        pathPatterns: [/infrastructure\//i, /infra\//i],
        description: 'Infrastructure implementations',
        weight: 2,
      },
    ],
  },
  {
    type: 'layered',
    indicators: [
      {
        role: 'presentation',
        pathPatterns: [/presentation\//i, /ui\//i, /web\//i, /controllers?\//i],
        description: 'Presentation / API layer',
        weight: 2,
      },
      {
        role: 'business',
        pathPatterns: [/services?\//i, /business\//i, /logic\//i],
        description: 'Business logic layer',
        weight: 2,
      },
      {
        role: 'data',
        pathPatterns: [/repositories?\//i, /repository\//i, /dal\//i, /data\//i, /persistence\//i],
        description: 'Data access layer',
        weight: 2,
      },
      {
        role: 'dto',
        pathPatterns: [/dtos?\//i],
        description: 'Data transfer objects between layers',
        weight: 1,
      },
    ],
  },
  {
    type: 'microservices',
    indicators: [
      {
        role: 'services',
        pathPatterns: [/services\/[^/]+\/package\.json$/, /packages\/[^/]+\/package\.json$/, /apps\/[^/]+\/package\.json$/],
        description: 'Independent service modules with own manifests',
        weight: 4,
      },
      {
        role: 'gateway',
        pathPatterns: [/gateway\//i, /api-gateway\//i],
        description: 'API gateway / entry point',
        weight: 2,
      },
      {
        role: 'shared',
        pathPatterns: [/shared\//i, /common\//i, /libs?\//i],
        description: 'Shared libraries between services',
        weight: 1,
      },
      {
        role: 'contracts',
        pathPatterns: [/proto\//i, /contracts?\//i],
        description: 'Service contract definitions',
        weight: 2,
      },
    ],
  },
  {
    type: 'event-driven',
    indicators: [
      {
        role: 'events',
        pathPatterns: [/events?\//i],
        namePatterns: [/Event\.[tj]sx?$/],
        description: 'Event definitions',
        weight: 3,
      },
      {
        role: 'handlers',
        pathPatterns: [/handlers?\//i],
        namePatterns: [/Handler\.[tj]sx?$/],
        description: 'Event handlers',
        weight: 3,
      },
      {
        role: 'listeners',
        pathPatterns: [/listeners?\//i],
        namePatterns: [/Listener\.[tj]sx?$/],
        description: 'Event listeners',
        weight: 2,
      },
      {
        role: 'subscribers',
        pathPatterns: [/subscribers?\//i, /publishers?\//i, /queues?\//i, /topics?\//i],
        description: 'Message queue / pub-sub infrastructure',
        weight: 2,
      },
    ],
  },
  {
    type: 'monolith',
    suppressWhenOthersExist: true,
    indicators: [
      {
        role: 'single-source',
        pathPatterns: [/^src\//i],
        description: 'Single source directory (no service separation)',
        weight: 2,
      },
      {
        role: 'modules',
        pathPatterns: [/modules?\//i, /features?\//i],
        description: 'Feature modules within single app',
        weight: 2,
      },
    ],
  },
];

// ─── Import Extraction ──────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  /import\s+(?:(?:\{[^}]*\}|[^{}\s,]+)(?:\s*,\s*(?:\{[^}]*\}|[^{}\s,]+))*\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Event-related path patterns for classifying edges. */
const EVENT_PATH_PATTERNS = [/events?\//i, /handlers?\//i, /listeners?\//i, /subscribers?\//i];

interface ImportInfo {
  source: string;
  target: string;
}

function extractImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const dir = dirname(filePath);

  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        const resolved = normalizeImportPath(dir, importPath);
        imports.push({ source: filePath, target: resolved });
      }
    }
  }

  return imports;
}

function normalizeImportPath(fromDir: string, importPath: string): string {
  const parts = fromDir.split('/').concat(importPath.split('/'));
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

/**
 * Determines the edge type based on the import target path.
 */
function classifyEdgeType(target: string): 'import' | 'event' {
  if (EVENT_PATH_PATTERNS.some(p => p.test(target + '/'))) {
    return 'event';
  }
  return 'import';
}

// ─── Pattern Analyzer ───────────────────────────────────────────────────────

export class PatternAnalyzer implements Analyzer<ArchitecturePatterns> {
  readonly name = 'PatternAnalyzer';

  async analyze(context: AnalysisContext): Promise<ArchitecturePatterns> {
    await context.reportProgress('Starting pattern analysis', 0, 100);

    await context.reportProgress('Detecting architecture patterns', 20, 100);
    const patterns = this.detectPatterns(context.fileTree);

    await context.reportProgress('Building dependency graph', 50, 100);
    const filePaths = this.collectFilePaths(context.fileTree, '');
    const dependencyGraph = await this.buildDependencyGraph(context.rootPath, filePaths);

    await context.reportProgress('Analyzing layers', 80, 100);
    const layers = this.detectLayers(context.fileTree);

    await context.reportProgress('Pattern analysis complete', 100, 100);

    return {
      patterns,
      dependencyGraph,
      layers,
    };
  }

  /**
   * Detects architecture patterns based on file tree structure.
   */
  detectPatterns(fileTree: FileTreeNode[]): DetectedPattern[] {
    const filePaths = this.collectFilePaths(fileTree, '');
    const detected: DetectedPattern[] = [];

    for (const rule of PATTERN_RULES) {
      const evidence: PatternEvidence[] = [];
      let matchingWeight = 0;
      let totalWeight = 0;

      for (const indicator of rule.indicators) {
        totalWeight += indicator.weight;
        const matchingFiles = filePaths.filter(fp => {
          // Check path patterns
          if (indicator.pathPatterns.some(pattern => pattern.test(fp))) return true;
          // Check name patterns (against filename only)
          if (indicator.namePatterns) {
            const fileName = fp.split('/').pop() ?? fp;
            if (indicator.namePatterns.some(pattern => pattern.test(fileName))) return true;
          }
          return false;
        });

        if (matchingFiles.length > 0) {
          matchingWeight += indicator.weight;
          evidence.push({
            role: indicator.role,
            files: matchingFiles.slice(0, 10),
            description: indicator.description,
          });
        }
      }

      if (evidence.length > 0) {
        const ratio = matchingWeight / totalWeight;
        const confidence = this.calculateConfidence(ratio, evidence.length, rule.indicators.length, rule.type, filePaths);

        detected.push({
          type: rule.type,
          confidence,
          matchingFeatures: evidence.length,
          totalFeatures: rule.indicators.length,
          evidence,
          isDominant: false,
        });
      }
    }

    // Suppress monolith if other non-low patterns exist
    const nonMonolithNonLow = detected.filter(p => p.type !== 'monolith' && p.confidence !== 'low');
    if (nonMonolithNonLow.length > 0) {
      const monolithIdx = detected.findIndex(p => p.type === 'monolith');
      if (monolithIdx >= 0) {
        detected.splice(monolithIdx, 1);
      }
    }

    // Sort by confidence then evidence count
    detected.sort((a, b) => {
      const confOrder = { high: 3, medium: 2, low: 1 };
      const confDiff = confOrder[b.confidence] - confOrder[a.confidence];
      if (confDiff !== 0) return confDiff;
      return b.matchingFeatures - a.matchingFeatures;
    });

    // Mark dominant
    this.markDominantPattern(detected);

    return detected;
  }

  /**
   * Detects layer definitions based on file tree structure.
   * Returns an array of layers (not undefined) when layers are detected,
   * or undefined when no layered structure is found.
   */
  detectLayers(fileTree: FileTreeNode[]): LayerDefinition[] | undefined {
    const filePaths = this.collectFilePaths(fileTree, '');

    // Check for classic layered: presentation/business/data
    const hasPresentation = filePaths.some(fp => /presentation\//i.test(fp));
    const hasBusiness = filePaths.some(fp => /business\//i.test(fp));
    const hasData = filePaths.some(fp => /^data\//i.test(fp) || /\/data\//i.test(fp));

    if (hasPresentation && hasBusiness && hasData) {
      return [
        { name: 'Presentation', responsibilities: ['User interface', 'API endpoints'], modules: filePaths.filter(fp => /presentation\//i.test(fp)).slice(0, 20), allowedDependencies: ['Business'] },
        { name: 'Business', responsibilities: ['Business logic', 'Service orchestration'], modules: filePaths.filter(fp => /business\//i.test(fp)).slice(0, 20), allowedDependencies: ['Data'] },
        { name: 'Data', responsibilities: ['Database access', 'Persistence'], modules: filePaths.filter(fp => /^data\//i.test(fp) || /\/data\//i.test(fp)).slice(0, 20), allowedDependencies: [] },
      ];
    }

    // Check for controllers/services/repositories
    const hasControllers = filePaths.some(fp => /controllers?\//i.test(fp));
    const hasServices = filePaths.some(fp => /services?\//i.test(fp));
    const hasRepositories = filePaths.some(fp => /repositories?\//i.test(fp) || /repository\//i.test(fp));

    if (hasControllers && hasServices && hasRepositories) {
      return [
        { name: 'Controllers', responsibilities: ['Request handling', 'Routing'], modules: filePaths.filter(fp => /controllers?\//i.test(fp)).slice(0, 20), allowedDependencies: ['Services'] },
        { name: 'Services', responsibilities: ['Business logic', 'Orchestration'], modules: filePaths.filter(fp => /services?\//i.test(fp)).slice(0, 20), allowedDependencies: ['Repositories'] },
        { name: 'Repositories', responsibilities: ['Data access', 'Persistence'], modules: filePaths.filter(fp => /repositories?\//i.test(fp) || /repository\//i.test(fp)).slice(0, 20), allowedDependencies: [] },
      ];
    }

    // Check for hexagonal: domain/application/infrastructure
    const hasDomain = filePaths.some(fp => /domain\//i.test(fp) || /core\//i.test(fp));
    const hasApplication = filePaths.some(fp => /application\//i.test(fp) || /use-?cases?\//i.test(fp));
    const hasInfra = filePaths.some(fp => /infrastructure\//i.test(fp) || /infra\//i.test(fp) || /adapters?\//i.test(fp));

    if (hasDomain && (hasApplication || hasInfra)) {
      const layers: LayerDefinition[] = [];
      layers.push({ name: 'Domain', responsibilities: ['Business logic', 'Domain entities'], modules: filePaths.filter(fp => /domain\//i.test(fp) || /core\//i.test(fp)).slice(0, 20), allowedDependencies: [] });
      if (hasApplication) {
        layers.push({ name: 'Application', responsibilities: ['Use case orchestration'], modules: filePaths.filter(fp => /application\//i.test(fp) || /use-?cases?\//i.test(fp)).slice(0, 20), allowedDependencies: ['Domain'] });
      }
      if (hasInfra) {
        layers.push({ name: 'Infrastructure', responsibilities: ['External adapters', 'Persistence'], modules: filePaths.filter(fp => /infrastructure\//i.test(fp) || /infra\//i.test(fp) || /adapters?\//i.test(fp)).slice(0, 20), allowedDependencies: ['Domain', 'Application'] });
      }
      return layers;
    }

    return undefined;
  }

  private collectFilePaths(nodes: FileTreeNode[], prefix: string): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
      const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'file') {
        paths.push(nodePath);
      } else if (node.type === 'directory' && node.children) {
        paths.push(...this.collectFilePaths(node.children, nodePath));
      }
    }
    return paths;
  }

  private calculateConfidence(
    weightedRatio: number,
    evidenceCount: number,
    totalIndicators: number,
    patternType: PatternType,
    filePaths: string[],
  ): Confidence {
    // Monolith: high confidence if src/ has many files
    if (patternType === 'monolith') {
      const srcFiles = filePaths.filter(fp => /^src\//i.test(fp));
      if (srcFiles.length >= 5) return 'high';
      if (srcFiles.length >= 3) return 'medium';
      return 'low';
    }

    // Microservices: need the service manifests indicator
    if (patternType === 'microservices') {
      const serviceManifests = filePaths.filter(fp =>
        /services\/[^/]+\/package\.json$/.test(fp) ||
        /packages\/[^/]+\/package\.json$/.test(fp) ||
        /apps\/[^/]+\/package\.json$/.test(fp)
      );
      if (serviceManifests.length >= 3) return 'high';
      if (serviceManifests.length >= 2) return 'medium';
      return 'low';
    }

    // General: based on weighted ratio and evidence count
    if (weightedRatio >= 0.8 && evidenceCount >= Math.ceil(totalIndicators * 0.8)) {
      return 'high';
    }
    if (weightedRatio > 0.3 && evidenceCount >= 2) {
      return 'medium';
    }
    return 'low';
  }

  private markDominantPattern(patterns: DetectedPattern[]): void {
    if (patterns.length === 0) return;
    // First pattern is already the highest confidence + most evidence (sorted)
    patterns[0].isDominant = true;
  }

  private async buildDependencyGraph(
    rootPath: string,
    filePaths: string[],
  ): Promise<DependencyEdge[]> {
    const edges = new Map<string, DependencyEdge>();
    const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

    const sourceFiles = filePaths.filter(fp => {
      const ext = fp.substring(fp.lastIndexOf('.'));
      return sourceExtensions.has(ext);
    });

    const filesToAnalyze = sourceFiles.slice(0, 500);

    for (const filePath of filesToAnalyze) {
      const fullPath = join(rootPath, filePath);
      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const imports = extractImports(content, filePath);
      for (const imp of imports) {
        const edgeType = classifyEdgeType(imp.target);
        const edgeKey = `${imp.source}→${imp.target}`;
        const existing = edges.get(edgeKey);
        if (existing) {
          existing.weight++;
        } else {
          edges.set(edgeKey, {
            source: imp.source,
            target: imp.target,
            type: edgeType,
            weight: 1,
          });
        }
      }
    }

    return [...edges.values()];
  }
}
