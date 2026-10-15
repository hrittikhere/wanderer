// node:assert/strict, made safe for DOM nodes. When an equality assertion
// fails, Node renders a diff of both values with getters invoked and a depth
// of 1000; for a jsdom element that walks the whole window and document graph
// until the process runs out of memory and is killed, which hides every test
// after it. Here a comparison involving a DOM node is decided by identity and
// reported with a one-line description instead.
import strict from 'node:assert/strict';

function isNode(value: unknown): value is { nodeType: number; nodeName: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { nodeType?: unknown }).nodeType === 'number'
    && typeof (value as { nodeName?: unknown }).nodeName === 'string';
}

function describeValue(value: unknown): string {
  if (!isNode(value)) return typeof value === 'string' ? JSON.stringify(value) : String(value);
  const element = value as unknown as { id?: string; className?: unknown; textContent?: string | null };
  const id = element.id ? `#${element.id}` : '';
  const classes = typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : '';
  const text = (element.textContent ?? '').trim().slice(0, 40);
  return `<${value.nodeName.toLowerCase()}${id}${classes}>${text ? ` "${text}"` : ''}`;
}

function fail(actual: unknown, expected: unknown, operator: string, message?: string | Error): never {
  if (message instanceof Error) throw message;
  const summary = `${describeValue(actual)} ${operator === 'notStrictEqual' ? '===' : '!=='} ${describeValue(expected)}`;
  throw new strict.AssertionError({ message: message ? `${message}\n${summary}` : summary, actual: describeValue(actual), expected: describeValue(expected), operator });
}

function equal(actual: unknown, expected: unknown, message?: string | Error): void {
  if (isNode(actual) || isNode(expected)) {
    if (!Object.is(actual, expected)) fail(actual, expected, 'strictEqual', message);
    return;
  }
  strict.equal(actual, expected, message);
}

function notEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (isNode(actual) || isNode(expected)) {
    if (Object.is(actual, expected)) fail(actual, expected, 'notStrictEqual', message);
    return;
  }
  strict.notEqual(actual, expected, message);
}

const assert: typeof strict = Object.assign(
  ((value: unknown, message?: string | Error) => strict.ok(value, message)) as typeof strict,
  strict,
  { equal, strictEqual: equal, notEqual, notStrictEqual: notEqual, strict: undefined as unknown as typeof strict },
);
assert.strict = assert;

export default assert;
