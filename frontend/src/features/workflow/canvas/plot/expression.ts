/** Bounded mathematical grammar. No JavaScript evaluation or property access. */
type Node = { type: 'number'; value: number } | { type: 'x' }
  | { type: 'unary'; op: string; child: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; child: Node };

const FUNCTIONS: Record<string, (value: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
};

function evaluate(node: Node, x: number): number {
  switch (node.type) {
    case 'number': return node.value;
    case 'x': return x;
    case 'unary': return (node.op === '-' ? -1 : 1) * evaluate(node.child, x);
    case 'call': return FUNCTIONS[node.name](evaluate(node.child, x));
    case 'binary': {
      const a = evaluate(node.left, x), b = evaluate(node.right, x);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        default: return a ** b;
      }
    }
  }
}

export function compileExpression(source: string): (x: number) => number {
  if (source.length > 256) throw new Error('Expression is too long');
  const input = source.trim().replace(/^y\s*=\s*/i, '').toLowerCase().replace(/π/g, 'pi');
  const tokens: string[] = [];
  let offset = 0;
  while (offset < input.length) {
    const match = /^(?:\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+\d*|[+\-*/^()])/.exec(input.slice(offset));
    if (!match) throw new Error('Unsupported symbol');
    offset += match[0].length;
    if (match[0].trim()) tokens.push(match[0]);
  }
  if (tokens.length > 128) throw new Error('Expression is too complex');
  let index = 0;
  function expression(minPrecedence = 0, depth = 0): Node {
    if (depth > 32) throw new Error('Expression is too deep');
    const token = tokens[index++];
    let left: Node;
    if (token === '+' || token === '-') {
      left = { type: 'unary', op: token, child: expression(3, depth + 1) };
    } else if (token === '(') {
      left = expression(0, depth + 1);
      if (tokens[index++] !== ')') throw new Error('Expected closing parenthesis');
    } else if (token === 'x') left = { type: 'x' };
    else if (token === 'pi' || token === 'e') left = { type: 'number', value: token === 'pi' ? Math.PI : Math.E };
    else if (token && Object.hasOwn(FUNCTIONS, token)) {
      if (tokens[index++] !== '(') throw new Error('Expected function parentheses');
      const child = expression(0, depth + 1);
      if (tokens[index++] !== ')') throw new Error('Expected closing parenthesis');
      left = { type: 'call', name: token, child };
    } else if (token && Number.isFinite(Number(token))) left = { type: 'number', value: Number(token) };
    else throw new Error('Expected a number, x or a supported function');

    while (index < tokens.length) {
      const op = tokens[index];
      const precedence = op === '+' || op === '-' ? 1 : op === '*' || op === '/' ? 2 : op === '^' ? 4 : -1;
      if (precedence < minPrecedence) break;
      index++;
      const right = expression(op === '^' ? precedence : precedence + 1, depth + 1);
      left = { type: 'binary', op, left, right };
    }
    return left;
  }
  const root = expression();
  if (index !== tokens.length) throw new Error('Unexpected token; use * for multiplication');
  return (x) => evaluate(root, x);
}
