// Kiro Cartographer - MCP Server
// Main entry point: registers tools and connects via stdio transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'node:path';

// Analyzers
import { StructureAnalyzer } from './analyzers/structure-analyzer.js';
import { PatternAnalyzer } from './analyzers/pattern-analyzer.js';
import { DataModelAnalyzer } from './analyzers/data-model-analyzer.js';
import { ApiAnalyzer } from './analyzers/api-analyzer.js';
import { ErrorHandlingAnalyzer } from './analyzers/error-handling-analyzer.js';
import { StateAnalyzer } from './analyzers/state-analyzer.js';
import { BuildAnalyzer } from './analyzers/build-analyzer.js';

// Generators
import { SteeringFileGenerator } from './generators/steering-generator.js';
import { SkillGenerator } from './generators/skill-generator.js';
import { DocumentationGenerator } from './generators/documentation-generator.js';
import { ManifestManager } from './generators/manifest-manager.js';

// Config & Cache
import { resolveConfig } from './config/config-manager.js';
import { AnalysisStateCache } from './cache/state-cache.js';
import { safeWriteFile } from './utils/file-system.js';

// Learning
import { CartographerLearning } from './learning/learning-integration.js';

// Types
import type {
  AnalyzeCodebaseOutput,
  AnalysisSummary,
  FocusArea,
  ArtifactType,
  SteeringCategory,
  FileTreeNode,
} from './types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = 'kiro-cartographer';
const SERVER_VERSION = '1.0.0';

const VALID_FOCUS_AREAS: FocusArea[] = [
  'api', 'data-model', 'state-management', 'security', 'error-handling', 'build-pipeline',
];
const VALID_ARTIFACT_TYPES: ArtifactType[] = ['steering', 'skills', 'documentation'];
const VALID_STEERING_CATEGORIES: SteeringCategory[] = [
  'build-commands', 'naming-conventions', 'formatting', 'import-order', 'architecture', 'test-commands',
];

// ─── Input Schemas ──────────────────────────────────────────────────────────

const AnalyzeCodebaseSchema = {
  rootPath: z.string().optional().describe('Project root directory (default: cwd)'),
  incremental: z.boolean().optional().describe('Only analyze changed files (default: false)'),
  focusAreas: z.array(z.enum(['api', 'data-model', 'state-management', 'security', 'error-handling', 'build-pipeline'])).optional(),
  excludePaths: z.array(z.string()).optional().describe('Additional paths to exclude'),
  maxDepth: z.number().int().min(1).max(50).optional().describe('Max directory traversal depth (default: 20)'),
};

const GenerateArtifactsSchema = {
  rootPath: z.string().optional().describe('Project root directory (default: cwd)'),
  artifactTypes: z.array(z.enum(['steering', 'skills', 'documentation'])).optional(),
  steeringCategories: z.array(z.enum(['build-commands', 'naming-conventions', 'formatting', 'import-order', 'architecture', 'test-commands'])).optional(),
  conflictStrategy: z.enum(['ask', 'skip']).optional().describe('How to handle existing files'),
  analysisResultPath: z.string().optional().describe('Path to a saved analysis result JSON'),
};

const ConfigureProfileSchema = {
  action: z.enum(['validate', 'show', 'init']),
  profileType: z.enum(['user', 'team', 'analysis']),
  rootPath: z.string().optional().describe('Project root directory (default: cwd)'),
};

const RecordFeedbackSchema = {
  rootPath: z.string().optional().describe('Project root directory (default: cwd)'),
  type: z.enum(['skill-correction', 'convention-violation', 'artifact-usage', 'pattern']),
  skillName: z.string().optional().describe('Required for skill-correction'),
  correction: z.string().optional().describe('Required for skill-correction'),
  steeringFile: z.string().optional().describe('Required for convention-violation'),
  rule: z.string().optional().describe('Required for convention-violation'),
  example: z.string().optional().describe('Required for convention-violation'),
  artifactPath: z.string().optional().describe('Required for artifact-usage'),
  patternDescription: z.string().optional().describe('Required for pattern'),
  files: z.array(z.string()).optional().describe('Required for pattern'),
};

// ─── Helper: build AnalysisContext ──────────────────────────────────────────

function makeProgressReporter(server: McpServer) {
  return async (message: string, progress: number, total: number) => {
    // Progress notifications via MCP — best-effort, ignore errors
    try {
      await (server as unknown as { server: { notification: (n: unknown) => Promise<void> } })
        .server.notification({
          method: 'notifications/progress',
          params: { progressToken: 'analysis', progress, total, message },
        });
    } catch {
      // Ignore notification errors
    }
  };
}

// ─── analyze_codebase handler ────────────────────────────────────────────────

async function handleAnalyzeCodebase(
  params: {
    rootPath?: string;
    incremental?: boolean;
    focusAreas?: FocusArea[];
    excludePaths?: string[];
    maxDepth?: number;
  },
  server: McpServer,
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const rootPath = params.rootPath ?? process.cwd();
  const incremental = params.incremental ?? false;
  const focusAreas = params.focusAreas ?? [];
  const excludePaths = params.excludePaths ?? [];
  const maxDepth = params.maxDepth ?? 20;

  const reportProgress = makeProgressReporter(server);

  // Load config
  const { config, warnings: configWarnings } = await resolveConfig(rootPath, {
    focusAreas,
    excludePaths,
    maxDepth,
  });

  // Load state cache
  const cache = new AnalysisStateCache();
  await cache.load(rootPath);

  // Run Structure Analyzer first to get the file tree
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

  // Use the file tree for subsequent analyzers
  const fileTree: FileTreeNode[] = structure.tree.children ?? [];

  const baseContext = { rootPath, fileTree, focusAreas, config, cache, reportProgress };

  // Run remaining analyzers in parallel
  await reportProgress('Analyzing architecture patterns', 20, 100);
  const [patterns, dataModels, apis, errorHandling, stateManagement, buildPipeline] =
    await Promise.all([
      new PatternAnalyzer().analyze(baseContext),
      new DataModelAnalyzer().analyze(baseContext),
      new ApiAnalyzer().analyze(baseContext),
      new ErrorHandlingAnalyzer().analyze(baseContext),
      new StateAnalyzer().analyze(baseContext),
      new BuildAnalyzer().analyze(baseContext),
    ]);

  await reportProgress('Finalizing analysis', 90, 100);

  // Build summary
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
    warnings: [...structure.warnings, ...configWarnings.map(m => ({ path: '', message: m, severity: 'warning' as const }))],
  };

  // Update and save cache
  cache.updateTimestamp();
  await cache.save(rootPath);

  // Load learning state and produce summary (best-effort)
  let learningSummary: Awaited<ReturnType<CartographerLearning['getLearningSummary']>> | null = null;
  try {
    const learning = new CartographerLearning(rootPath);
    learningSummary = await learning.getLearningSummary();
    await learning.save();
  } catch {
    // Learning is optional — never fail the analysis because of it
  }

  await reportProgress('Analysis complete', 100, 100);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(
        learningSummary
          ? { ...result, learning: learningSummary }
          : result,
        null,
        2,
      ),
    }],
  };
}

// ─── generate_artifacts handler ─────────────────────────────────────────────

async function handleGenerateArtifacts(
  params: {
    rootPath?: string;
    artifactTypes?: ArtifactType[];
    steeringCategories?: SteeringCategory[];
    conflictStrategy?: 'ask' | 'skip';
    analysisResultPath?: string;
  },
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const rootPath = params.rootPath ?? process.cwd();
  const artifactTypes = params.artifactTypes ?? VALID_ARTIFACT_TYPES;
  const steeringCategories = params.steeringCategories ?? VALID_STEERING_CATEGORIES;
  const conflictStrategy = params.conflictStrategy ?? 'skip';

  // Load config
  const { config } = await resolveConfig(rootPath);

  // Ensure all required fields are present for GenerationConfig
  // The config manager returns UserProfile and TeamConventions with optional fields,
  // but generators expect all fields to be present (merged with defaults)
  const generationConfig = {
    userProfile: {
      commentStyle: config.userProfile.commentStyle ?? 'jsdoc',
      namingPreference: config.userProfile.namingPreference ?? 'camelCase',
      preferredPatterns: config.userProfile.preferredPatterns ?? [],
      language: config.userProfile.language ?? 'en',
      maxSkillCount: config.userProfile.maxSkillCount ?? 10,
    },
    teamConventions: {
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
    },
    artifactTypes,
    steeringCategories,
  };

  // Load analysis result
  let analysisResult: AnalyzeCodebaseOutput | null = null;
  if (params.analysisResultPath) {
    const { safeReadFile } = await import('./utils/file-system.js');
    const result = await safeReadFile(params.analysisResultPath);
    if (!result.isError) {
      try {
        analysisResult = JSON.parse(result.value) as AnalyzeCodebaseOutput;
      } catch {
        // Invalid JSON — proceed without
      }
    }
  }

  if (!analysisResult) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'No analysis result available. Run analyze_codebase first.',
          generatedFiles: [],
          skippedCategories: [],
          conflicts: [],
          overriddenPreferences: [],
        }),
      }],
    };
  }

  // Load manifest
  const manifestManager = new ManifestManager();
  await manifestManager.loadManifest(rootPath);

  const generatedFiles: { path: string; type: string }[] = [];
  const conflicts: { path: string; reason: string }[] = [];
  const skippedCategories: { category: string; reason: string }[] = [];

  // Run generators
  const generators = [
    new SteeringFileGenerator(),
    new SkillGenerator(),
    new DocumentationGenerator(),
  ];

  for (const generator of generators) {
    if (!generator.canGenerate(analysisResult)) continue;

    const files = await generator.generate(analysisResult, generationConfig);

    for (const file of files) {
      const outputPath = manifestManager.getOutputPath(file.path);
      const fullPath = join(rootPath, outputPath);

      // Check for conflicts
      const conflict = await manifestManager.checkConflict(rootPath, outputPath);
      if (conflict !== 'none') {
        if (conflictStrategy === 'skip') {
          conflicts.push({ path: outputPath, reason: conflict });
          continue;
        }
        // 'ask' strategy — for now skip (MCP confirmation not yet implemented)
        conflicts.push({ path: outputPath, reason: conflict });
        continue;
      }

      // Write file
      const result = await safeWriteFile(fullPath, file.content);
      if (!result.isError) {
        manifestManager.addEntry({ ...file, path: outputPath });
        generatedFiles.push({ path: outputPath, type: file.type });
      }
    }
  }

  // Save manifest
  await manifestManager.saveManifest(rootPath);

  // Compute overridden preferences
  const overriddenPreferences = config.overriddenFields.map(field => ({
    field,
    userValue: String((config.userProfile as Record<string, unknown>)[field] ?? ''),
    teamValue: 'team-defined',
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        generatedFiles,
        skippedCategories,
        conflicts,
        overriddenPreferences,
      }, null, 2),
    }],
  };
}

// ─── configure_profile handler ───────────────────────────────────────────────

async function handleConfigureProfile(
  params: {
    action: 'validate' | 'show' | 'init';
    profileType: 'user' | 'team' | 'analysis';
    rootPath?: string;
  },
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const rootPath = params.rootPath ?? process.cwd();
  const { action, profileType } = params;

  if (action === 'show') {
    const { config, warnings } = await resolveConfig(rootPath);
    const profile = profileType === 'user' ? config.userProfile
      : profileType === 'team' ? config.teamConventions
      : config.analysisProfile;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ status: 'shown', profile, warnings }, null, 2),
      }],
    };
  }

  if (action === 'validate') {
    const { warnings } = await resolveConfig(rootPath);
    const isValid = warnings.length === 0;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: isValid ? 'valid' : 'invalid',
          warnings,
        }, null, 2),
      }],
    };
  }

  if (action === 'init') {
    const templates: Record<string, string> = {
      user: `# User Profile for Kiro Cartographer
# Place at: ~/.cartographer/user-profile.yaml

commentStyle: jsdoc        # jsdoc | inline | minimal | verbose
namingPreference: camelCase # camelCase | snake_case | PascalCase | kebab-case
language: en               # Language for generated texts
maxSkillCount: 10          # Maximum number of generated skills
`,
      team: `# Team Conventions for Kiro Cartographer
# Place at: .cartographer/team-conventions.yaml

naming:
  files: kebab-case        # camelCase | kebab-case | PascalCase | snake_case
  variables: camelCase     # camelCase | snake_case
  classes: PascalCase
  constants: UPPER_SNAKE_CASE

formatting:
  indentation: spaces
  indentSize: 2
  maxLineLength: 100
  trailingComma: true
  semicolons: true

imports:
  order: [builtin, external, internal, relative]
  groupSeparator: true
`,
      analysis: `# Analysis Profile for Kiro Cartographer
# Place at: .cartographer/analysis-profile.yaml

focusAreas:
  - api
  - data-model
  - build-pipeline

excludePaths: []
maxDepth: 20
includeCodeExamples: false
`,
    };

    const template = templates[profileType];
    const fileName = profileType === 'user' ? 'user-profile.yaml'
      : profileType === 'team' ? 'team-conventions.yaml'
      : 'analysis-profile.yaml';

    const outputPath = join(rootPath, '.cartographer', fileName);
    await safeWriteFile(outputPath, template);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'created',
          path: outputPath,
          message: `Template created at ${outputPath}. Edit it to customize your settings.`,
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: `Unknown action: ${action}` }),
    }],
  };
}

// ─── record_feedback handler ────────────────────────────────────────────────

async function handleRecordFeedback(
  params: {
    rootPath?: string;
    type: 'skill-correction' | 'convention-violation' | 'artifact-usage' | 'pattern';
    skillName?: string;
    correction?: string;
    steeringFile?: string;
    rule?: string;
    example?: string;
    artifactPath?: string;
    patternDescription?: string;
    files?: string[];
  },
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const rootPath = params.rootPath ?? process.cwd();
  const learning = new CartographerLearning(rootPath);

  switch (params.type) {
    case 'skill-correction': {
      if (!params.skillName || !params.correction) {
        return errorResponse('skill-correction requires skillName and correction');
      }
      await learning.recordSkillCorrection(params.skillName, params.correction);
      break;
    }
    case 'convention-violation': {
      if (!params.steeringFile || !params.rule || !params.example) {
        return errorResponse('convention-violation requires steeringFile, rule, and example');
      }
      await learning.recordConventionViolation(params.steeringFile, params.rule, params.example);
      break;
    }
    case 'artifact-usage': {
      if (!params.artifactPath) {
        return errorResponse('artifact-usage requires artifactPath');
      }
      await learning.recordArtifactUsage(params.artifactPath);
      break;
    }
    case 'pattern': {
      if (!params.patternDescription || !params.files || params.files.length === 0) {
        return errorResponse('pattern requires patternDescription and non-empty files');
      }
      await learning.recordPattern(params.patternDescription, params.files);
      break;
    }
  }

  await learning.save();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ status: 'recorded', type: params.type }, null, 2),
    }],
  };
}

function errorResponse(message: string): { content: [{ type: 'text'; text: string }] } {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
  };
}

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

// Register analyze_codebase tool
server.tool(
  'analyze_codebase',
  'Analyzes a codebase and returns structured information about its architecture, patterns, APIs, data models, error handling, state management, and build pipeline.',
  AnalyzeCodebaseSchema,
  async (params) => {
    try {
      return await handleAnalyzeCodebase(params as Parameters<typeof handleAnalyzeCodebase>[0], server);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error during analysis: ${message}` }],
        isError: true,
      };
    }
  },
);

// Register generate_artifacts tool
server.tool(
  'generate_artifacts',
  'Generates Kiro artifacts (steering files, skills, documentation) from a previous analysis result.',
  GenerateArtifactsSchema,
  async (params) => {
    try {
      return await handleGenerateArtifacts(params as Parameters<typeof handleGenerateArtifacts>[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error generating artifacts: ${message}` }],
        isError: true,
      };
    }
  },
);

// Register configure_profile tool
server.tool(
  'configure_profile',
  'Validates, shows, or initializes configuration profiles (user, team, or analysis).',
  ConfigureProfileSchema,
  async (params) => {
    try {
      return await handleConfigureProfile(params as Parameters<typeof handleConfigureProfile>[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error configuring profile: ${message}` }],
        isError: true,
      };
    }
  },
);

// Register record_feedback tool
server.tool(
  'record_feedback',
  'Records feedback for self-improvement: skill corrections, convention violations, artifact usage, or detected patterns. Powers the learning loop that improves generated artifacts over time.',
  RecordFeedbackSchema,
  async (params) => {
    try {
      return await handleRecordFeedback(params as Parameters<typeof handleRecordFeedback>[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error recording feedback: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
