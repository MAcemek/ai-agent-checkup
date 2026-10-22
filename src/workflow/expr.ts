/** GitHub Actions expressions: a small parser for `if:` conditions. */

export type Expr =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'context'; path: string }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'not'; expr: Expr }
  | { kind: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'compare'; op: '==' | '!=' | '<' | '<=' | '>' | '>='; left: Expr; right: Expr };

type Token =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'punct'; value: string };

const PUNCT = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '(',
  ')',
  '[',
  ']',
  '.',
  ',',
  '!',
  '<',
  '>',
  '*',
];

export class ExprError extends Error {
  override name = 'ExprError';
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length) throw new ExprError('unterminated string');
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i];
        i++;
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    const number = /^(?:0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (number && /[\d-]/.test(ch)) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i));
    if (ident) {
      tokens.push({ type: 'ident', value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const punct = PUNCT.find((p) => text.startsWith(p, i));
    if (!punct) throw new ExprError(`unexpected character "${ch}"`);
    tokens.push({ type: 'punct', value: punct });
    i += punct.length;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.or();
    if (this.pos < this.tokens.length) throw new ExprError('unexpected token');
    return expr;
  }

  private peek(value: string): boolean {
    const token = this.tokens[this.pos];
    return token?.type === 'punct' && token.value === value;
  }

  private expect(value: string): void {
    if (!this.peek(value)) throw new ExprError(`expected "${value}"`);
    this.pos++;
  }

  private or(): Expr {
    let left = this.and();
    while (this.peek('||')) {
      this.pos++;
      left = { kind: 'or', left, right: this.and() };
    }
    return left;
  }

  private and(): Expr {
    let left = this.equality();
    while (this.peek('&&')) {
      this.pos++;
      left = { kind: 'and', left, right: this.equality() };
    }
    return left;
  }

  private equality(): Expr {
    let left = this.relational();
    while (this.peek('==') || this.peek('!=')) {
      const op = (this.tokens[this.pos] as { value: '==' | '!=' }).value;
      this.pos++;
      left = { kind: 'compare', op, left, right: this.relational() };
    }
    return left;
  }

  private relational(): Expr {
    let left = this.unary();
    while (this.peek('<') || this.peek('<=') || this.peek('>') || this.peek('>=')) {
      const op = (this.tokens[this.pos] as { value: '<' | '<=' | '>' | '>=' }).value;
      this.pos++;
      left = { kind: 'compare', op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    if (this.peek('!')) {
      this.pos++;
      return { kind: 'not', expr: this.unary() };
    }
    return this.primary();
  }

  private primary(): Expr {
    const token = this.tokens[this.pos];
    if (!token) throw new ExprError('unexpected end');
    if (token.type === 'punct' && token.value === '(') {
      this.pos++;
      const expr = this.or();
      this.expect(')');
      return expr;
    }
    if (token.type === 'string' || token.type === 'number') {
      this.pos++;
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'ident') {
      this.pos++;
      const word = token.value.toLowerCase();
      if (word === 'true' || word === 'false') return { kind: 'literal', value: word === 'true' };
      if (word === 'null') return { kind: 'literal', value: null };
      if (this.peek('(')) {
        this.pos++;
        const args: Expr[] = [];
        if (!this.peek(')')) {
          args.push(this.or());
          while (this.peek(',')) {
            this.pos++;
            args.push(this.or());
          }
        }
        this.expect(')');
        return { kind: 'call', name: word, args };
      }
      return this.context(word);
    }
    throw new ExprError('unexpected token');
  }

  private context(first: string): Expr {
    const parts = [first];
    for (;;) {
      if (this.peek('.')) {
        this.pos++;
        const next = this.tokens[this.pos];
        if (next?.type === 'ident') parts.push(next.value.toLowerCase());
        else if (next?.type === 'punct' && next.value === '*') parts.push('*');
        else throw new ExprError('expected a property name');
        this.pos++;
      } else if (this.peek('[')) {
        this.pos++;
        const next = this.tokens[this.pos];
        if (next?.type === 'string') parts.push(next.value.toLowerCase());
        else if (next?.type === 'number') parts.push(String(next.value));
        else if (next?.type === 'punct' && next.value === '*') parts.push('*');
        else throw new ExprError('expected an index');
        this.pos++;
        this.expect(']');
      } else {
        return { kind: 'context', path: parts.join('.') };
      }
    }
  }
}

export function parseExpression(text: string): Expr {
  return new Parser(tokenize(text)).parse();
}

/**
 * Turns an `if:` value into an expression. A value that is one `${{ }}` block is unwrapped. A
 * value that mixes `${{ }}` with other text is a non-empty string, which GitHub treats as true.
 */
export function conditionExpression(text: string): Expr {
  const trimmed = text.trim();
  const whole = /^\$\{\{([\s\S]*)\}\}$/.exec(trimmed);
  if (whole && !whole[1]?.includes('${{') && !whole[1]?.includes('}}')) {
    return parseExpression(whole[1] ?? '');
  }
  if (trimmed.includes('${{')) return { kind: 'literal', value: trimmed };
  return parseExpression(trimmed);
}
