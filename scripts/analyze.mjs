#!/usr/bin/env node
// CLI Wrapper: Run analysis on any project directory.
//
// Usage:
//   node scripts/analyze.mjs <project-path>            # Analysis only, prints JSON
//   node scripts/analyze.mjs <project-path> --generate # Also generates artifacts
//   node scripts/analyze.mjs <project-path> --summary  # Compact summary instead of full JSON
//
// Run after `npm run build`.

import { runAnalysis, runGeneration } from '../dist/pipeline.js';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const projectPath = args.find((a) => !a.startsWith('--'));
const shouldGenerate = args.includes('--generate');
const summaryOnly = args.includes('--summary');

if (!projectPath) {
  console.error('Usage: node scripts/analyze.mjs <project-path> [--generate] [--summary]');
  process.exit(1);
}

const rootPath = resolve(projectPath);

async function reportProgress(message, progress, total) {
  process.stderr.write(`[${progress}/${total}] ${message}\n`);
}

console.error(`Analyzing: ${rootPath}\n`);

const { result } = await runAnalysis({ rootPath, reportProgress });

if (summaryOnly) {
  console.log(JSON.stringify({
    summary: result.summary,
    languageDistribution: result.structure.statistics.languageDistribution.slice(0, 5),
    detectedPatterns: result.patterns.patterns.map((p) => ({
      type: p.type,
      confidence: p.confidence,
      isDominant: p.isDominant,
      matchingFeatures: p.matchingFeatures,
    })),
    apiCount: result.apis.restEndpoints.length,
    entityCount: result.dataModels.entities.length,
    buildTool: result.buildPipeline.buildTool?.name,
    scriptCount: result.buildPipeline.scripts.length,
    dependencyCount: result.buildPipeline.dependencies.length,
    warnings: result.warnings.length,
  }, null, 2));
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (shouldGenerate) {
  console.error('\nGenerating artifacts...');
  const genResult = await runGeneration({
    rootPath,
    analysis: result,
    conflictStrategy: 'skip',
  });
  console.error(`\nGenerated ${genResult.generatedFiles.length} files, ${genResult.conflicts.length} conflicts.\n`);
  for (const f of genResult.generatedFiles) {
    console.error(`  + ${f.path}`);
  }
  if (genResult.conflicts.length > 0) {
    console.error('\nSkipped due to conflicts:');
    for (const c of genResult.conflicts) {
      console.error(`  ! ${c.path} (${c.reason})`);
    }
  }
}
