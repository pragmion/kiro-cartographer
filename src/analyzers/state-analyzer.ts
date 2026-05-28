// Codebase Explorer Power - State Analyzer
// Detects state management solutions, stores, data flows, and update patterns.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Analyzer, AnalysisContext } from './base-analyzer.js';
import type {
  FileTreeNode,
  StateManagementAnalysis,
  StoreDefinition,
  DataFlow,
  UpdatePattern,
} from '../types.js';

// ─── State Management Detection ────────────────────────────────────────────

interface StateFramework {
  name: string;
  importPatterns: RegExp[];
  storePatterns: RegExp[];
  updatePatterns: { type: UpdatePattern['type']; regex: RegExp }[];
}

const STATE_FRAMEWORKS: StateFramework[] = [
  {
    name: 'Redux',
    importPatterns: [
      /from\s+['"](?:redux|@reduxjs\/toolkit|react-redux)['"]/,
    ],
    storePatterns: [
      /createStore\s*\(/,
      /configureStore\s*\(/,
      /createSlice\s*\(/,
    ],
    updatePatterns: [
      { type: 'action', regex: /createAction\s*\(|dispatch\s*\(/ },
      { type: 'mutation', regex: /reducers\s*:\s*\{/ },
      { type: 'effect', regex: /createAsyncThunk|createEpic|ofType/ },
    ],
  },
  {
    name: 'Zustand',
    importPatterns: [
      /from\s+['"]zustand['"]/,
    ],
    storePatterns: [
      /create\s*\(\s*(?:\([^)]*\)\s*=>|set\s*=>)/,
    ],
    updatePatterns: [
      { type: 'setter', regex: /set\s*\(\s*(?:\(|{)/ },
      { type: 'action', regex: /getState\s*\(\)/ },
    ],
  },
  {
    name: 'MobX',
    importPatterns: [
      /from\s+['"]mobx(?:-react)?['"]/,
    ],
    storePatterns: [
      /@observable|makeObservable|makeAutoObservable/,
    ],
    updatePatterns: [
      { type: 'action', regex: /@action|action\s*\(|runInAction/ },
      { type: 'effect', regex: /autorun|reaction|when\s*\(/ },
    ],
  },
  {
    name: 'React Context',
    importPatterns: [
      /createContext|useContext/,
    ],
    storePatterns: [
      /createContext\s*\(/,
      /\.Provider\s+value/,
    ],
    updatePatterns: [
      { type: 'setter', regex: /useState\s*\(/ },
      { type: 'mutation', regex: /useReducer\s*\(/ },
    ],
  },
  {
    name: 'Signals',
    importPatterns: [
      /from\s+['"](?:@preact\/signals|@angular\/core|solid-js)['"]/,
      /signal\s*\(|computed\s*\(/,
    ],
    storePatterns: [
      /signal\s*\(/,
      /createSignal\s*\(/,
    ],
    updatePatterns: [
      { type: 'setter', regex: /\.set\s*\(|\.value\s*=/ },
      { type: 'effect', regex: /effect\s*\(|createEffect\s*\(/ },
    ],
  },
  {
    name: 'Vuex/Pinia',
    importPatterns: [
      /from\s+['"](?:vuex|pinia)['"]/,
    ],
    storePatterns: [
      /createStore\s*\(|defineStore\s*\(/,
    ],
    updatePatterns: [
      { type: 'mutation', regex: /mutations\s*:\s*\{|commit\s*\(/ },
      { type: 'action', regex: /actions\s*:\s*\{|dispatch\s*\(/ },
    ],
  },
  {
    name: 'NgRx',
    importPatterns: [
      /from\s+['"]@ngrx\//,
    ],
    storePatterns: [
      /createReducer\s*\(|StoreModule/,
    ],
    updatePatterns: [
      { type: 'action', regex: /createAction\s*\(|dispatch\s*\(/ },
      { type: 'effect', regex: /createEffect\s*\(|Actions/ },
    ],
  },
  {
    name: 'TanStack Query (React Query)',
    importPatterns: [
      /from\s+['"](?:@tanstack\/react-query|react-query)['"]/,
    ],
    storePatterns: [
      /useQuery\s*\(|useMutation\s*\(|QueryClient/,
    ],
    updatePatterns: [
      { type: 'mutation', regex: /useMutation\s*\(|mutate\s*\(/ },
      { type: 'effect', regex: /useQuery\s*\(|queryClient\.invalidate/ },
    ],
  },
  {
    name: 'SWR',
    importPatterns: [
      /from\s+['"]swr['"]/,
    ],
    storePatterns: [
      /useSWR\s*\(/,
    ],
    updatePatterns: [
      { type: 'mutation', regex: /mutate\s*\(/ },
      { type: 'effect', regex: /useSWR\s*\(/ },
    ],
  },
  {
    name: 'RTK Query',
    importPatterns: [
      /from\s+['"]@reduxjs\/toolkit\/query['"]/,
      /createApi\s*\(/,
    ],
    storePatterns: [
      /createApi\s*\(/,
    ],
    updatePatterns: [
      { type: 'mutation', regex: /useMutation|\.initiate\s*\(/ },
      { type: 'effect', regex: /useQuery|\.endpoints\./ },
    ],
  },
  {
    name: 'Apollo Client',
    importPatterns: [
      /from\s+['"]@apollo\/client['"]/,
    ],
    storePatterns: [
      /useQuery\s*\(|useMutation\s*\(|ApolloClient/,
    ],
    updatePatterns: [
      { type: 'mutation', regex: /useMutation\s*\(/ },
      { type: 'effect', regex: /useQuery\s*\(|client\.query/ },
    ],
  },
];

// ─── State Analyzer ─────────────────────────────────────────────────────────

export class StateAnalyzer implements Analyzer<StateManagementAnalysis> {
  readonly name = 'StateAnalyzer';

  async analyze(context: AnalysisContext): Promise<StateManagementAnalysis> {
    await context.reportProgress('Starting state management analysis', 0, 100);

    const filePaths = this.collectFiles(context.fileTree, '');
    const sourceFiles = filePaths.filter(fp =>
      /\.[tj]sx?$/.test(fp) && !fp.includes('.test.') && !fp.includes('.spec.')
    );

    const detectedFrameworks = new Map<string, {
      files: string[];
      stores: StoreDefinition[];
      updatePatterns: UpdatePattern[];
    }>();

    await context.reportProgress('Scanning for state management patterns', 20, 100);

    for (const filePath of sourceFiles.slice(0, 300)) {
      const fullPath = join(context.rootPath, filePath);
      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      for (const framework of STATE_FRAMEWORKS) {
        const hasImport = framework.importPatterns.some(p => p.test(content));
        if (!hasImport) continue;

        if (!detectedFrameworks.has(framework.name)) {
          detectedFrameworks.set(framework.name, {
            files: [],
            stores: [],
            updatePatterns: [],
          });
        }

        const data = detectedFrameworks.get(framework.name)!;
        data.files.push(filePath);

        // Detect stores
        const hasStore = framework.storePatterns.some(p => p.test(content));
        if (hasStore) {
          const storeName = this.extractStoreName(content, filePath);
          const slices = this.extractSlices(content);
          data.stores.push({
            name: storeName,
            filePath,
            slices,
          });
        }

        // Detect update patterns
        for (const { type, regex } of framework.updatePatterns) {
          if (regex.test(content)) {
            const name = this.extractPatternName(content, regex);
            data.updatePatterns.push({
              type,
              name: name || type,
              filePath,
            });
          }
        }
      }
    }

    await context.reportProgress('State management analysis complete', 100, 100);

    // Determine primary solution
    if (detectedFrameworks.size === 0) {
      return {
        solution: 'none',
        stores: [],
        dataFlows: [],
        updatePatterns: [],
        noStateManagementFound: true,
      };
    }

    // Pick the framework with the most files as primary
    let primaryName = '';
    let maxFiles = 0;
    for (const [name, data] of detectedFrameworks) {
      if (data.files.length > maxFiles) {
        maxFiles = data.files.length;
        primaryName = name;
      }
    }

    const primary = detectedFrameworks.get(primaryName)!;

    // Build data flows (simplified: store → component relationships)
    const dataFlows: DataFlow[] = primary.stores.map(store => ({
      source: store.name,
      target: 'Components',
      mechanism: primaryName === 'Redux' ? 'useSelector/connect' :
                 primaryName === 'Zustand' ? 'useStore hook' :
                 primaryName === 'MobX' ? 'observer HOC' :
                 primaryName === 'React Context' ? 'useContext' :
                 'subscription',
    }));

    return {
      solution: primaryName,
      stores: primary.stores,
      dataFlows,
      updatePatterns: this.deduplicatePatterns(primary.updatePatterns),
      noStateManagementFound: false,
    };
  }

  private extractStoreName(content: string, filePath: string): string {
    // Try to extract from createSlice name
    const sliceMatch = /createSlice\s*\(\s*\{[^}]*name\s*:\s*['"`](\w+)['"`]/.exec(content);
    if (sliceMatch) return sliceMatch[1];

    // Try defineStore name
    const piniaMatch = /defineStore\s*\(\s*['"`](\w+)['"`]/.exec(content);
    if (piniaMatch) return piniaMatch[1];

    // Fallback to filename
    const name = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'store';
    return name;
  }

  private extractSlices(content: string): string[] {
    const slices: string[] = [];
    const sliceRegex = /createSlice\s*\(\s*\{[^}]*name\s*:\s*['"`](\w+)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = sliceRegex.exec(content)) !== null) {
      slices.push(match[1]);
    }
    return slices;
  }

  private extractPatternName(content: string, regex: RegExp): string | null {
    const match = regex.exec(content);
    if (!match) return null;
    // Try to get the name from the context around the match
    const after = content.substring(match.index, match.index + 100);
    const nameMatch = /['"`](\w+)['"`]/.exec(after);
    return nameMatch ? nameMatch[1] : null;
  }

  private deduplicatePatterns(patterns: UpdatePattern[]): UpdatePattern[] {
    const seen = new Set<string>();
    return patterns.filter(p => {
      const key = `${p.type}:${p.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private collectFiles(nodes: FileTreeNode[], prefix: string): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
      const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'file') {
        paths.push(nodePath);
      } else if (node.type === 'directory' && node.children) {
        paths.push(...this.collectFiles(node.children, nodePath));
      }
    }
    return paths;
  }
}
