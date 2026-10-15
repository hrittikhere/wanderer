// The stylesheet has no runtime in Node; these assertions pin the rules that
// carry accessibility and layout guarantees so a refactor cannot drop them.
import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'), 'utf8');

/** The declaration block of the first rule whose selector list contains the given selector. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[\\n}])[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`, 'm').exec(css);
  assert.ok(match, `rule for ${selector} exists`);
  return match[1];
}

/** Every `@media <query>` block in source order, each with its balanced braces. */
function mediaBlocks(query: string): string[] {
  const blocks: string[] = [];
  for (let start = css.indexOf(`@media ${query}`); start >= 0; start = css.indexOf(`@media ${query}`, start + 1)) {
    let depth = 0;
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') { depth -= 1; if (depth === 0) { blocks.push(css.slice(start, index + 1)); break; } }
    }
  }
  assert.ok(blocks.length > 0, `media block ${query} exists`);
  return blocks;
}

function mediaBlock(query: string): string {
  return mediaBlocks(query).join('\n');
}

/** Custom properties as the cascade resolves them for a root with these attributes, nested in optional host hints. */
function tokensFor(theme: string, hints: string[] = []): CSSStyleDeclaration {
  const open = hints.map((hint) => `<div data-wanderer-scheme="${hint}">`).join('');
  const close = hints.map(() => '</div>').join('');
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${open}<section class="wanderer" data-wanderer-theme="${theme}"></section>${close}</body></html>`);
  return dom.window.getComputedStyle(dom.window.document.querySelector('.wanderer')!);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The custom properties a rule block declares, as name to value. */
function declarations(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(--wanderer-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
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
    // Only the contents of the (pointer: coarse) blocks count, never the rules that follow them.
    const coarse = mediaBlock('(pointer: coarse)');
    for (const selector of ['.wanderer-search__clear', '.wanderer-link-button', '.wanderer-globe__location-button', '.wanderer-action', '.wanderer-milestone__photo']) {
      const rule = new RegExp(`${selector.replace(/[.]/g, '\\.')}[^{]*\\{[^}]*(?:min-)?block-size:\\s*var\\(--wanderer-control-height\\)`);
      assert.ok(rule.test(coarse), `${selector} gets a 44px block size under (pointer: coarse)`);
    }
    assert.ok(/\.wanderer-search__clear\s*\{[^}]*inline-size:\s*var\(--wanderer-control-height\)/.test(coarse));
  });

  test('text fields stay at 16px or more on touch devices, so iOS Safari does not zoom on focus', () => {
    const coarse = mediaBlock('(pointer: coarse)');
    assert.ok(/\.wanderer-search__input,\s*\.wanderer-globe__milestones select\s*\{[^}]*font-size:\s*max\(16px,/.test(coarse));
  });

  test('the location panel indents with logical padding', () => {
    const panel = block('.wanderer-globe__location-panel');
    assert.ok(panel.includes('padding-inline: var(--wanderer-space-4) 0'));
    assert.equal(/padding:\s/.test(panel), false, 'no physical shorthand');
  });

  test('the callout sits beside the stage only when GlobeView measured room for it', () => {
    const wide = mediaBlocks('(min-width: 1024px)');
    assert.ok(wide.length >= 2, 'both the shell and the globe layout blocks are inspected');
    for (const media of wide) assert.equal(/\.wanderer-globe__callout[^{]*\{/.test(media), false, 'placement is not tied to the viewport width');
    const beside = block('.wanderer-globe__stage[data-wanderer-callout="beside"] .wanderer-globe__callout');
    assert.ok(beside.includes('inset-inline-start: 104%') && beside.includes('inline-size: 13rem'));
    const base = block('.wanderer-globe__callout');
    assert.ok(base.includes('position: relative') && base.includes('max-block-size'), 'the default card stays bounded in document flow');
    assert.ok(/max-block-size:\s*min\(20rem, 58%\)/.test(beside), 'beside the stage the card ends at the stage bottom instead of covering the controls');
  });

  test('the unsafe-link text fallback drops pointer, hover and press feedback', () => {
    const fallback = block('.wanderer-action[data-wanderer-unsafe]');
    assert.ok(fallback.includes('pointer-events: none'), 'hover and :active never match');
    assert.ok(fallback.includes('cursor: default'));
  });

  test('forced-colors hover and active states stay in system colors', () => {
    const forced = mediaBlock('(forced-colors: active)');
    for (const selector of ['.wanderer-chip:hover', '.wanderer-views__button:hover', '.wanderer-button:hover', '.wanderer-action:hover', '.wanderer-search__input:hover', '.wanderer-chip:active']) {
      assert.ok(forced.includes(selector), `${selector} has a forced-colors rule`);
    }
    assert.ok(/\.wanderer-chip:hover,[^{]*\{[^}]*background: ButtonFace;[^}]*color: ButtonText;/s.test(forced));
    assert.equal(/\.wanderer-chip:hover,[^{]*\{[^}]*var\(--wanderer-control-hover-bg\)/s.test(forced), false);
  });

  test('the search field boundary has 3:1 contrast against the field and the page in both palettes (WCAG 1.4.11)', () => {
    for (const theme of ['light', 'dark']) {
      const tokens = tokensFor(theme);
      const border = tokens.getPropertyValue('--wanderer-input-border').trim();
      for (const surface of ['--wanderer-control-bg', '--wanderer-bg']) {
        const ratio = contrast(border, tokens.getPropertyValue(surface).trim());
        assert.ok(ratio >= 3, `${theme}: input border on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
    assert.ok(block('.wanderer-search__input').includes('border: 1px solid var(--wanderer-input-border)'));
  });

  test('the system dark palette declares exactly the tokens of the explicit dark palette', () => {
    const explicit = declarations(block('.wanderer[data-wanderer-theme="dark"]'));
    const system = declarations(/\.wanderer\[data-wanderer-theme="system"\]:not\(\[data-wanderer-scheme="light"\] \*\)\s*\{([^}]*)\}/.exec(mediaBlock('(prefers-color-scheme: dark)'))![1]);
    assert.deepEqual([...system].sort(), [...explicit].sort());
  });

  test('the nearest data-wanderer-scheme hint wins, as in useColorScheme', () => {
    const background = (hints: string[]) => tokensFor('system', hints).getPropertyValue('--wanderer-bg').trim();
    assert.equal(background(['dark']), '#09090b');
    assert.equal(background(['dark', 'light']), '#ffffff', 'a light hint inside a dark one paints light');
    assert.equal(background(['light', 'dark']), '#09090b');
    assert.equal(background(['dark', 'light', 'dark']), '#09090b');
    assert.equal(background(['dark', 'light', 'dark', 'light']), '#ffffff');
    assert.equal(tokensFor('dark', ['light']).getPropertyValue('--wanderer-bg').trim(), '#09090b', 'an explicit theme ignores hints');
  });

  test('milestone dots use physical left/top, which the renderer writes, so RTL does not pin them to the right edge', () => {
    const dot = block('.wanderer-globe__milestone-dot');
    assert.ok(/\bleft: 0;/.test(dot) && /\btop: 0;/.test(dot));
    assert.equal(/inset-inline|inset-block|inset:/.test(dot), false);
  });

  test('long location and region names wrap inside the tooltip and the panel', () => {
    assert.ok(block('.wanderer-globe__tooltip-header').includes('overflow-wrap: anywhere'));
    const region = block('.wanderer-globe__region-name');
    assert.ok(region.includes('min-inline-size: 0') && region.includes('overflow-wrap: anywhere'));
  });

  test('the Dismiss button leaves room for its focus ring inside the scrolling callout', () => {
    const dismiss = block('.wanderer-globe__dismiss');
    assert.ok(/margin-block: 0\.3125rem/.test(dismiss) && /margin-inline-start: 0\.3125rem/.test(dismiss), '3px forced-colors outline plus 2px offset');
  });

  test('every transition and animation follows --wanderer-easing', () => {
    const motion = [...css.matchAll(/(?:transition|animation)(?:-timing-function)?:([^;]+);/g)].map(([, value]) => value);
    for (const value of motion) {
      assert.equal(/\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/.test(value), false, `literal timing function in: ${value.trim()}`);
    }
  });

  test('the globe panel and stage are placed by grid columns, never reordered, so focus order follows the layout', () => {
    assert.equal(/\border:/.test(css), false, 'no CSS order swap separates visual and focus order');
    const wide = mediaBlocks('(min-width: 1024px)').join('\n');
    assert.ok(/\.wanderer-globe__stage-wrap\s*\{[^}]*grid-column: 2/.test(wide));
    assert.ok(/\.wanderer-globe__panel\s*\{[^}]*grid-column: 1/.test(wide));
  });

  test("the RTL callout entrance keys off the component's own direction, not the host page's", () => {
    assert.ok(css.includes('.wanderer[dir="rtl"] .wanderer-globe__stage[data-wanderer-callout="beside"] .wanderer-globe__callout'));
    assert.equal(/(?:^|\n)\[dir="rtl"\]/.test(css), false);
  });
});
