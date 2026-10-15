// The documentation states contracts the code has to keep: every copy key in
// the table is rendered somewhere, the entry tables list what the entries
// export, the SSR page classifies every prop, the globe options are
// documented, and code samples import the hooks they call.
import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultCopy } from '../src/copy.js';
import * as helpers from '../src/helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const sourceFiles = (dir: string): string[] => readdirSync(path.join(root, dir), { recursive: true })
  .map(String).filter((file) => /\.tsx?$/.test(file)).map((file) => path.join(dir, file));
const source = sourceFiles('src').map(read).join('\n');
const docs = ['README.md', ...readdirSync(path.join(root, 'docs')).filter((file) => file.endsWith('.md')).map((file) => `docs/${file}`)];

/** Names exported by an entry module, from its `export { ... }` and `export type { ... }` statements. */
function entryExports(file: string): string[] {
  return [...read(file).matchAll(/^export (?:type )?\{([^}]+)\}/gm)]
    .flatMap((match) => match[1].split(',').map((name) => name.trim().split(/\s+as\s+/).at(-1)!).filter(Boolean));
}

/** The keys of an interface or type literal declared in a source file. */
function interfaceKeys(file: string, name: string): string[] {
  const body = new RegExp(`export interface ${name}(?:<[^>]*>)? (?:extends [^{]+)?\\{([\\s\\S]*?)\\n\\}`).exec(read(file))![1];
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]);
}

/** The row of a Markdown table whose first cell is `cell`. */
function tableRow(markdown: string, cell: string): string {
  return markdown.split('\n').find((line) => line.startsWith(`| ${cell} |`)) ?? '';
}

describe('documentation', () => {
  test('the copy table lists every default key, and every key is rendered somewhere', () => {
    const configuration = read('docs/configuration.md');
    const copySection = configuration.slice(configuration.indexOf('## Copy'), configuration.indexOf('## Localization'));
    const documented = [...copySection.matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]);
    const keys = Object.keys(createDefaultCopy());
    assert.deepEqual([...documented].sort(), [...keys].sort(), 'the tables and createDefaultCopy() list the same keys');
    const linkAction = /^(event|recording|slides|detail|general)Action$/;
    const unread = keys.filter((key) => !new RegExp(`copy\\.${key}\\b`).test(source) && !(linkAction.test(key) && source.includes('copy[`${link.kind}Action`]')));
    assert.deepEqual(unread, [], 'every documented key reaches the page');
  });

  test('the README entry table names every export of the list and globe entries and every helper', () => {
    const readme = read('README.md');
    for (const [entry, file] of [['@wanderer/talks/list', 'src/list.ts'], ['@wanderer/talks/globe', 'src/globe.ts']]) {
      const row = tableRow(readme, `\`${entry}\``);
      const missing = entryExports(file).filter((name) => !row.includes(`\`${name}\``) && !row.includes(`\`${name}(`));
      assert.deepEqual(missing, [], `${entry} row`);
    }
    const helpersRow = tableRow(readme, '`@wanderer/talks/helpers`');
    assert.deepEqual(Object.keys(helpers).filter((name) => !helpersRow.includes(`\`${name}\``)), [], '@wanderer/talks/helpers row');
  });

  test('the SSR page says for every Talks prop whether it can cross a Server Component boundary', () => {
    const ssr = read('docs/ssr.md');
    const boundary = ssr.slice(ssr.indexOf('A Server Component may import and render'), ssr.indexOf('Put these in a client adapter'));
    const missing = interfaceKeys('src/component-types.ts', 'TalksProps').filter((prop) => !boundary.includes(`\`${prop}\``) && !boundary.includes(`\`${prop}.`));
    assert.deepEqual(missing, []);
  });

  test('every globeView option is documented', () => {
    const ssr = read('docs/ssr.md');
    const missing = interfaceKeys('src/globe/GlobeView.tsx', 'GlobeViewOptions').filter((option) => !tableRow(ssr, `\`${option}\``));
    assert.deepEqual(missing, []);
  });

  test('code samples that import modules also import the hooks they call', () => {
    const problems: string[] = [];
    for (const file of docs) {
      for (const [, block] of read(file).matchAll(/```(?:ts|tsx|js|jsx)\n([\s\S]*?)```/g)) {
        if (!/^import /m.test(block)) continue;
        const imported = new Set([...block.matchAll(/^import [^;]*?\{([^}]+)\}/gm)].flatMap((match) => match[1].split(',').map((name) => name.trim().replace(/^type /, '').split(/\s+as\s+/).at(-1)!)));
        for (const [, hook] of block.matchAll(/\b(use[A-Z]\w*)\(/g)) {
          const declared = new RegExp(`(?:function|const|let) ${hook}\\b`).test(block);
          if (!imported.has(hook) && !declared) problems.push(`${file}: ${hook}`);
        }
      }
    }
    assert.deepEqual([...new Set(problems)], []);
  });
});
