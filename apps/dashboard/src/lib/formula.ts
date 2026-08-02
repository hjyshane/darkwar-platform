/** A tiny arithmetic language over the metric catalogue.
 *
 * Parsed, never evaluated as JavaScript. `eval` and `new Function` would
 * hand anyone who can write a setting the ability to run code in every
 * reader's browser, and an admin account is not a reason to allow that —
 * the point of a formula is to divide two numbers, not to reach the DOM.
 *
 * The grammar is deliberately small. Everything it can express is a number:
 *
 *   expr    = term (('+' | '-') term)*
 *   term    = unary (('*' | '/') unary)*
 *   unary   = '-'? primary
 *   primary = number | identifier | '(' expr ')'
 *
 * No comparisons, no conditionals, no function calls. Each of those invites
 * a follow-up ("what does true render as?") that a stat tile has no answer
 * for, and none of them were asked for.
 *
 * ## Unknown is contagious
 *
 * Every value in this app is `number | null`, where null means "not
 * observed" or "not yours to see" — never zero (FR-UI-008). A formula is
 * where that discipline is easiest to lose: `weekly_donation / members`
 * with an unknown numerator is not 0, it is unknown, and rendering it as 0
 * would be inventing a fact out of two absent ones.
 *
 * So null propagates through every operator. Division by zero lands in the
 * same place: the result is undefined, and undefined is null here rather
 * than Infinity or NaN, both of which would reach the screen as text.
 */

export type Node =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'unary'; op: '-'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Node; right: Node };

export class FormulaError extends Error {}

/** Long enough for anything sensible, short enough that a pasted essay does
 *  not become a parse tree. */
const MAX_LENGTH = 200;

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i] as string;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i] as string)) {
        i += 1;
      }
      const text = input.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new FormulaError(`"${text}" is not a number`);
      }
      tokens.push({ type: 'num', value });
      continue;
    }
    if (/[a-z_]/i.test(char)) {
      const start = i;
      while (i < input.length && /[a-z0-9_]/i.test(input[i] as string)) {
        i += 1;
      }
      tokens.push({ type: 'id', value: input.slice(start, i) });
      continue;
    }
    if ('+-*/()'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      i += 1;
      continue;
    }
    throw new FormulaError(`"${char}" cannot be used in a formula`);
  }
  return tokens;
}

/** Parse, checking every identifier against the names actually available.
 *
 * Resolving names here rather than at evaluation time is what makes a bad
 * formula impossible to save: the admin form parses before writing, so the
 * overview only ever meets expressions it can compute. A name that stops
 * existing later is caught on the next parse, which happens on every read.
 */
export function parseFormula(input: string, known: readonly string[]): Node {
  if (input.trim() === '') {
    throw new FormulaError('A formula cannot be empty');
  }
  if (input.length > MAX_LENGTH) {
    throw new FormulaError(`A formula has to be under ${MAX_LENGTH} characters`);
  }
  const knownSet = new Set(known);
  const tokens = tokenize(input);
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (value: string) => {
    const token = peek();
    if (token?.type === 'op' && token.value === value) {
      pos += 1;
      return true;
    }
    return false;
  };

  function primary(): Node {
    const token = peek();
    if (token === undefined) {
      throw new FormulaError('The formula ends before it is finished');
    }
    if (token.type === 'num') {
      pos += 1;
      return { kind: 'number', value: token.value };
    }
    if (token.type === 'id') {
      pos += 1;
      if (!knownSet.has(token.value)) {
        throw new FormulaError(`"${token.value}" is not a figure this dashboard has`);
      }
      return { kind: 'ref', name: token.value };
    }
    if (eat('(')) {
      const inner = expr();
      if (!eat(')')) {
        throw new FormulaError('A "(" is never closed');
      }
      return inner;
    }
    throw new FormulaError(`"${token.value}" is not where a value should be`);
  }

  function unary(): Node {
    if (eat('-')) {
      return { kind: 'unary', op: '-', operand: unary() };
    }
    return primary();
  }

  function term(): Node {
    let left = unary();
    for (;;) {
      if (eat('*')) {
        left = { kind: 'binary', op: '*', left, right: unary() };
      } else if (eat('/')) {
        left = { kind: 'binary', op: '/', left, right: unary() };
      } else {
        return left;
      }
    }
  }

  function expr(): Node {
    let left = term();
    for (;;) {
      if (eat('+')) {
        left = { kind: 'binary', op: '+', left, right: term() };
      } else if (eat('-')) {
        left = { kind: 'binary', op: '-', left, right: term() };
      } else {
        return left;
      }
    }
  }

  const tree = expr();
  if (pos !== tokens.length) {
    const rest = tokens[pos];
    throw new FormulaError(
      rest?.type === 'op' && rest.value === ')'
        ? 'There is a ")" with no "(" to match'
        : 'The formula has something extra on the end',
    );
  }
  return tree;
}

/** Which figures a formula reads. Used to explain a tile, and to notice one
 *  that depends on something restricted. */
export function referencedNames(node: Node): string[] {
  switch (node.kind) {
    case 'ref':
      return [node.name];
    case 'unary':
      return referencedNames(node.operand);
    case 'binary':
      return [...new Set([...referencedNames(node.left), ...referencedNames(node.right)])];
    default:
      return [];
  }
}

/** Compute, propagating unknown. Returns null when any input is unknown, or
 *  when the arithmetic has no answer. */
export function evaluateFormula(node: Node, values: Record<string, number | null>): number | null {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'ref':
      return values[node.name] ?? null;
    case 'unary': {
      const operand = evaluateFormula(node.operand, values);
      return operand === null ? null : -operand;
    }
    case 'binary': {
      const left = evaluateFormula(node.left, values);
      const right = evaluateFormula(node.right, values);
      if (left === null || right === null) {
        return null;
      }
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        default: {
          // Undefined, not Infinity and not NaN. Both of those reach the
          // screen as text and read like a value.
          const result = left / right;
          return Number.isFinite(result) ? result : null;
        }
      }
    }
  }
}

/** Parse and compute in one step, for callers that hold the text. */
export function runFormula(
  input: string,
  known: readonly string[],
  values: Record<string, number | null>,
): number | null {
  return evaluateFormula(parseFormula(input, known), values);
}
