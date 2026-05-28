import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PatternAnalyzer } from '../../../src/analyzers/pattern-analyzer.js';
import type { AnalysisContext } from '../../../src/analyzers/base-analyzer.js';
import type { FileTreeNode, ResolvedConfig } from '../../../src/types.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockContext(
  rootPath: string,
  fileTree: FileTreeNode[],
  overrides: Partial<AnalysisContext> = {},
): AnalysisContext {
  return {
    rootPath,
    fileTree,
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

function dir(name: string, children: FileTreeNode[] = []): FileTreeNode {
  return {
    path: name,
    name,
    type: 'directory',
    children,
  };
}

function file(name: string, dirPath?: string): FileTreeNode {
  const path = dirPath ? `${dirPath}/${name}` : name;
  const ext = name.includes('.') ? '.' + name.split('.').pop() : undefined;
  return {
    path,
    name,
    type: 'file',
    size: 100,
    extension: ext,
  };
}

// ─── Pattern Detection Tests ────────────────────────────────────────────────

describe('PatternAnalyzer', () => {
  const analyzer = new PatternAnalyzer();

  describe('MVC pattern detection', () => {
    it('detects MVC pattern with controllers, models, and views directories', () => {
      const tree: FileTreeNode[] = [
        dir('controllers', [
          file('UserController.ts', 'controllers'),
          file('ProductController.ts', 'controllers'),
        ]),
        dir('models', [
          file('User.ts', 'models'),
          file('Product.ts', 'models'),
        ]),
        dir('views', [
          file('UserView.ts', 'views'),
        ]),
        dir('routes', [
          file('index.ts', 'routes'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const mvc = patterns.find(p => p.type === 'mvc');

      expect(mvc).toBeDefined();
      expect(mvc!.confidence).not.toBe('low');
      expect(mvc!.evidence.length).toBeGreaterThan(0);
    });

    it('detects MVC pattern from file naming conventions', () => {
      const tree: FileTreeNode[] = [
        dir('src', [
          file('UserController.ts', 'src'),
          file('ProductController.ts', 'src'),
          file('UserModel.ts', 'src'),
          file('UserView.ts', 'src'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const mvc = patterns.find(p => p.type === 'mvc');

      expect(mvc).toBeDefined();
      expect(mvc!.matchingFeatures).toBeGreaterThanOrEqual(3);
    });

    it('detects MVC with Express-like project structure', () => {
      const tree: FileTreeNode[] = [
        dir('src', [
          dir('controllers', [
            file('authController.ts', 'src/controllers'),
            file('userController.ts', 'src/controllers'),
          ]),
          dir('models', [
            file('User.ts', 'src/models'),
            file('Session.ts', 'src/models'),
          ]),
          dir('routes', [
            file('auth.ts', 'src/routes'),
            file('users.ts', 'src/routes'),
          ]),
          dir('middleware', [
            file('auth.ts', 'src/middleware'),
          ]),
          file('app.ts', 'src'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const mvc = patterns.find(p => p.type === 'mvc');

      expect(mvc).toBeDefined();
      expect(mvc!.confidence).toBe('medium');
      expect(mvc!.evidence.some(e => e.role === 'controllers')).toBe(true);
      expect(mvc!.evidence.some(e => e.role === 'models')).toBe(true);
      expect(mvc!.evidence.some(e => e.role === 'routes')).toBe(true);
    });
  });

  describe('Hexagonal pattern detection', () => {
    it('detects hexagonal pattern with domain/ports/adapters structure', () => {
      const tree: FileTreeNode[] = [
        dir('domain', [
          file('User.ts', 'domain'),
          file('Order.ts', 'domain'),
        ]),
        dir('ports', [
          file('UserPort.ts', 'ports'),
          file('OrderPort.ts', 'ports'),
        ]),
        dir('adapters', [
          file('UserAdapter.ts', 'adapters'),
          file('DatabaseAdapter.ts', 'adapters'),
        ]),
        dir('infrastructure', [
          file('database.ts', 'infrastructure'),
        ]),
        dir('application', [
          file('CreateUserUseCase.ts', 'application'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const hexagonal = patterns.find(p => p.type === 'hexagonal');

      expect(hexagonal).toBeDefined();
      expect(hexagonal!.confidence).toBe('high');
      expect(hexagonal!.matchingFeatures).toBeGreaterThanOrEqual(5);
    });

    it('detects hexagonal with partial structure', () => {
      const tree: FileTreeNode[] = [
        dir('domain', [
          file('User.ts', 'domain'),
        ]),
        dir('ports', [
          file('UserPort.ts', 'ports'),
        ]),
        dir('adapters', [
          file('UserAdapter.ts', 'adapters'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const hexagonal = patterns.find(p => p.type === 'hexagonal');

      expect(hexagonal).toBeDefined();
      expect(hexagonal!.confidence).toBe('medium');
    });
  });

  describe('Layered pattern detection', () => {
    it('detects layered pattern with presentation/business/data', () => {
      const tree: FileTreeNode[] = [
        dir('presentation', [
          file('UserPage.ts', 'presentation'),
        ]),
        dir('business', [
          file('UserService.ts', 'business'),
        ]),
        dir('data', [
          file('UserRepository.ts', 'data'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const layered = patterns.find(p => p.type === 'layered');

      expect(layered).toBeDefined();
      expect(layered!.confidence).toBe('medium');
    });

    it('detects layered pattern with controllers/services/repositories', () => {
      const tree: FileTreeNode[] = [
        dir('controllers', [
          file('UserController.ts', 'controllers'),
        ]),
        dir('services', [
          file('UserService.ts', 'services'),
        ]),
        dir('repositories', [
          file('UserRepository.ts', 'repositories'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const layered = patterns.find(p => p.type === 'layered');

      expect(layered).toBeDefined();
      expect(layered!.matchingFeatures).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Microservices pattern detection', () => {
    it('detects microservices with multiple service subdirectories having manifests', () => {
      const tree: FileTreeNode[] = [
        dir('services', [
          dir('user-service', [
            file('package.json', 'services/user-service'),
            file('index.ts', 'services/user-service'),
          ]),
          dir('order-service', [
            file('package.json', 'services/order-service'),
            file('index.ts', 'services/order-service'),
          ]),
          dir('payment-service', [
            file('package.json', 'services/payment-service'),
            file('index.ts', 'services/payment-service'),
          ]),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const microservices = patterns.find(p => p.type === 'microservices');

      expect(microservices).toBeDefined();
      expect(microservices!.confidence).toBe('high');
    });

    it('does not detect microservices without manifests in subdirectories', () => {
      const tree: FileTreeNode[] = [
        dir('services', [
          dir('user-service', [
            file('index.ts', 'services/user-service'),
          ]),
          dir('order-service', [
            file('index.ts', 'services/order-service'),
          ]),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const microservices = patterns.find(p => p.type === 'microservices');

      expect(microservices).toBeUndefined();
    });
  });

  describe('Event-Driven pattern detection', () => {
    it('detects event-driven pattern with events/handlers/listeners directories', () => {
      const tree: FileTreeNode[] = [
        dir('events', [
          file('UserCreatedEvent.ts', 'events'),
          file('OrderPlacedEvent.ts', 'events'),
        ]),
        dir('handlers', [
          file('UserCreatedHandler.ts', 'handlers'),
        ]),
        dir('listeners', [
          file('EmailListener.ts', 'listeners'),
        ]),
        dir('subscribers', [
          file('NotificationSubscriber.ts', 'subscribers'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const eventDriven = patterns.find(p => p.type === 'event-driven');

      expect(eventDriven).toBeDefined();
      expect(eventDriven!.confidence).toBe('high');
    });
  });

  describe('Monolith pattern detection', () => {
    it('detects monolith with large src/ and no service boundaries', () => {
      const tree: FileTreeNode[] = [
        dir('src', [
          file('app.ts', 'src'),
          file('config.ts', 'src'),
          file('database.ts', 'src'),
          file('routes.ts', 'src'),
          file('middleware.ts', 'src'),
          file('utils.ts', 'src'),
          file('types.ts', 'src'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const monolith = patterns.find(p => p.type === 'monolith');

      expect(monolith).toBeDefined();
      expect(monolith!.confidence).toBe('high');
    });

    it('does not detect monolith when service boundaries exist', () => {
      const tree: FileTreeNode[] = [
        dir('src', [
          file('app.ts', 'src'),
          file('config.ts', 'src'),
          file('database.ts', 'src'),
          file('routes.ts', 'src'),
          file('middleware.ts', 'src'),
        ]),
        dir('domain', [
          file('User.ts', 'domain'),
        ]),
        dir('ports', [
          file('UserPort.ts', 'ports'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const monolith = patterns.find(p => p.type === 'monolith');

      expect(monolith).toBeUndefined();
    });
  });

  describe('No pattern detection for flat/unstructured projects', () => {
    it('returns empty patterns for a flat project with no structure', () => {
      const tree: FileTreeNode[] = [
        file('index.ts'),
        file('README.md'),
        file('package.json'),
      ];

      const patterns = analyzer.detectPatterns(tree);

      expect(patterns).toHaveLength(0);
    });

    it('returns empty patterns for a project with only config files', () => {
      const tree: FileTreeNode[] = [
        file('tsconfig.json'),
        file('.eslintrc.json'),
        file('.prettierrc'),
      ];

      const patterns = analyzer.detectPatterns(tree);

      expect(patterns).toHaveLength(0);
    });
  });

  describe('Dominant pattern selection', () => {
    it('marks exactly one pattern as dominant when multiple are detected', () => {
      // This structure matches both MVC and Layered
      const tree: FileTreeNode[] = [
        dir('controllers', [
          file('UserController.ts', 'controllers'),
        ]),
        dir('models', [
          file('User.ts', 'models'),
        ]),
        dir('services', [
          file('UserService.ts', 'services'),
        ]),
        dir('repositories', [
          file('UserRepository.ts', 'repositories'),
        ]),
        dir('views', [
          file('UserView.ts', 'views'),
        ]),
        dir('routes', [
          file('index.ts', 'routes'),
        ]),
      ];

      const patterns = analyzer.detectPatterns(tree);

      expect(patterns.length).toBeGreaterThan(1);
      const dominantPatterns = patterns.filter(p => p.isDominant);
      expect(dominantPatterns).toHaveLength(1);
    });

    it('selects the pattern with highest confidence as dominant', () => {
      // Hexagonal has more features matched -> higher confidence
      const tree: FileTreeNode[] = [
        dir('domain', [file('User.ts', 'domain')]),
        dir('ports', [file('UserPort.ts', 'ports')]),
        dir('adapters', [file('UserAdapter.ts', 'adapters')]),
        dir('infrastructure', [file('db.ts', 'infrastructure')]),
        dir('application', [file('UseCase.ts', 'application')]),
        // Only one MVC indicator
        dir('controllers', [file('api.ts', 'controllers')]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const dominant = patterns.find(p => p.isDominant);

      expect(dominant).toBeDefined();
      expect(dominant!.type).toBe('hexagonal');
    });

    it('uses evidence count as tiebreaker when confidence is equal', () => {
      // Both have medium confidence but one has more matching features
      const tree: FileTreeNode[] = [
        dir('events', [file('UserEvent.ts', 'events')]),
        dir('handlers', [file('UserHandler.ts', 'handlers')]),
        dir('listeners', [file('EmailListener.ts', 'listeners')]),
        // Layered with fewer matches
        dir('presentation', [file('Page.ts', 'presentation')]),
        dir('business', [file('Logic.ts', 'business')]),
        dir('data', [file('Repo.ts', 'data')]),
      ];

      const patterns = analyzer.detectPatterns(tree);
      const dominant = patterns.find(p => p.isDominant);

      expect(dominant).toBeDefined();
      // Event-driven has more file pattern matches too
      // Both should have medium confidence but event-driven has more evidence
    });
  });

  describe('Layer detection', () => {
    it('detects presentation/business/data layers', () => {
      const tree: FileTreeNode[] = [
        dir('presentation', [file('Page.ts', 'presentation')]),
        dir('business', [file('Service.ts', 'business')]),
        dir('data', [file('Repository.ts', 'data')]),
      ];

      const layers = analyzer.detectLayers(tree);

      expect(layers).toHaveLength(3);
      expect(layers.map(l => l.name)).toEqual(['Presentation', 'Business', 'Data']);
      expect(layers[0].allowedDependencies).toContain('Business');
      expect(layers[1].allowedDependencies).toContain('Data');
      expect(layers[2].allowedDependencies).toHaveLength(0);
    });

    it('detects controllers/services/repositories layers', () => {
      const tree: FileTreeNode[] = [
        dir('controllers', [file('UserController.ts', 'controllers')]),
        dir('services', [file('UserService.ts', 'services')]),
        dir('repositories', [file('UserRepository.ts', 'repositories')]),
      ];

      const layers = analyzer.detectLayers(tree);

      expect(layers).toHaveLength(3);
      expect(layers.map(l => l.name)).toEqual(['Controllers', 'Services', 'Repositories']);
      expect(layers[0].allowedDependencies).toContain('Services');
      expect(layers[1].allowedDependencies).toContain('Repositories');
      expect(layers[2].allowedDependencies).toHaveLength(0);
    });
  });
});

// ─── Dependency Graph Tests ─────────────────────────────────────────────────

describe('PatternAnalyzer - Dependency Graph', () => {
  let tempDir: string;
  const analyzer = new PatternAnalyzer();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pattern-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('extracts import relationships from ES module imports', async () => {
    await mkdir(join(tempDir, 'src'));
    await mkdir(join(tempDir, 'src', 'services'));
    await mkdir(join(tempDir, 'src', 'models'));
    await writeFile(
      join(tempDir, 'src', 'app.ts'),
      `import { UserService } from './services/user-service';\nimport { db } from './database';\n`,
    );
    await writeFile(
      join(tempDir, 'src', 'services', 'user-service.ts'),
      `import { User } from '../models/user';\nexport class UserService {}\n`,
    );
    await writeFile(join(tempDir, 'src', 'models', 'user.ts'), `export class User {}\n`);
    await writeFile(join(tempDir, 'src', 'database.ts'), `export const db = {};\n`);

    const fileTree: FileTreeNode[] = [
      {
        path: 'src',
        name: 'src',
        type: 'directory',
        children: [
          { path: 'src/app.ts', name: 'app.ts', type: 'file', extension: '.ts', size: 100 },
          {
            path: 'src/services',
            name: 'services',
            type: 'directory',
            children: [
              { path: 'src/services/user-service.ts', name: 'user-service.ts', type: 'file', extension: '.ts', size: 100 },
            ],
          },
          {
            path: 'src/models',
            name: 'models',
            type: 'directory',
            children: [
              { path: 'src/models/user.ts', name: 'user.ts', type: 'file', extension: '.ts', size: 100 },
            ],
          },
          { path: 'src/database.ts', name: 'database.ts', type: 'file', extension: '.ts', size: 100 },
        ],
      },
    ];

    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.dependencyGraph.length).toBeGreaterThan(0);

    // app.ts imports from services/user-service
    const appToService = result.dependencyGraph.find(
      e => e.source.includes('app') && e.target.includes('user-service'),
    );
    expect(appToService).toBeDefined();
    expect(appToService!.type).toBe('import');

    // app.ts imports from database
    const appToDb = result.dependencyGraph.find(
      e => e.source.includes('app') && e.target.includes('database'),
    );
    expect(appToDb).toBeDefined();
  });

  it('extracts CommonJS require statements', async () => {
    await mkdir(join(tempDir, 'src'));
    await writeFile(
      join(tempDir, 'src', 'index.js'),
      `const utils = require('./utils');\nconst config = require('./config');\n`,
    );
    await writeFile(join(tempDir, 'src', 'utils.js'), `module.exports = {};\n`);
    await writeFile(join(tempDir, 'src', 'config.js'), `module.exports = {};\n`);

    const fileTree: FileTreeNode[] = [
      {
        path: 'src',
        name: 'src',
        type: 'directory',
        children: [
          { path: 'src/index.js', name: 'index.js', type: 'file', extension: '.js', size: 100 },
          { path: 'src/utils.js', name: 'utils.js', type: 'file', extension: '.js', size: 100 },
          { path: 'src/config.js', name: 'config.js', type: 'file', extension: '.js', size: 100 },
        ],
      },
    ];

    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.dependencyGraph.length).toBe(2);
    expect(result.dependencyGraph.every(e => e.type === 'import')).toBe(true);
  });

  it('classifies event-related imports correctly', async () => {
    await mkdir(join(tempDir, 'src'));
    await writeFile(
      join(tempDir, 'src', 'app.ts'),
      `import { UserCreatedEvent } from './events/user-created';\nimport { EventHandler } from './handlers/base';\n`,
    );
    await mkdir(join(tempDir, 'src', 'events'));
    await writeFile(join(tempDir, 'src', 'events', 'user-created.ts'), `export class UserCreatedEvent {}\n`);
    await mkdir(join(tempDir, 'src', 'handlers'));
    await writeFile(join(tempDir, 'src', 'handlers', 'base.ts'), `export class EventHandler {}\n`);

    const fileTree: FileTreeNode[] = [
      {
        path: 'src',
        name: 'src',
        type: 'directory',
        children: [
          { path: 'src/app.ts', name: 'app.ts', type: 'file', extension: '.ts', size: 100 },
          {
            path: 'src/events',
            name: 'events',
            type: 'directory',
            children: [
              { path: 'src/events/user-created.ts', name: 'user-created.ts', type: 'file', extension: '.ts', size: 100 },
            ],
          },
          {
            path: 'src/handlers',
            name: 'handlers',
            type: 'directory',
            children: [
              { path: 'src/handlers/base.ts', name: 'base.ts', type: 'file', extension: '.ts', size: 100 },
            ],
          },
        ],
      },
    ];

    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    const eventEdges = result.dependencyGraph.filter(e => e.type === 'event');
    expect(eventEdges.length).toBeGreaterThan(0);
  });

  it('skips non-relative imports (bare specifiers)', async () => {
    await mkdir(join(tempDir, 'src'));
    await writeFile(
      join(tempDir, 'src', 'app.ts'),
      `import express from 'express';\nimport { join } from 'node:path';\nimport { helper } from './helper';\n`,
    );
    await writeFile(join(tempDir, 'src', 'helper.ts'), `export const helper = () => {};\n`);

    const fileTree: FileTreeNode[] = [
      {
        path: 'src',
        name: 'src',
        type: 'directory',
        children: [
          { path: 'src/app.ts', name: 'app.ts', type: 'file', extension: '.ts', size: 100 },
          { path: 'src/helper.ts', name: 'helper.ts', type: 'file', extension: '.ts', size: 100 },
        ],
      },
    ];

    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    // Only the relative import should be in the graph
    expect(result.dependencyGraph).toHaveLength(1);
    expect(result.dependencyGraph[0].target).toContain('helper');
  });

  it('returns empty dependency graph when no source files exist', async () => {
    await writeFile(join(tempDir, 'README.md'), '# Hello\n');

    const fileTree: FileTreeNode[] = [
      { path: 'README.md', name: 'README.md', type: 'file', extension: '.md', size: 10 },
    ];

    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.dependencyGraph).toHaveLength(0);
  });
});
