// Kiro Cartographer - In-Process Pipeline
// Provides the analysis and generation pipeline as a reusable class,
// independent of the MCP server transport. Used by the server handlers
// and by tests/CLI scripts.

import { join } from 'node:path';

import { StructureAnalyzer } from './analyzers/structure-analyzer.js';
import { PatternAnalyzer } from './analyzers/pattern-analyzer.js';
import { DataModelAnalyzer } from './analyzers/data-model-analyzer.js';
import { ApiAnalyzer } from './analyzers/api-analyzer.js';
import { ErrorHandlingAnalyzer } from './analyzers/error-handling-analyzer.js';
import { StateAnalyzer } from './analyzers/state-analyzer.js';
import { BuildAnalyzer } from './analyzers/build-analyzer.js';

import { SteeringFileGenerator } from './generators/steering-generator.js';
import { SkillGenerator } from './generators/skill-generator.js';
import { DocumentationGenerator } from './generators/documentation-generator.js';
import { ManifestManager } from './generators/manifest-manager.js';

import { resolveConfig } from './config/config-manager.js';
import { AnalysisStateCache } from './cache/state-cache.js';
import { safeWriteFile } from './utils/file-system.js';

import type {
  AnalyzeCodebaseOutput,
  AnalysisSummary,
  ArtifactType,
  FileTreeNode,
  FocusArea,
  GeneratedFile,
  ResolvedConfig,
  SteeringCategory,
  UserProfile,
  TeamConventions,
} from './types.js';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  rootPath: string;
  incremental?: boolean;
  focusAreas?: FocusArea[];
  excludePaths?: string[];
  maxDepth?: number;
  reportProgress?: (message: string, progress: number, total: number) => Promise<void>;
}

export interface GenerateOptions {
  rootPath: string;
  analysis: AnalyzeCodebaseOutput;
  artifactTypes?: ArtifactType[];
  steeringCategories?: SteeringCategory[];
  conflictStrategy?: 'ask' | 'skip';
}

export interface GenerationResult {
  generatedFiles: { path: string; type: string }[];
  skippedCategories: { category: string; reason: string }[];
  conflicts: { path: string; reason: string }[];
  overriddenPreferences: { field: string; userValue: string; teamValue: string }[];
}

const VALID_ARTIFACT_TYPES: ArtifactType[] = ['steering', 'skills', 'documentation'];
const VALID_STEERING_CATEGORIES: SteeringCategory[] = [
  'build-commands', 'naming-conventions', 'formatting', 'import-order', 'architecture', 'test-commands',
];

// ─── Pipeline ──────────────────────────────────────────────────────────────

/**
 * Runs the full analysis pipeline on a project directory.
 * Returns a structured analysis result that can be passed to generateArtifacts.
 */
export async function runAnalysis(opts: AnalyzeOptions): Promise<{
  result: AnalyzeCodebaseOutput;
  config: ResolvedConfig;
  configWarnings: string[];
}> {
  const {
    rootPath,
    focusAreas = [],
    excludePaths = [],
    maxDepth = 20,
    reportProgress = async () => {},
  } = opts;

  const { config, warnings: configWarnings } = await resolveConfig(rootPath, {
    focusAreas,
    excludePaths,
    maxDepth,
  });

  const cache = new AnalysisStateCache();
  await cache.load(rootPath);

  await reportProgress('Analyzing project structure', 5, 100);
  const structureAnalyzer = new StructureAnalyzer({ maxDepth, excludePaths });
  const structure = await structureAnalyzer.analyze({
    rootPath,
    fileTree: [],
    focusAreas,
    config,
    cache,
    reportProgress,
  });

  const fileTree: FileTreeNode[] = structure.tree.children ?? [];
  const baseContext = { rootPath, fileTree, focusAreas, config, cache, reportProgress };

  await reportProgress('Analyzing architecture', 20, 100);
  const [patterns, dataModels, apis, errorHandling, stateManagement, buildPipeline] =
    await Promise.all([
      new PatternAnalyzer().analyze(baseContext),
      new DataModelAnalyzer().analyze(baseContext),
      new ApiAnalyzer().analyze(baseContext),
      new ErrorHandlingAnalyzer().analyze(baseContext),
      new StateAnalyzer().analyze(baseContext),
      new BuildAnalyzer().analyze(baseContext),
    ]);

  await reportProgress('Finalizing', 90, 100);

  const primaryLanguage = structure.statistics.languageDistribution[0]?.language ?? 'Unknown';
  const detectedPatterns = patterns.patterns
    .filter((p) => p.confidence !== 'low')
    .map((p) => p.type);

  const summary: AnalysisSummary = {
    projectName: rootPath.split('/').pop() ?? 'project',
    analyzedAt: new Date().toISOString(),
    totalFiles: structure.statistics.totalFiles,
    totalDirectories: structure.statistics.totalDirectories,
    primaryLanguage,
    detectedPatterns,
  };

  const result: AnalyzeCodebaseOutput = {
    summary,
    structure,
    patterns,
    dataModels,
    apis,
    errorHandling,
    stateManagement,
    buildPipeline,
    warnings: [
      ...structure.warnings,
      ...configWarnings.map((m) => ({ path: '', message: m, severity: 'warning' as const })),
    ],
  };

  cache.updateTimestamp();
  await cache.save(rootPath);

  await reportProgress('Analysis complete', 100, 100);

  return { result, config, configWarnings };
}

/**
 * Generates artifacts from an analysis result.
 * Writes files to disk and updates the manifest.
 */
export async function runGeneration(opts: GenerateOptions): Promise<GenerationResult> {
  const {
    rootPath,
    analysis,
    artifactTypes = VALID_ARTIFACT_TYPES,
    steeringCategories = VALID_STEERING_CATEGORIES,
    conflictStrategy = 'skip',
  } = opts;

  const { config } = await resolveConfig(rootPath);
  const generationConfig = buildGenerationConfig(config, artifactTypes, steeringCategories);

  const manifestManager = new ManifestManager();
  await manifestManager.loadManifest(rootPath);

  const generatedFiles: { path: string; type: string }[] = [];
  const conflicts: { path: string; reason: string }[] = [];
  const skippedCategories: { category: string; reason: string }[] = [];

  const generators = [
    new SteeringFileGenerator(),
    new SkillGenerator(),
    new DocumentationGenerator(),
  ];

  for (const generator of generators) {
    if (!generator.canGenerate(analysis)) continue;

    const files: GeneratedFile[] = await generator.generate(analysis, generationConfig);

    for (const file of files) {
      const outputPath = manifestManager.getOutputPath(file.path);
      const fullPath = join(rootPath, outputPath);

      const conflict = await manifestManager.checkConflict(rootPath, outputPath);
      if (conflict !== 'none') {
        conflicts.push({ path: outputPath, reason: conflict });
        if (conflictStrategy === 'skip') continue;
        // 'ask' currently behaves like skip until interactive confirmation is wired
        continue;
      }

      const writeResult = await safeWriteFile(fullPath, file.content);
      if (!writeResult.isError) {
        manifestManager.addEntry({ ...file, path: outputPath });
        generatedFiles.push({ path: outputPath, type: file.type });
      }
    }
  }

  await manifestManager.saveManifest(rootPath);

  const overriddenPreferences = config.overriddenFields.map((field) => ({
    field,
    userValue: String((config.userProfile as Record<string, unknown>)[field] ?? ''),
    teamValue: 'team-defined',
  }));

  return { generatedFiles, skippedCategories, conflicts, overriddenPreferences };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Builds a fully-resolved GenerationConfig from a ResolvedConfig.
 * Fills in any missing optional fields with sensible defaults.
 */
function buildGenerationConfig(
  config: ResolvedConfig,
  artifactTypes: ArtifactType[],
  steeringCategories: SteeringCategory[],
) {
  const userProfile: Required<UserProfile> = {
    commentStyle: config.userProfile.commentStyle ?? 'jsdoc',
    namingPreference: config.userProfile.namingPreference ?? 'camelCase',
    preferredPatterns: config.userProfile.preferredPatterns ?? [],
    language: config.userProfile.language ?? 'en',
    maxSkillCount: config.userProfile.maxSkillCount ?? 10,
  };

  const teamConventions: Required<TeamConventions> = {
    naming: {
      files: config.teamConventions.naming?.files ?? 'kebab-case',
      variables: config.teamConventions.naming?.variables ?? 'camelCase',
      classes: config.teamConventions.naming?.classes ?? 'PascalCase',
      constants: config.teamConventions.naming?.constants ?? 'UPPER_SNAKE_CASE',
    },
    formatting: {
      indentation: config.teamConventions.formatting?.indentation ?? 'spaces',
      indentSize: config.teamConventions.formatting?.indentSize ?? 2,
      maxLineLength: config.teamConventions.formatting?.maxLineLength ?? 100,
      trailingComma: config.teamConventions.formatting?.trailingComma ?? true,
      semicolons: config.teamConventions.formatting?.semicolons ?? true,
    },
    architecture: {
      allowedLayers: config.teamConventions.architecture?.allowedLayers ?? [],
      forbiddenDependencies: config.teamConventions.architecture?.forbiddenDependencies ?? [],
    },
    imports: {
      order: config.teamConventions.imports?.order ?? ['builtin', 'external', 'internal', 'relative'],
      groupSeparator: config.teamConventions.imports?.groupSeparator ?? true,
    },
  };

  return {
    userProfile,
    teamConventions,
    artifactTypes,
    steeringCategories,
  };
}
