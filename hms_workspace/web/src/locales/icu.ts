/**
 * Minimal ICU MessageFormat subset for the custom locale resources (no FormatJS — CLAUDE.md §8).
 * Supported: `{arg}`, `{arg, plural, =0 {…} one {# …} other {…}}`, `{arg, select, a {…} other {…}}`, nesting,
 * `#` inside plural branches, and ICU apostrophe quoting (`''` → `'`, `'{'` → literal brace).
 * Anything else is a catalog error: `parse` throws so the catalog test fails loudly instead of rendering garbage.
 */
export type MessageValue = string | number;
export type MessageValues = Record<string, MessageValue>;

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'arg'; name: string }
  | { kind: 'pound' }
  | { kind: 'plural'; name: string; branches: Record<string, Node[]> }
  | { kind: 'select'; name: string; branches: Record<string, Node[]> };

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): Node[] {
    const nodes = this.nodes(false, false);
    if (this.i < this.src.length) throw this.error('unexpected "}"');
    return nodes;
  }

  private error(msg: string): Error {
    return new Error(`ICU: ${msg} at ${this.i} in "${this.src}"`);
  }

  /** Reads nodes until the end of input, or until the `}` that closes the current branch (`inBranch`). */
  private nodes(inBranch: boolean, inPlural: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push({ kind: 'text', value: text });
      text = '';
    };
    while (this.i < this.src.length) {
      const ch = this.src[this.i]!;
      if (ch === "'") {
        const next = this.src[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = this.src.indexOf("'", this.i + 1);
          if (end < 0) throw this.error('unterminated quote');
          text += this.src.slice(this.i + 1, end);
          this.i = end + 1;
          continue;
        }
        text += ch;
        this.i += 1;
        continue;
      }
      if (ch === '{') {
        flush();
        out.push(this.placeholder());
        continue;
      }
      if (ch === '}') {
        if (!inBranch) throw this.error('unexpected "}"');
        break;
      }
      if (ch === '#' && inPlural) {
        flush();
        out.push({ kind: 'pound' });
        this.i += 1;
        continue;
      }
      text += ch;
      this.i += 1;
    }
    flush();
    return out;
  }

  private skipSpace() {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i += 1;
  }

  private word(): string {
    this.skipSpace();
    const m = /^[^\s,{}]+/.exec(this.src.slice(this.i));
    if (!m) throw this.error('expected a name');
    this.i += m[0].length;
    return m[0];
  }

  private expect(ch: string) {
    this.skipSpace();
    if (this.src[this.i] !== ch) throw this.error(`expected "${ch}"`);
    this.i += 1;
  }

  private placeholder(): Node {
    this.expect('{');
    const name = this.word();
    this.skipSpace();
    if (this.src[this.i] === '}') {
      this.i += 1;
      return { kind: 'arg', name };
    }
    this.expect(',');
    const type = this.word();
    if (type !== 'plural' && type !== 'select') throw this.error(`unsupported type "${type}"`);
    this.expect(',');
    const branches: Record<string, Node[]> = {};
    for (;;) {
      this.skipSpace();
      if (this.src[this.i] === '}') {
        this.i += 1;
        break;
      }
      const key = this.word();
      this.expect('{');
      branches[key] = this.nodes(true, type === 'plural');
      this.expect('}');
    }
    if (!branches.other) throw this.error(`${type} needs an "other" branch`);
    return { kind: type, name, branches };
  }
}

const cache = new Map<string, Node[]>();

export function parseMessage(src: string): Node[] {
  let nodes = cache.get(src);
  if (!nodes) {
    nodes = new Parser(src).parse();
    cache.set(src, nodes);
  }
  return nodes;
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(tag: string, n: number): string {
  let rules = pluralRules.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRules.set(tag, rules);
  }
  return rules.select(n);
}

function render(nodes: Node[], values: MessageValues, tag: string, pound: number | null): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'arg': {
        const v = values[node.name];
        out +=
          v === undefined ? `{${node.name}}` : typeof v === 'number' ? v.toLocaleString(tag) : v;
        break;
      }
      case 'pound':
        out += pound === null ? '#' : pound.toLocaleString(tag);
        break;
      case 'plural': {
        const n = Number(values[node.name] ?? 0);
        const branch =
          node.branches[`=${n}`] ?? node.branches[pluralCategory(tag, n)] ?? node.branches.other!;
        out += render(branch, values, tag, n);
        break;
      }
      case 'select': {
        const key = String(values[node.name] ?? 'other');
        out += render(node.branches[key] ?? node.branches.other!, values, tag, pound);
        break;
      }
    }
  }
  return out;
}

/** Formats one catalog message. `tag` is the BCP 47 tag used for plural rules and number formatting. */
export function formatMessage(src: string, values: MessageValues = {}, tag = 'id-ID'): string {
  return render(parseMessage(src), values, tag, null);
}
