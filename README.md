# <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/compass.svg" width="28" height="28" alt="compass"> Kiro Cartographer

> A **Kiro Power** that maps any codebase and generates steering files, skills, and architecture docs — so Kiro works like a senior teammate from the first prompt.

[![Kiro Power](https://img.shields.io/badge/⚡_kiro-power-blueviolet)](https://kiro.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/pragmion/kiro-cartographer/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/pragmion/kiro-cartographer/pulls)

---

**A new project takes hours to understand. Kiro Cartographer does it in seconds — and teaches Kiro everything it needs to know.**

Kiro Cartographer is a **Kiro Power** (MCP server) that systematically explores an unfamiliar codebase and produces structured artifacts: steering files, skills, and architecture documentation. Install it in Kiro's Powers panel, run `analyze_codebase`, and Kiro immediately knows your conventions, patterns, and architecture.

* **Deep analysis.** Structure, architecture patterns, data models, APIs, error handling, state management, build pipeline — all extracted automatically.
* **Tailored output.** User profiles and team conventions shape the generated artifacts to match your style.
* **Incremental updates.** After the first full scan, only changed files are re-analyzed. Only affected artifacts are regenerated.
* **Self-improving.** Tracks how artifacts are used and corrected. Skills get better over time. New patterns are suggested automatically.
* **Safe by design.** Your manually created steering files and skills are never touched. Generated files are tracked via manifest and marked with headers.

## Installation

### Via Kiro Powers Panel (recommended)

1. Open Kiro
2. Go to **Powers** panel (sidebar)
3. Click **"Add Power"** → **"From URL"**
4. Paste: `https://github.com/pragmion/kiro-cartographer`
5. Done — the power is ready to use

### Manual Setup

If you prefer to set it up yourself:

```bash
git clone https://github.com/pragmion/kiro-cartographer.git
cd kiro-cartographer
npm install
npm run build
```

Then add to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "kiro-cartographer": {
      "command": "node",
      "args": ["/path/to/kiro-cartographer/dist/server.js"]
    }
  }
}
```

## Tools

### `analyze_codebase`

Performs a full or incremental analysis of the codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `rootPath` | string | cwd | Project root directory |
| `incremental` | boolean | false | Only analyze changed files |
| `focusAreas` | string[] | all | Deep-dive areas: `api`, `data-model`, `state-management`, `security`, `error-handling`, `build-pipeline` |
| `excludePaths` | string[] | [] | Additional paths to exclude |
| `maxDepth` | number | 20 | Maximum directory traversal depth |

### `generate_artifacts`

Generates Kiro artifacts from analysis results.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `artifactTypes` | string[] | all | Types to generate: `steering`, `skills`, `documentation` |
| `steeringCategories` | string[] | all | Categories: `build-commands`, `naming-conventions`, `formatting`, `import-order`, `architecture`, `test-commands` |
| `conflictStrategy` | string | `"ask"` | How to handle existing files: `"ask"` or `"skip"` |

### `configure_profile`

Validates, shows, or initializes configuration profiles.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | One of: `validate`, `show`, `init` |
| `profileType` | string | One of: `user`, `team`, `analysis` |

### `record_feedback`

Records feedback for self-improvement: skill corrections, convention violations, artifact usage, or detected patterns. Powers the learning loop that improves generated artifacts over time.

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | One of: `skill-correction`, `convention-violation`, `artifact-usage`, `pattern` |
| `skillName` / `correction` | string | For `skill-correction` |
| `steeringFile` / `rule` / `example` | string | For `convention-violation` |
| `artifactPath` | string | For `artifact-usage` |
| `patternDescription` / `files` | string / string[] | For `pattern` |

## What Gets Analyzed

| Area | What's Extracted |
|------|-----------------|
| **Structure** | Directory layout, file categories, language distribution |
| **Patterns** | MVC, Hexagonal, Microservices, Layered, Event-Driven — with confidence scores |
| **Data Models** | Entities, DTOs, relationships, schema discrepancies |
| **APIs** | REST, GraphQL, gRPC, WebSocket endpoints |
| **Error Handling** | Patterns, hierarchies, logging strategies |
| **State** | Redux, Zustand, Context, MobX, Signals |
| **Build** | Tools, scripts, CI/CD configs, dependencies |

## What Gets Generated

| Artifact | Location | Content |
|----------|----------|---------|
| **Steering Files** | `.kiro/steering/` | Coding standards, build commands, architecture conventions |
| **Skills** | `.kiro/skills/` | Repeatable patterns as step-by-step guides |
| **Documentation** | `.kiro/docs/` | Architecture overview with modules, flows, decisions |

## Configuration

Three layers, highest priority first:

1. **Team conventions** — `.cartographer/team-conventions.yaml`
2. **User profile** — `~/.cartographer/user-profile.yaml` (global) or project-local fallback
3. **Built-in defaults**

<details>
<summary>User Profile Example</summary>

```yaml
# ~/.cartographer/user-profile.yaml
commentStyle: jsdoc
namingPreference: camelCase
language: de
maxSkillCount: 10
preferredPatterns:
  - hexagonal
  - event-driven
```

</details>

<details>
<summary>Team Conventions Example</summary>

```yaml
# .cartographer/team-conventions.yaml
naming:
  files: kebab-case
  variables: camelCase
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
architecture:
  allowedLayers: [presentation, application, domain, infrastructure]
  forbiddenDependencies:
    - { from: domain, to: infrastructure }
    - { from: domain, to: presentation }
```

</details>

## Artifact Safety

Generated files are tracked in `.kiro/.generated-manifest.json` and marked with a header:

```markdown
<!-- Generated by Kiro Cartographer v1.0.0 | Do not edit manually -->
```

- ✅ Your manually created files are never touched
- ✅ Remove the header → file becomes "manually adopted", won't be overwritten
- ✅ Use `outputSubdirectory: 'generated'` to keep generated files separate

## Self-Improvement

Kiro Cartographer learns from how you work and gets better over time:

**Feedback Loop** — When Kiro uses a generated skill and you correct the output, the correction is recorded. On the next `generate_artifacts` run, affected skills are refined based on accumulated feedback.

**Usage Tracking** — Which steering files does Kiro load frequently? Which skills are never triggered? Low-usage artifacts get deprioritized or flagged for review. High-usage ones get more detail.

**Pattern Learning** — If you repeatedly perform similar tasks that no existing skill covers, Kiro Cartographer detects the emerging pattern and suggests a new skill after ≥3 occurrences.

**Correction Memory** — When Kiro generates code that doesn't match conventions and you fix it, the relevant steering file is tightened to prevent the same mistake.

All learning data is stored locally in `.cartographer/learning-state.json`. Nothing leaves your machine.

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run tests (Vitest + fast-check)
npm start          # Start MCP server
```

## License

MIT
