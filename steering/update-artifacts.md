---
inclusion: manual
---

# Workflow: Update Artifacts After Code Changes

This workflow describes how to keep the generated steering files, skills, and architecture documentation up to date after code changes — without losing your manual customizations.

## When to run

- After significant code changes (new modules, refactorings, new dependencies)
- After updating team conventions
- On a regular cadence (e.g., weekly) for hygiene
- When you suspect Kiro is using outdated assumptions about the project

## Step 1: Incremental analysis

Instead of a full analysis, an incremental run is enough — the Power compares file hashes against the last state and inspects only the changed files:

```
analyze_codebase with:
  rootPath: "<project path>"
  incremental: true
```

This is significantly faster, especially in large projects. If no previous analysis exists, the Power automatically falls back to a full analysis.

## Step 2: Inspect the diff

In the analysis result you'll find hints about changes:
- New architecture patterns or changed confidence
- New or modified API endpoints
- New entities or relationships
- Changed build scripts or dependencies

If nothing relevant changed, you can skip artifact generation.

## Step 3: Selective artifact updates

```
generate_artifacts with:
  rootPath: "<project path>"
  analysisResultPath: "<project path>/.cartographer/last-analysis.json"
  conflictStrategy: "skip"
```

`conflictStrategy: "skip"` is the safe default — manually adopted files (header removed) and manually created files are not touched.

If you only want to update specific artifact types:

```
generate_artifacts with:
  artifactTypes: ["steering"]  # only steering files
```

## Step 4: Review conflicts

The response includes a `conflicts` array listing files that were not overwritten:

```json
{
  "conflicts": [
    { "path": ".kiro/steering/architecture.md", "reason": "manual-adopted" },
    { "path": ".kiro/skills/custom-workflow.md", "reason": "manual-file" }
  ]
}
```

Meaning:
- `manual-adopted`: a generated file with the header removed. The Power respects your adoption. If you want auto-updates again, delete the file manually and re-run generation.
- `manual-file`: the file exists but isn't in the manifest. The Power leaves it alone.

## Step 5: Keep manual skills

Skills you wrote yourself (`.kiro/skills/*.md` without the Power header) are never overwritten. You can curate them freely.

If pattern-learning suggests a new skill that already exists manually, the suggestion is listed in the analysis result but not written automatically.

## Self-improving updates

When the self-improvement function is active (see `@pragmion/kiro-learning`):

- **Feedback loop:** corrections on generated skills are collected. After 3+ corrections to the same skill, the skill description is refined.
- **Usage tracking:** rarely used steering files are flagged in the analysis result as "unused" — you can delete or consolidate them.
- **Pattern learning:** recurring new code structures that no existing skill covers are proposed as skill candidates.
- **Correction memory:** if Kiro repeatedly produces code that violates a steering file, the relevant steering file is enriched with extra clarifications.

## Common Scenarios

### A new library was introduced
1. `analyze_codebase` with `focusAreas: ["build-pipeline"]` for targeted dependency detection
2. `generate_artifacts` with `artifactTypes: ["steering"]` and `steeringCategories: ["build-commands"]`

### Architecture refactoring completed
1. `analyze_codebase` without `incremental` (full analysis since many files are touched)
2. Review the generated `architecture.md` and `architecture` steering file — if the previous versions were manually adopted, delete them and regenerate.

### New API endpoints added
1. `analyze_codebase` with `incremental: true` and `focusAreas: ["api"]`
2. If new skill candidates are suggested: confirm via `configure_profile` action, then generate.

## Tips

- **Before important releases:** full analysis + generation, so everything is in sync.
- **Before PRs that touch convention files:** regenerate the steering file from the code instead of editing it manually — that mirrors reality.
- **For onboarding new team members:** the generated `architecture.md` is the fastest entry point.
