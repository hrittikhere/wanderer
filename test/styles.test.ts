// The stylesheet has no runtime in Node; these assertions pin the rules that
// carry accessibility and layout guarantees so a refactor cannot drop them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'), 'utf8');

/** The declaration block of the first rule whose selector list contains the given selector. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[\\n}])[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`, 'm').exec(css);
  assert.ok(match, `rule for ${selector} exists`);
  return match[1];
}

function mediaBlock(query: string): string {
  const start = css.indexOf(`@media ${query}`);
  assert.ok(start >= 0, `media block ${query} exists`);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') { depth -= 1; if (depth === 0) return css.slice(start, index + 1); }
  }
  throw new Error(`unterminated media block ${query}`);
}

describe('styles.css contract', () => {
  test('the shared focus-visible rule never overrides a control radius', () => {
    const focus = block('.wanderer :where(a, button, input, select, [tabindex]):focus-visible');
    assert.ok(focus.includes('outline:'), 'draws an outline');
    assert.equal(focus.includes('border-radius'), false, 'pill controls keep their shape while focused');
    assert.ok(block('.wanderer-talk__title-link:focus-visible').includes('border-radius'), 'text links get a radius of their own');
  });

  test('the visually-hidden heading is revealed only for keyboard-driven focus', () => {
    assert.equal(/\.wanderer-visually-hidden--focusable:focus\s*[,{]/.test(css), false, 'no plain :focus reveal');
    assert.ok(/\.wanderer-visually-hidden--focusable:focus-visible\s*\{/.test(css));
  });

  test('every primary control reaches the 44px target on coarse pointers', () => {
    const coarse = css.split('@media (pointer: coarse)').slice(1).join('\n');
    for (const selector of ['.wanderer-search__clear', '.wanderer-link-button', '.wanderer-globe__location-button', '.wanderer-action']) {
      assert.ok(coarse.includes(selector), `${selector} is bumped under (pointer: coarse)`);
    }
    assert.ok(/\.wanderer-search__clear\s*\{[^}]*inline-size:\s*var\(--wanderer-control-height\)/.test(coarse));
  });

  test('the location panel indents with logical padding', () => {
    const panel = block('.wanderer-globe__location-panel');
    assert.ok(panel.includes('padding-inline: var(--wanderer-space-4) 0'));
    assert.equal(/padding:\s/.test(panel), false, 'no physical shorthand');
  });

  test('the callout sits beside the stage only when GlobeView measured room for it', () => {
    assert.equal(/@media \(min-width: 1024px\)[^@]*\.wanderer-globe__callout\s*\{/.test(mediaBlock('(min-width: 1024px)')), false, 'placement is not tied to the viewport width');
    const beside = block('.wanderer-globe__stage[data-wanderer-callout="beside"] .wanderer-globe__callout');
    assert.ok(beside.includes('inset-inline-start: 104%') && beside.includes('inline-size: 13rem'));
    const base = block('.wanderer-globe__callout');
    assert.ok(base.includes('position: relative') && base.includes('max-block-size'), 'the default card stays bounded in document flow');
  });

  test('forced-colors hover and active states stay in system colors', () => {
    const forced = mediaBlock('(forced-colors: active)');
    for (const selector of ['.wanderer-chip:hover', '.wanderer-views__button:hover', '.wanderer-button:hover', '.wanderer-action:hover', '.wanderer-search__input:hover', '.wanderer-chip:active']) {
      assert.ok(forced.includes(selector), `${selector} has a forced-colors rule`);
    }
    assert.ok(/\.wanderer-chip:hover,[^{]*\{[^}]*background: ButtonFace;[^}]*color: ButtonText;/s.test(forced));
    assert.equal(/\.wanderer-chip:hover,[^{]*\{[^}]*var\(--wanderer-control-hover-bg\)/s.test(forced), false);
  });
});
