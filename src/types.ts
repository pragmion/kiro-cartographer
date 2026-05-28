// Codebase Explorer Power - Shared Types

// ─── Focus Areas ────────────────────────────────────────────────────────────

export type FocusArea =
  | 'api'
  | 'data-model'
  | 'state-management'
  | 'security'
  | 'error-handling'
  | 'build-pipeline';

// ─── Artifact Types ─────────────────────────────────────────────────────────

export type ArtifactType = 'steering' | 'skills' | 'documentation';

export type SteeringCategory =
  | 'build-commands'
  | 'naming-conventions'
  | 'formatting'
  | 'import-order'
  | 'architecture'
  | 'test-commands';

// ─── File Categories ────────────────────────────────────────────────────────

export type FileCategory = 'source' | 'config' | 'test' | 'documentation' | 'asset' | 'unknown';

// ─── File Tree ──────────────────────────────────────────────────────────────

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  extension?: string;
  category?: FileCategory;
  children?: FileTreeNode[];
  symlinkTarget?: string;
}

// ─── Project Structure ──────────────────────────────────────────────────────

export interface LanguageDistribution {
  language: string;
  lineCount: number;
  percentage: number; // 0-100
  fileCount: number;
}

export interface ProjectStructure {
  tree: FileTreeNode;
  statistics: {
    totalFiles: number;
    totalDirectories: number;
    categoryCounts: Record<FileCategory, number>;
    languageDistribution: LanguageDistribution[];
  };
  excludedPaths: string[];
  warnings: AnalysisWarning[];
}

// ─── Architecture Patterns ──────────────────────────────────────────────────

export type PatternType = 'mvc' | 'hexagonal' | 'microservices' | 'monolith' | 'event-driven' | 'layered';
export type Confidence = 'high' | 'medium' | 'low';

export interface DetectedPattern {
  type: PatternType;
  confidence: Confidence;
  matchingFeatures: number;
  totalFeatures: number;
  evidence: PatternEvidence[];
  isDominant: boolean;
}

export interface PatternEvidence {
  role: string;
  files: string[];
  description: string;
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'call' | 'event';
  weight: number;
}

export interface LayerDefinition {
  name: string;
  responsibilities: string[];
  modules: string[];
  allowedDependencies: string[];
}

export interface ArchitecturePatterns {
  patterns: DetectedPattern[];
  dependencyGraph: DependencyEdge[];
  layers?: LayerDefinition[];
}

// ─── Data Model Analysis ────────────────────────────────────────────────────

export interface FieldConstraint {
  type: 'length' | 'range' | 'pattern' | 'enum' | 'unique' | 'foreign-key';
  value: string;
}

export interface FieldDefinition {
  name: string;
  dataType: string;
  constraints: FieldConstraint[];
  isRequired: boolean;
}

export interface EntityDefinition {
  name: string;
  type: 'entity' | 'dto' | 'value-object';
  filePath: string;
  detectionMethod: 'orm-annotation' | 'schema-definition' | 'naming-convention' | 'type-definition';
  fields: FieldDefinition[];
}

export interface EntityRelationship {
  sourceEntity: string;
  targetEntity: string;
  type: '1:1' | '1:N' | 'N:M';
  sourceField: string;
  targetField: string;
}

export interface SchemaDiscrepancy {
  entity: string;
  field: string;
  codeType: string;
  schemaType: string;
  description: string;
}

export interface DataModelAnalysis {
  entities: EntityDefinition[];
  relationships: EntityRelationship[];
  schemaDiscrepancies: SchemaDiscrepancy[];
  noModelsFound: boolean;
  searchedSources: string[];
}

// ─── API Analysis ───────────────────────────────────────────────────────────

export type AuthRequirement =
  | { type: 'none-detected' }
  | { type: 'bearer'; scope?: string }
  | { type: 'api-key'; location: 'header' | 'query' }
  | { type: 'oauth2'; scopes: string[] }
  | { type: 'custom'; description: string };

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';
  path: string;
  filePath: string;
  requestType?: string;
  responseType?: string;
  authentication: AuthRequirement;
  description?: string;
}

export interface GraphQLOperation {
  name: string;
  arguments: { name: string; type: string }[];
  returnType: string;
}

export interface GraphQLSchema {
  queries: GraphQLOperation[];
  mutations: GraphQLOperation[];
  subscriptions: GraphQLOperation[];
  types: string[];
}

export interface GrpcService {
  name: string;
  filePath: string;
  methods: { name: string; requestType: string; responseType: string }[];
}

export interface WebSocketEndpoint {
  path: string;
  filePath: string;
  events: { name: string; direction: 'incoming' | 'outgoing' | 'bidirectional' }[];
}

export interface ApiDiscrepancy {
  endpoint: string;
  codeDefinition: string;
  specDefinition: string;
  description: string;
}

export interface ApiAnalysis {
  restEndpoints: ApiEndpoint[];
  graphql?: GraphQLSchema;
  grpcServices?: GrpcService[];
  websocketEndpoints?: WebSocketEndpoint[];
  specDiscrepancies: ApiDiscrepancy[];
  noApisFound: boolean;
}

// ─── Error Handling Analysis ────────────────────────────────────────────────

export interface ErrorHandlingAnalysis {
  patterns: ErrorPattern[];
  hierarchy: ErrorHierarchy[];
  loggingStrategy: LoggingStrategy;
  noPatternsFound: boolean;
}

export interface ErrorPattern {
  type: 'try-catch' | 'result-type' | 'error-boundary' | 'global-handler';
  strategy: 'propagation' | 'retry' | 'fallback' | 'logging';
  files: string[];
  description: string;
}

export interface ErrorHierarchy {
  name: string;
  parent?: string;
  filePath: string;
  usageContext: string;
}

export interface LoggingStrategy {
  levels: string[];
  categoryMapping: Record<string, string>;
}

// ─── State Management Analysis ──────────────────────────────────────────────

export interface StateManagementAnalysis {
  solution: string;
  stores: StoreDefinition[];
  dataFlows: DataFlow[];
  updatePatterns: UpdatePattern[];
  noStateManagementFound: boolean;
}

export interface StoreDefinition {
  name: string;
  filePath: string;
  slices: string[];
}

export interface DataFlow {
  source: string;
  target: string;
  mechanism: string;
}

export interface UpdatePattern {
  type: 'action' | 'mutation' | 'setter' | 'effect';
  name: string;
  filePath: string;
}

// ─── Build Pipeline Analysis ────────────────────────────────────────────────

export interface BuildPipelineAnalysis {
  buildTool: BuildToolInfo | null;
  scripts: BuildScript[];
  cicd: CiCdConfig[];
  dependencies: DependencyInfo[];
  noBuildToolFound: boolean;
}

export interface BuildToolInfo {
  name: string;
  configFile: string;
  version?: string;
}

export interface BuildScript {
  name: string;
  command: string;
  type: 'build' | 'test' | 'lint' | 'other';
}

export interface CiCdConfig {
  platform: string;
  configFile: string;
  steps: PipelineStep[];
}

export interface PipelineStep {
  name: string;
  trigger?: string;
  order: number;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'direct' | 'transitive';
  depth: number;
  status: 'ok' | 'insecure' | 'updatable' | 'unresolvable';
  advisoryUrl?: string;
  recommendedVersion?: string;
}

// ─── Analysis Output ────────────────────────────────────────────────────────

export interface AnalysisWarning {
  path: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface AnalysisSummary {
  projectName: string;
  analyzedAt: string;
  totalFiles: number;
  totalDirectories: number;
  primaryLanguage: string;
  detectedPatterns: string[];
}

export interface AnalyzeCodebaseOutput {
  summary: AnalysisSummary;
  structure: ProjectStructure;
  patterns: ArchitecturePatterns;
  dataModels: DataModelAnalysis;
  apis: ApiAnalysis;
  errorHandling: ErrorHandlingAnalysis;
  stateManagement: StateManagementAnalysis;
  buildPipeline: BuildPipelineAnalysis;
  warnings: AnalysisWarning[];
}

// ─── Generated Artifacts ────────────────────────────────────────────────────

export interface GeneratedFile {
  path: string;
  type: ArtifactType;
  content: string;
  inclusionMode: 'auto' | 'manual';
}

export interface SkippedCategory {
  category: string;
  reason: string;
}

export interface FileConflict {
  path: string;
  existingContent: string;
  newContent: string;
  resolution?: 'overwrite' | 'append' | 'skip';
}

export interface OverriddenPreference {
  field: string;
  userValue: string;
  teamValue: string;
}

export interface GenerateArtifactsOutput {
  generatedFiles: GeneratedFile[];
  skippedCategories: SkippedCategory[];
  conflicts: FileConflict[];
  overriddenPreferences: OverriddenPreference[];
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface UserProfile {
  commentStyle?: 'jsdoc' | 'inline' | 'minimal' | 'verbose';
  namingPreference?: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
  preferredPatterns?: string[];
  language?: string;
  maxSkillCount?: number;
}

export interface TeamConventions {
  naming?: {
    files?: 'camelCase' | 'kebab-case' | 'PascalCase' | 'snake_case';
    variables?: 'camelCase' | 'snake_case';
    classes?: 'PascalCase';
    constants?: 'UPPER_SNAKE_CASE';
  };
  formatting?: {
    indentation?: 'spaces' | 'tabs';
    indentSize?: number;
    maxLineLength?: number;
    trailingComma?: boolean;
    semicolons?: boolean;
  };
  architecture?: {
    allowedLayers?: string[];
    forbiddenDependencies?: { from: string; to: string }[];
  };
  imports?: {
    order?: string[];
    groupSeparator?: boolean;
  };
}

export interface AnalysisProfile {
  focusAreas: FocusArea[];
  excludePaths?: string[];
  maxDepth?: number;
  includeCodeExamples?: boolean;
}

export interface ResolvedConfig {
  userProfile: UserProfile;
  teamConventions: TeamConventions;
  analysisProfile: AnalysisProfile;
  overriddenFields: string[];
}

// ─── State Cache ────────────────────────────────────────────────────────────

export interface AnalysisState {
  version: string;
  lastAnalysis: string;
  rootPath: string;
  fileHashes: Record<string, string>;
  fileToArtifactMap: Record<string, string[]>;
  analysisConfig: {
    focusAreas: FocusArea[];
    excludePaths: string[];
  };
}

export interface IncrementalDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}

// ─── Manifest ───────────────────────────────────────────────────────────────

export interface GeneratedManifest {
  version: string;
  generatedAt: string;
  powerName: 'kiro-cartographer';
  powerVersion: string;
  files: GeneratedFileEntry[];
}

export interface GeneratedFileEntry {
  path: string;
  type: ArtifactType;
  generatedAt: string;
  hash: string;
  sourceAnalysis: string;
}

// ─── MCP Error Response ─────────────────────────────────────────────────────

export interface McpErrorResponse {
  content: [{ type: 'text'; text: string }];
  isError: true;
  _meta?: {
    errorCode: string;
    toolName: string;
    invalidParams?: { name: string; reason: string; expected: string }[];
    availableTools?: string[];
  };
}
