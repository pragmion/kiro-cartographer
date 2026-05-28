// Codebase Explorer Power - Data Model Analyzer
// Detects entities, DTOs, value objects, relationships, and schema discrepancies.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type {
  FileTreeNode,
  DataModelAnalysis,
  EntityDefinition,
  EntityRelationship,
  FieldDefinition,
  FieldConstraint,
  SchemaDiscrepancy,
} from '../types.js';

// ─── Detection Patterns ─────────────────────────────────────────────────────

/** ORM decorator patterns (TypeORM, Sequelize, Prisma-like) */
const ORM_PATTERNS = {
  typeorm: {
    entity: /@Entity\s*\(/,
    column: /@Column\s*\(/,
    primaryColumn: /@PrimaryGeneratedColumn|@PrimaryColumn/,
    relation: /@(OneToOne|OneToMany|ManyToOne|ManyToMany)\s*\(/,
  },
  sequelize: {
    model: /@Table\s*\(|Model\.init\s*\(/,
    column: /@Column\s*\(|DataTypes\./,
  },
  prisma: {
    model: /^model\s+(\w+)\s*\{/m,
    field: /^\s+(\w+)\s+(\w+)(\[\])?\s*(.*)/m,
  },
  mongoose: {
    schema: /new\s+Schema\s*\(\s*\{/,
    field: /(\w+)\s*:\s*\{\s*type\s*:/,
  },
};

/** Naming convention patterns for entity detection */
const ENTITY_NAME_PATTERNS = [
  /\.entity\.[tj]sx?$/i,
  /\.model\.[tj]sx?$/i,
  /\.schema\.[tj]sx?$/i,
];

const DTO_NAME_PATTERNS = [
  /\.dto\.[tj]sx?$/i,
  /\.request\.[tj]sx?$/i,
  /\.response\.[tj]sx?$/i,
];

const VALUE_OBJECT_PATTERNS = [
  /\.vo\.[tj]sx?$/i,
  /\.value-object\.[tj]sx?$/i,
  /value-?objects?\//i,
];

// ─── Field Extraction ───────────────────────────────────────────────────────

/** Extracts fields from a TypeScript/JavaScript class or interface. */
function extractFieldsFromClass(content: string, className: string): FieldDefinition[] {
  const fields: FieldDefinition[] = [];

  // Match class body — use a balanced-brace approach since regex with [^}]* doesn't handle nested braces
  const classStartRegex = new RegExp(
    `(?:class|interface)\\s+${escapeRegex(className)}[^{]*\\{`,
    's'
  );
  const startMatch = classStartRegex.exec(content);
  if (!startMatch) return fields;

  // Find the matching closing brace
  const bodyStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  let bodyEnd = bodyStart;
  for (let i = bodyStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  const body = content.substring(bodyStart, bodyEnd);

  // Strip decorator lines first to avoid them confusing the field regex
  const cleanedBody = body.replace(/^\s*@\w+(?:\([^)]*\))?\s*$/gm, '');

  // Match field declarations: name: Type or name?: Type
  // Each field on its own line, optionally preceded by inline decorator
  const fieldRegex = /^\s*(?:@\w+(?:\([^)]*\))?\s+)?(\w+)(\?)?:\s*([^;=\n{]+?)(?:[;\n]|$)/gm;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(cleanedBody)) !== null) {
    const name = match[1];
    const isOptional = match[2] === '?';
    const dataType = match[3].trim();

    // Skip methods (have parens or arrow)
    if (dataType.includes('=>') || dataType.includes('(')) continue;
    // Skip TypeScript modifiers and keywords that aren't field names
    if (['public', 'private', 'protected', 'readonly', 'static', 'constructor', 'get', 'set'].includes(name)) continue;

    const constraints = extractConstraints(content, name);

    fields.push({
      name,
      dataType,
      constraints,
      isRequired: !isOptional,
    });
  }

  return fields;
}

/** Extracts constraints from decorators or validation annotations. */
function extractConstraints(content: string, fieldName: string): FieldConstraint[] {
  const constraints: FieldConstraint[] = [];

  // Look for validation decorators near the field
  const fieldContext = getFieldContext(content, fieldName);
  if (!fieldContext) return constraints;

  // @IsNotEmpty, @IsRequired
  if (/@IsNotEmpty|@IsRequired|@IsDefined/.test(fieldContext)) {
    // Already handled by isRequired
  }

  // @MaxLength, @MinLength, @Length
  const lengthMatch = /@(?:Max)?Length\s*\(\s*(\d+)/.exec(fieldContext);
  if (lengthMatch) {
    constraints.push({ type: 'length', value: lengthMatch[1] });
  }

  // @Min, @Max
  const minMatch = /@Min\s*\(\s*(\d+)/.exec(fieldContext);
  const maxMatch = /@Max\s*\(\s*(\d+)/.exec(fieldContext);
  if (minMatch || maxMatch) {
    const range = `${minMatch?.[1] ?? ''}..${maxMatch?.[1] ?? ''}`;
    constraints.push({ type: 'range', value: range });
  }

  // @IsEnum
  const enumMatch = /@IsEnum\s*\(\s*(\w+)/.exec(fieldContext);
  if (enumMatch) {
    constraints.push({ type: 'enum', value: enumMatch[1] });
  }

  // @Matches (pattern)
  const patternMatch = /@Matches\s*\(\s*\/([^/]+)\//.exec(fieldContext);
  if (patternMatch) {
    constraints.push({ type: 'pattern', value: patternMatch[1] });
  }

  // @Unique
  if (/@Unique|unique\s*:\s*true/.test(fieldContext)) {
    constraints.push({ type: 'unique', value: 'true' });
  }

  return constraints;
}

/** Gets the context (decorators + field line) around a field declaration. */
function getFieldContext(content: string, fieldName: string): string | null {
  const regex = new RegExp(
    `((?:@\\w+[^]*?\\n\\s*)*${escapeRegex(fieldName)}[?!]?\\s*:[^;\\n]+)`,
    'm'
  );
  const match = regex.exec(content);
  return match ? match[1] : null;
}

// ─── Relationship Extraction ────────────────────────────────────────────────

interface RawRelationship {
  sourceEntity: string;
  targetEntity: string;
  type: '1:1' | '1:N' | 'N:M';
  sourceField: string;
}

function extractRelationships(content: string, entityName: string): RawRelationship[] {
  const relationships: RawRelationship[] = [];

  // TypeORM-style decorators
  const relationRegex = /@(OneToOne|OneToMany|ManyToOne|ManyToMany)\s*\(\s*\(\)\s*=>\s*(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = relationRegex.exec(content)) !== null) {
    const relType = match[1];
    const targetEntity = match[2];

    // Find the field name after the decorator
    const afterDecorator = content.substring(match.index + match[0].length);
    const fieldMatch = /[^]*?\n\s*(\w+)\s*[?!]?\s*:/.exec(afterDecorator);
    const sourceField = fieldMatch ? fieldMatch[1] : 'unknown';

    let type: '1:1' | '1:N' | 'N:M';
    switch (relType) {
      case 'OneToOne': type = '1:1'; break;
      case 'OneToMany': type = '1:N'; break;
      case 'ManyToOne': type = '1:N'; break;
      case 'ManyToMany': type = 'N:M'; break;
      default: type = '1:N';
    }

    relationships.push({
      sourceEntity: entityName,
      targetEntity,
      type,
      sourceField,
    });
  }

  return relationships;
}

// ─── Prisma Schema Parsing ──────────────────────────────────────────────────

interface PrismaModel {
  name: string;
  fields: FieldDefinition[];
  relationships: RawRelationship[];
}

function parsePrismaSchema(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const modelRegex = /^model\s+(\w+)\s*\{([^}]*)}/gm;
  let modelMatch: RegExpExecArray | null;

  while ((modelMatch = modelRegex.exec(content)) !== null) {
    const name = modelMatch[1];
    const body = modelMatch[2];
    const fields: FieldDefinition[] = [];
    const relationships: RawRelationship[] = [];

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

      const fieldMatch = /^(\w+)\s+(\w+)(\[\])?\s*(.*)/.exec(trimmed);
      if (!fieldMatch) continue;

      const [, fieldName, fieldType, isArray, rest] = fieldMatch;
      const isOptional = rest.includes('?') || fieldType.endsWith('?');

      // Check if it's a relation (type starts with uppercase and isn't a scalar)
      const prismaScalars = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal']);
      if (!prismaScalars.has(fieldType) && /^[A-Z]/.test(fieldType)) {
        relationships.push({
          sourceEntity: name,
          targetEntity: fieldType,
          type: isArray ? '1:N' : '1:1',
          sourceField: fieldName,
        });
      } else {
        const constraints: FieldConstraint[] = [];
        if (rest.includes('@unique')) constraints.push({ type: 'unique', value: 'true' });
        if (rest.includes('@id')) constraints.push({ type: 'unique', value: 'primary' });

        fields.push({
          name: fieldName,
          dataType: fieldType + (isArray ? '[]' : ''),
          constraints,
          isRequired: !isOptional && !rest.includes('?'),
        });
      }
    }

    models.push({ name, fields, relationships });
  }

  return models;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Data Model Analyzer ────────────────────────────────────────────────────

export class DataModelAnalyzer implements Analyzer<DataModelAnalysis> {
  readonly name = 'DataModelAnalyzer';

  async analyze(context: AnalysisContext): Promise<DataModelAnalysis> {
    await context.reportProgress('Starting data model analysis', 0, 100);

    const filePaths = this.collectSourceFiles(context.fileTree, '');
    const entities: EntityDefinition[] = [];
    const relationships: EntityRelationship[] = [];
    const searchedSources: string[] = [];

    // Check for Prisma schema
    await context.reportProgress('Checking for Prisma schema', 10, 100);
    const prismaResult = await this.analyzePrismaSchema(context.rootPath, filePaths);
    if (prismaResult) {
      entities.push(...prismaResult.entities);
      relationships.push(...prismaResult.relationships);
      searchedSources.push('prisma/schema.prisma');
    }

    // Analyze TypeScript/JavaScript source files for entities
    await context.reportProgress('Scanning source files for entities', 30, 100);
    const sourceFiles = filePaths.filter(fp =>
      /\.[tj]sx?$/.test(fp) && !fp.includes('.test.') && !fp.includes('.spec.')
    );

    for (const filePath of sourceFiles.slice(0, 300)) {
      const fullPath = join(context.rootPath, filePath);
      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const detectedEntities = this.detectEntities(content, filePath);
      entities.push(...detectedEntities);

      // Extract relationships from ORM decorators
      for (const entity of detectedEntities) {
        const rels = extractRelationships(content, entity.name);
        for (const rel of rels) {
          relationships.push({
            sourceEntity: rel.sourceEntity,
            targetEntity: rel.targetEntity,
            type: rel.type,
            sourceField: rel.sourceField,
            targetField: 'id', // Default assumption
          });
        }
      }
    }

    searchedSources.push('TypeScript/JavaScript source files');

    await context.reportProgress('Data model analysis complete', 100, 100);

    return {
      entities,
      relationships,
      schemaDiscrepancies: [], // Would require DB schema comparison
      noModelsFound: entities.length === 0,
      searchedSources,
    };
  }

  /**
   * Collects source file paths from the tree.
   */
  private collectSourceFiles(nodes: FileTreeNode[], prefix: string): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
      const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'file') {
        paths.push(nodePath);
      } else if (node.type === 'directory' && node.children) {
        paths.push(...this.collectSourceFiles(node.children, nodePath));
      }
    }
    return paths;
  }

  /**
   * Analyzes Prisma schema if present.
   */
  private async analyzePrismaSchema(
    rootPath: string,
    filePaths: string[],
  ): Promise<{ entities: EntityDefinition[]; relationships: EntityRelationship[] } | null> {
    const prismaFile = filePaths.find(fp =>
      fp.endsWith('schema.prisma') || fp.includes('prisma/schema.prisma')
    );
    if (!prismaFile) return null;

    let content: string;
    try {
      content = await readFile(join(rootPath, prismaFile), 'utf-8');
    } catch {
      return null;
    }

    const models = parsePrismaSchema(content);
    const entities: EntityDefinition[] = models.map(m => ({
      name: m.name,
      type: 'entity',
      filePath: prismaFile,
      detectionMethod: 'schema-definition',
      fields: m.fields,
    }));

    const relationships: EntityRelationship[] = models.flatMap(m =>
      m.relationships.map(r => ({
        sourceEntity: r.sourceEntity,
        targetEntity: r.targetEntity,
        type: r.type,
        sourceField: r.sourceField,
        targetField: 'id',
      }))
    );

    return { entities, relationships };
  }

  /**
   * Detects entities in a source file based on ORM annotations and naming conventions.
   */
  private detectEntities(content: string, filePath: string): EntityDefinition[] {
    const entities: EntityDefinition[] = [];

    // TypeORM @Entity detection
    if (ORM_PATTERNS.typeorm.entity.test(content)) {
      const classNames = this.extractClassNames(content);
      for (const className of classNames) {
        const fields = extractFieldsFromClass(content, className);
        entities.push({
          name: className,
          type: 'entity',
          filePath,
          detectionMethod: 'orm-annotation',
          fields,
        });
      }
      return entities;
    }

    // Mongoose schema detection
    if (ORM_PATTERNS.mongoose.schema.test(content)) {
      const classNames = this.extractExportedNames(content);
      for (const name of classNames) {
        entities.push({
          name,
          type: 'entity',
          filePath,
          detectionMethod: 'schema-definition',
          fields: [], // Mongoose schemas are harder to parse statically
        });
      }
      return entities;
    }

    // Naming convention detection
    const entityType = this.detectTypeByNaming(filePath);
    if (entityType) {
      const classNames = this.extractClassNames(content);
      if (classNames.length === 0) {
        // Try interface/type names
        const typeNames = this.extractTypeNames(content);
        for (const name of typeNames) {
          const fields = extractFieldsFromClass(content, name);
          entities.push({
            name,
            type: entityType,
            filePath,
            detectionMethod: 'naming-convention',
            fields,
          });
        }
      } else {
        for (const className of classNames) {
          const fields = extractFieldsFromClass(content, className);
          entities.push({
            name: className,
            type: entityType,
            filePath,
            detectionMethod: 'naming-convention',
            fields,
          });
        }
      }
    }

    return entities;
  }

  private detectTypeByNaming(filePath: string): 'entity' | 'dto' | 'value-object' | null {
    if (ENTITY_NAME_PATTERNS.some(p => p.test(filePath))) return 'entity';
    if (DTO_NAME_PATTERNS.some(p => p.test(filePath))) return 'dto';
    if (VALUE_OBJECT_PATTERNS.some(p => p.test(filePath))) return 'value-object';
    return null;
  }

  private extractClassNames(content: string): string[] {
    const names: string[] = [];
    const regex = /(?:export\s+)?class\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      names.push(match[1]);
    }
    return names;
  }

  private extractTypeNames(content: string): string[] {
    const names: string[] = [];
    const regex = /(?:export\s+)?(?:interface|type)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      names.push(match[1]);
    }
    return names;
  }

  private extractExportedNames(content: string): string[] {
    const names: string[] = [];
    const regex = /(?:export\s+(?:const|let|var)\s+(\w+)|module\.exports\s*=\s*(\w+))/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      names.push(match[1] || match[2]);
    }
    return names;
  }
}
