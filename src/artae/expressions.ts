// Artae: a small, safe expression language for the world profile's element rules. No eval: expressions are parsed
// once into closures over named per-cell fields. Grammar: numbers, field names, + - * / ^ (power, right-assoc),
// unary minus, parentheses and the functions min, max, clamp(x[, lo, hi]), pow(x, y), if(cond, then, else)
// (cond counts as true when it is not 0)

export type Fields = Record<string, ArrayLike<number>>;
export type Compiled = (fields: Fields, i: number) => number;

const FUNCTIONS: Record<string, { min: number; max: number; run: (args: number[]) => number }> = {
  min: { min: 1, max: Infinity, run: args => Math.min(...args) },
  max: { min: 1, max: Infinity, run: args => Math.max(...args) },
  clamp: { min: 1, max: 3, run: ([x, lo = 0, hi = 1]) => Math.max(lo, Math.min(hi, x)) },
  pow: { min: 2, max: 2, run: ([x, y]) => x ** y }
};

type Token = { type: "num"; value: number } | { type: "id"; value: string } | { type: "op"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unexpected "${source.slice(index).trim()[0]}" in "${source}"`);
    if (match[1] !== undefined) tokens.push({ type: "num", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: "id", value: match[2] });
    else tokens.push({ type: "op", value: match[3] });
    index = pattern.lastIndex;
  }
  return tokens;
}

/** Compile an expression; `names` are the fields it may read. Throws with a readable message on any error */
export function compile(source: string, names: readonly string[]): Compiled {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => peek()?.type === "op" && peek().value === value;
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`Expected "${value}" in "${source}"`);
    position++;
  };

  // expression := term (("+" | "-") term)*
  const expression = (): Compiled => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[position++].value;
      const [a, b] = [left, term()];
      left = op === "+" ? (f, i) => a(f, i) + b(f, i) : (f, i) => a(f, i) - b(f, i);
    }
    return left;
  };
  // term := unary (("*" | "/") unary)*
  const term = (): Compiled => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[position++].value;
      const [a, b] = [left, unary()];
      left = op === "*" ? (f, i) => a(f, i) * b(f, i) : (f, i) => a(f, i) / b(f, i);
    }
    return left;
  };
  // unary := "-" unary | power
  const unary = (): Compiled => {
    if (isOp("-")) {
      position++;
      const a = unary();
      return (f, i) => -a(f, i);
    }
    return power();
  };
  // power := primary ("^" unary)?   (right-associative, binds tighter than * and /)
  const power = (): Compiled => {
    const base = primary();
    if (!isOp("^")) return base;
    position++;
    const exponent = unary();
    return (f, i) => base(f, i) ** exponent(f, i);
  };
  const primary = (): Compiled => {
    const token = tokens[position++];
    if (!token) throw new Error(`Unexpected end of "${source}"`);
    if (token.type === "num") {
      const value = token.value;
      return () => value;
    }
    if (token.type === "op") {
      if (token.value !== "(") throw new Error(`Unexpected "${token.value}" in "${source}"`);
      const inner = expression();
      expect(")");
      return inner;
    }
    const name = token.value;
    if (isOp("(")) {
      position++;
      const args: Compiled[] = [];
      if (!isOp(")"))
        do args.push(expression());
        while (isOp(",") && ++position);
      expect(")");
      if (name === "if") {
        if (args.length !== 3) throw new Error(`if() takes 3 arguments in "${source}"`);
        const [condition, then, otherwise] = args;
        return (f, i) => (condition(f, i) !== 0 ? then(f, i) : otherwise(f, i));
      }
      const fn = FUNCTIONS[name];
      if (!fn)
        throw new Error(`Unknown function "${name}" in "${source}"; known: if, ${Object.keys(FUNCTIONS).join(", ")}`);
      if (args.length < fn.min || args.length > fn.max)
        throw new Error(`Wrong number of arguments for ${name}() in "${source}"`);
      return (f, i) => fn.run(args.map(arg => arg(f, i)));
    }
    if (!names.includes(name)) throw new Error(`Unknown field "${name}" in "${source}"; known: ${names.join(", ")}`);
    return (f, i) => f[name][i];
  };

  const compiled = expression();
  if (position < tokens.length) throw new Error(`Unexpected "${(tokens[position] as Token).value}" in "${source}"`);
  return compiled;
}
