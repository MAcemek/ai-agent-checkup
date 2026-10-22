import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  type Document,
  type Node,
} from 'yaml';

/** A YAML node with the line numbers of the source. Aliases and merge keys are resolved. */
export type YNode = YMap | YSeq | YScalar;

export interface YMap {
  kind: 'map';
  line: number;
  entries: YEntry[];
}

export interface YSeq {
  kind: 'seq';
  line: number;
  items: YNode[];
}

export interface YScalar {
  kind: 'scalar';
  /** First line of the value. For block scalars this is the line of the | or > indicator. */
  line: number;
  /** Last line of the value. */
  endLine: number;
  value: string | number | boolean | null;
}

export interface YEntry {
  key: string;
  keyLine: number;
  value: YNode;
}

export interface ParsedYaml {
  /** The first document, or null when the file is empty or has errors. */
  root: YNode | null;
  documents: number;
  /** Parse errors, as "line N: message". */
  errors: string[];
}

/** Aliases deeper than this are not followed (protects against alias loops). */
const MAX_ALIAS_DEPTH = 20;

class Converter {
  constructor(
    private readonly doc: Document,
    private readonly lines: LineCounter,
  ) {}

  lineAt(offset: number | undefined): number {
    return offset === undefined ? 1 : this.lines.linePos(offset).line;
  }

  convert(node: unknown, depth = 0): YNode {
    if (isAlias(node)) {
      const target = depth < MAX_ALIAS_DEPTH ? node.resolve(this.doc) : undefined;
      if (target === undefined) return { kind: 'scalar', line: 1, endLine: 1, value: null };
      return this.convert(target, depth + 1);
    }
    if (isMap(node)) {
      const own: YEntry[] = [];
      const merged: YEntry[] = [];
      for (const pair of node.items) {
        const keyNode = pair.key as Node | null;
        const key = isScalar(keyNode) ? String(keyNode.value) : '';
        const keyLine = this.lineAt(keyNode?.range?.[0]);
        const value = this.convert(pair.value, depth);
        const plainKey =
          isScalar(keyNode) && (keyNode.type === undefined || keyNode.type === 'PLAIN');
        if (key === '<<' && plainKey) {
          const sources = value.kind === 'seq' ? value.items : [value];
          for (const source of sources) {
            if (source.kind === 'map') merged.push(...source.entries);
          }
          continue;
        }
        own.push({ key, keyLine, value });
      }
      const ownKeys = new Set(own.map((entry) => entry.key));
      const seen = new Set<string>();
      const fromMerge = merged.filter((entry) => {
        if (ownKeys.has(entry.key) || seen.has(entry.key)) return false;
        seen.add(entry.key);
        return true;
      });
      return { kind: 'map', line: this.lineAt(node.range?.[0]), entries: [...own, ...fromMerge] };
    }
    if (isSeq(node)) {
      return {
        kind: 'seq',
        line: this.lineAt(node.range?.[0]),
        items: node.items.map((item) => this.convert(item, depth)),
      };
    }
    if (isScalar(node)) {
      const value = node.value;
      const plain =
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
          ? value
          : node.toString();
      return {
        kind: 'scalar',
        line: this.lineAt(node.range?.[0]),
        endLine: this.lineAt(Math.max((node.range?.[1] ?? 1) - 1, node.range?.[0] ?? 0)),
        value: plain,
      };
    }
    return { kind: 'scalar', line: 1, endLine: 1, value: null };
  }
}

/** Parses YAML text. Only the first document is converted. */
export function parseYaml(text: string): ParsedYaml {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter, prettyErrors: false, uniqueKeys: false });
  if (!Array.isArray(docs)) return { root: null, documents: 0, errors: [] };
  const errors: string[] = [];
  for (const doc of docs) {
    for (const error of doc.errors) {
      const line = lineCounter.linePos(error.pos[0]).line;
      errors.push(`line ${line}: ${error.message.split('\n')[0] ?? ''}`);
    }
  }
  const first = docs[0];
  if (!first || errors.length > 0) return { root: null, documents: docs.length, errors };
  const root =
    first.contents === null ? null : new Converter(first, lineCounter).convert(first.contents);
  return { root, documents: docs.length, errors };
}

/** The value of a key in a map, or undefined. */
export function get(node: YNode | undefined, key: string): YNode | undefined {
  if (node?.kind !== 'map') return undefined;
  return node.entries.find((entry) => entry.key === key)?.value;
}

/** The entry of a key in a map, or undefined. */
export function entry(node: YNode | undefined, key: string): YEntry | undefined {
  if (node?.kind !== 'map') return undefined;
  return node.entries.find((e) => e.key === key);
}

/** A scalar as a string ("" for null); undefined for maps and sequences. */
export function str(node: YNode | undefined): string | undefined {
  if (node?.kind !== 'scalar') return undefined;
  return node.value === null ? '' : String(node.value);
}

/** A string or a sequence of strings as a list. */
export function strList(node: YNode | undefined): string[] {
  if (node === undefined) return [];
  if (node.kind === 'seq')
    return node.items.flatMap((item) => (item.kind === 'scalar' ? [str(item) ?? ''] : []));
  const value = str(node);
  return value === undefined ? [] : [value];
}

/** The last line of a node. */
export function endLine(node: YNode): number {
  if (node.kind === 'scalar') return node.endLine;
  const children = node.kind === 'map' ? node.entries.map((e) => e.value) : node.items;
  const last = children[children.length - 1];
  return last ? Math.max(node.line, endLine(last)) : node.line;
}
