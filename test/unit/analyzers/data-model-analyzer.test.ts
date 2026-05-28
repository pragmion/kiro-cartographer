import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DataModelAnalyzer } from '../../../src/analyzers/data-model-analyzer.js';
import type { AnalysisContext } from '../../../src/analyzers/base-analyzer.js';
import type { ResolvedConfig, FileTreeNode } from '../../../src/types.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockContext(
  rootPath: string,
  fileTree: FileTreeNode[] = [],
  overrides: Partial<AnalysisContext> = {}
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

function createFileTree(files: Array<{ path: string; name: string }>): FileTreeNode[] {
  const tree: FileTreeNode[] = [];
  
  for (const file of files) {
    const parts = file.path.split('/');
    let current = tree;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      let node = current.find(n => n.name === part);
      if (!node) {
        node = {
          path: parts.slice(0, i + 1).join('/'),
          name: part,
          type: isLast ? 'file' : 'directory',
          children: isLast ? undefined : [],
        };
        current.push(node);
      }
      
      if (!isLast && node.children) {
        current = node.children;
      }
    }
  }
  
  return tree;
}

// ─── TypeORM Entity Detection Tests ─────────────────────────────────────────

describe('DataModelAnalyzer - TypeORM Entity Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data-model-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects TypeORM entities with @Entity decorator', async () => {
    const entityContent = `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  email?: string;
}
`;

    await mkdir(join(tempDir, 'src', 'entities'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'entities', 'user.entity.ts'), entityContent);

    const fileTree = createFileTree([
      { path: 'src/entities/user.entity.ts', name: 'user.entity.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.noModelsFound).toBe(false);
    expect(result.entities).toHaveLength(1);
    
    const entity = result.entities[0];
    expect(entity.name).toBe('User');
    expect(entity.type).toBe('entity');
    expect(entity.detectionMethod).toBe('orm-annotation');
    expect(entity.filePath).toContain('user.entity.ts');
    expect(entity.fields).toHaveLength(3);
    
    const nameField = entity.fields.find(f => f.name === 'name');
    expect(nameField).toBeDefined();
    expect(nameField!.dataType).toBe('string');
    expect(nameField!.isRequired).toBe(true);
    
    const emailField = entity.fields.find(f => f.name === 'email');
    expect(emailField).toBeDefined();
    expect(emailField!.isRequired).toBe(false);
  });

  it('extracts field constraints from validation decorators', async () => {
    const entityContent = `
import { Entity, Column } from 'typeorm';
import { IsNotEmpty, MaxLength, Min, Max, IsEnum, Matches } from 'class-validator';

enum UserRole {
  ADMIN = 'admin',
  USER = 'user'
}

@Entity()
export class User {
  @Column()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @Column()
  @Min(18)
  @Max(120)
  age: number;

  @Column()
  @IsEnum(UserRole)
  role: UserRole;

  @Column()
  @Matches(/^[a-z0-9]+$/)
  username: string;
}
`;

    await mkdir(join(tempDir, 'src', 'entities'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'entities', 'user.entity.ts'), entityContent);

    const fileTree = createFileTree([
      { path: 'src/entities/user.entity.ts', name: 'user.entity.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    const entity = result.entities[0];
    
    const nameField = entity.fields.find(f => f.name === 'name');
    expect(nameField!.constraints).toContainEqual({ type: 'length', value: '50' });
    
    const ageField = entity.fields.find(f => f.name === 'age');
    expect(ageField!.constraints).toContainEqual({ type: 'range', value: '18..120' });
    
    const roleField = entity.fields.find(f => f.name === 'role');
    expect(roleField!.constraints).toContainEqual({ type: 'enum', value: 'UserRole' });
    
    const usernameField = entity.fields.find(f => f.name === 'username');
    expect(usernameField!.constraints).toContainEqual({ type: 'pattern', value: '^[a-z0-9]+$' });
  });

  it('extracts relationships from TypeORM decorators', async () => {
    const userEntity = `
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Post } from './post.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @OneToMany(() => Post, post => post.author)
  posts: Post[];
}
`;

    const postEntity = `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @ManyToOne(() => User, user => user.posts)
  author: User;
}
`;

    await mkdir(join(tempDir, 'src', 'entities'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'entities', 'user.entity.ts'), userEntity);
    await writeFile(join(tempDir, 'src', 'entities', 'post.entity.ts'), postEntity);

    const fileTree = createFileTree([
      { path: 'src/entities/user.entity.ts', name: 'user.entity.ts' },
      { path: 'src/entities/post.entity.ts', name: 'post.entity.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.relationships).toHaveLength(2);
    
    const userPostRel = result.relationships.find(
      r => r.sourceEntity === 'User' && r.targetEntity === 'Post'
    );
    expect(userPostRel).toBeDefined();
    expect(userPostRel!.type).toBe('1:N');
    expect(userPostRel!.sourceField).toBe('posts');
    
    const postUserRel = result.relationships.find(
      r => r.sourceEntity === 'Post' && r.targetEntity === 'User'
    );
    expect(postUserRel).toBeDefined();
    expect(postUserRel!.type).toBe('1:N');
    expect(postUserRel!.sourceField).toBe('author');
  });
});

// ─── Prisma Schema Detection Tests ──────────────────────────────────────────

describe('DataModelAnalyzer - Prisma Schema Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data-model-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects Prisma models and fields', async () => {
    const schemaContent = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
}
`;

    await mkdir(join(tempDir, 'prisma'), { recursive: true });
    await writeFile(join(tempDir, 'prisma', 'schema.prisma'), schemaContent);

    const fileTree = createFileTree([
      { path: 'prisma/schema.prisma', name: 'schema.prisma' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.noModelsFound).toBe(false);
    expect(result.entities).toHaveLength(2);
    expect(result.searchedSources).toContain('prisma/schema.prisma');
    
    const userEntity = result.entities.find(e => e.name === 'User');
    expect(userEntity).toBeDefined();
    expect(userEntity!.type).toBe('entity');
    expect(userEntity!.detectionMethod).toBe('schema-definition');
    
    const emailField = userEntity!.fields.find(f => f.name === 'email');
    expect(emailField).toBeDefined();
    expect(emailField!.dataType).toBe('String');
    expect(emailField!.isRequired).toBe(true);
    expect(emailField!.constraints).toContainEqual({ type: 'unique', value: 'true' });
    
    const nameField = userEntity!.fields.find(f => f.name === 'name');
    expect(nameField).toBeDefined();
    expect(nameField!.isRequired).toBe(false);
  });

  it('extracts relationships from Prisma schema', async () => {
    const schemaContent = `
model User {
  id    Int    @id
  posts Post[]
}

model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
}
`;

    await mkdir(join(tempDir, 'prisma'), { recursive: true });
    await writeFile(join(tempDir, 'prisma', 'schema.prisma'), schemaContent);

    const fileTree = createFileTree([
      { path: 'prisma/schema.prisma', name: 'schema.prisma' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.relationships).toHaveLength(2);
    
    const userPostRel = result.relationships.find(
      r => r.sourceEntity === 'User' && r.targetEntity === 'Post'
    );
    expect(userPostRel).toBeDefined();
    expect(userPostRel!.type).toBe('1:N');
    expect(userPostRel!.sourceField).toBe('posts');
    
    const postUserRel = result.relationships.find(
      r => r.sourceEntity === 'Post' && r.targetEntity === 'User'
    );
    expect(postUserRel).toBeDefined();
    expect(postUserRel!.type).toBe('1:1');
    expect(postUserRel!.sourceField).toBe('author');
  });
});

// ─── Naming Convention Detection Tests ──────────────────────────────────────

describe('DataModelAnalyzer - Naming Convention Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data-model-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects entities by .entity.ts naming convention', async () => {
    const entityContent = `
export class Product {
  id: number;
  name: string;
  price: number;
}
`;

    await mkdir(join(tempDir, 'src', 'domain'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'domain', 'product.entity.ts'), entityContent);

    const fileTree = createFileTree([
      { path: 'src/domain/product.entity.ts', name: 'product.entity.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.entities).toHaveLength(1);
    const entity = result.entities[0];
    expect(entity.name).toBe('Product');
    expect(entity.type).toBe('entity');
    expect(entity.detectionMethod).toBe('naming-convention');
    expect(entity.fields).toHaveLength(3);
  });

  it('detects DTOs by .dto.ts naming convention', async () => {
    const dtoContent = `
export class CreateUserDto {
  name: string;
  email: string;
  password: string;
}
`;

    await mkdir(join(tempDir, 'src', 'dtos'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'dtos', 'create-user.dto.ts'), dtoContent);

    const fileTree = createFileTree([
      { path: 'src/dtos/create-user.dto.ts', name: 'create-user.dto.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.entities).toHaveLength(1);
    const dto = result.entities[0];
    expect(dto.name).toBe('CreateUserDto');
    expect(dto.type).toBe('dto');
    expect(dto.detectionMethod).toBe('naming-convention');
  });

  it('detects value objects by .vo.ts naming convention', async () => {
    const voContent = `
export class Email {
  constructor(private readonly value: string) {}
  
  getValue(): string {
    return this.value;
  }
}
`;

    await mkdir(join(tempDir, 'src', 'value-objects'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'value-objects', 'email.vo.ts'), voContent);

    const fileTree = createFileTree([
      { path: 'src/value-objects/email.vo.ts', name: 'email.vo.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.entities).toHaveLength(1);
    const vo = result.entities[0];
    expect(vo.name).toBe('Email');
    expect(vo.type).toBe('value-object');
    expect(vo.detectionMethod).toBe('naming-convention');
  });

  it('detects interfaces and types by naming convention', async () => {
    const typeContent = `
export interface User {
  id: number;
  name: string;
  email?: string;
}

export type Product = {
  id: string;
  title: string;
  price: number;
};
`;

    await mkdir(join(tempDir, 'src', 'models'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'models', 'user.model.ts'), typeContent);

    const fileTree = createFileTree([
      { path: 'src/models/user.model.ts', name: 'user.model.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.entities).toHaveLength(2);
    
    const userEntity = result.entities.find(e => e.name === 'User');
    expect(userEntity).toBeDefined();
    expect(userEntity!.type).toBe('entity');
    expect(userEntity!.detectionMethod).toBe('naming-convention');
    
    const productEntity = result.entities.find(e => e.name === 'Product');
    expect(productEntity).toBeDefined();
    expect(productEntity!.type).toBe('entity');
  });
});

// ─── Mongoose Schema Detection Tests ────────────────────────────────────────

describe('DataModelAnalyzer - Mongoose Schema Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data-model-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects Mongoose schemas', async () => {
    const schemaContent = `
import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  age: { type: Number, min: 18 }
});

export const User = model('User', userSchema);
`;

    await mkdir(join(tempDir, 'src', 'models'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'models', 'user.model.ts'), schemaContent);

    const fileTree = createFileTree([
      { path: 'src/models/user.model.ts', name: 'user.model.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.entities).toHaveLength(1);
    const entity = result.entities[0];
    expect(entity.name).toBe('User');
    expect(entity.type).toBe('entity');
    expect(entity.detectionMethod).toBe('schema-definition');
  });
});

// ─── Edge Cases and Error Handling ──────────────────────────────────────────

describe('DataModelAnalyzer - Edge Cases', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data-model-analyzer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns noModelsFound when no entities are detected', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }');

    const fileTree = createFileTree([
      { path: 'src/utils.ts', name: 'utils.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.noModelsFound).toBe(true);
    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
    expect(result.searchedSources).toContain('TypeScript/JavaScript source files');
  });

  it('handles files that cannot be read', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    // Create a file reference in the tree but don't actually create the file
    const fileTree = createFileTree([
      { path: 'src/missing.entity.ts', name: 'missing.entity.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    // Should complete without throwing
    expect(result).toBeDefined();
  });

  it('skips test and spec files', async () => {
    const entityContent = `
export class User {
  id: number;
  name: string;
}
`;

    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'user.entity.ts'), entityContent);
    await writeFile(join(tempDir, 'src', 'user.entity.test.ts'), entityContent);
    await writeFile(join(tempDir, 'src', 'user.entity.spec.ts'), entityContent);

    const fileTree = createFileTree([
      { path: 'src/user.entity.ts', name: 'user.entity.ts' },
      { path: 'src/user.entity.test.ts', name: 'user.entity.test.ts' },
      { path: 'src/user.entity.spec.ts', name: 'user.entity.spec.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    // Should only detect the entity from the non-test file
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].filePath).toContain('user.entity.ts');
    expect(result.entities[0].filePath).not.toContain('.test.');
    expect(result.entities[0].filePath).not.toContain('.spec.');
  });

  it('reports progress during analysis', async () => {
    const progressReports: Array<{ message: string; progress: number; total: number }> = [];

    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'user.entity.ts'), 'export class User { id: number; }');

    const fileTree = createFileTree([
      { path: 'src/user.entity.ts', name: 'user.entity.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree, {
      reportProgress: async (message, progress, total) => {
        progressReports.push({ message, progress, total });
      },
    });

    await analyzer.analyze(context);

    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[0].message).toContain('Starting');
    expect(progressReports[progressReports.length - 1].message).toContain('complete');
    expect(progressReports[progressReports.length - 1].progress).toBe(100);
  });

  it('handles multiple entities in a single file', async () => {
    const entityContent = `
@Entity()
export class User {
  @Column()
  id: number;
  
  @Column()
  name: string;
}

@Entity()
export class Profile {
  @Column()
  id: number;
  
  @Column()
  bio: string;
}
`;

    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'entities.ts'), entityContent);

    const fileTree = createFileTree([
      { path: 'src/entities.ts', name: 'entities.ts' },
    ]);

    const analyzer = new DataModelAnalyzer();
    const context = createMockContext(tempDir, fileTree);
    const result = await analyzer.analyze(context);

    expect(result.entities).toHaveLength(2);
    expect(result.entities.map(e => e.name)).toContain('User');
    expect(result.entities.map(e => e.name)).toContain('Profile');
  });
});
