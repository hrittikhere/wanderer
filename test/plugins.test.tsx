import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { collectContributions, registerPlugins } from '../src/plugins.js';
import { Talks, definePlugin, useTalks } from '../src/index.js';
import type { SearchSlotProps, TalkRendererProps, TalkViewProps, TalksPlugin } from '../src/component-types.js';
import { click, installDom, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();

describe('registerPlugins and collectContributions', () => {
  test('orders by order then code-point id and keeps the input untouched', () => {
    const input = [{ id: 'b' }, { id: 'a', order: 1 }, { id: 'B' }, { id: 'c', order: -1 }, { id: 'a0' }];
    const ordered = registerPlugins(input);
    assert.deepEqual(ordered.map((item) => item.id), ['c', 'B', 'a0', 'b', 'a']);
    assert.deepEqual(input.map((item) => item.id), ['b', 'a', 'B', 'c', 'a0']);
  });

  test('orders equal-order ids by code point, never by UTF-16 code unit', () => {
    const ordered = registerPlugins([{ id: '\u{1D400}' }, { id: '\uFF21' }, { id: 'a' }]);
    assert.deepEqual(ordered.map((item) => item.id), ['a', '\uFF21', '\u{1D400}']);
  });

  test('throws on duplicate, reserved, blank, padded, or non-finite-order ids', () => {
    assert.throws(() => registerPlugins([{ id: 'x' }, { id: 'x' }]), /Duplicate or reserved/);
    assert.throws(() => registerPlugins([{ id: 'list' }], ['list']), /Duplicate or reserved plugin\/contribution ID: list/);
    assert.throws(() => registerPlugins([{ id: '' }]), /nonempty/);
    assert.throws(() => registerPlugins([{ id: ' padded' }]), /surrounding whitespace/);
    assert.throws(() => registerPlugins([{ id: 'x', order: Number.NaN }]), /Invalid order/);
    assert.doesNotThrow(() => registerPlugins([{ id: 'x' }, { id: 'X' }]), 'ids are case sensitive');
  });

  test('collectContributions flattens plugin contributions into one ordered namespace', () => {
    const plugins = [
      { id: 'second', order: 2, filters: [{ id: 'zeta' }, { id: 'alpha', order: 5 }] },
      { id: 'first', order: 1, filters: [{ id: 'beta' }] },
      { id: 'none', filters: undefined },
    ];
    const filters = collectContributions(plugins, (plugin) => plugin.filters);
    assert.deepEqual(filters.map((item) => item.id), ['beta', 'zeta', 'alpha']);
    assert.throws(() => collectContributions(plugins, (plugin) => plugin.filters, ['beta']), /reserved plugin\/contribution ID: beta/);
    assert.throws(() => collectContributions([{ id: 'a', filters: [{ id: 'dup' }] }, { id: 'b', filters: [{ id: 'dup' }] }], (plugin) => plugin.filters), /dup/);
  });

  test('definePlugin returns the same object', () => {
    const plugin = { id: 'identity' };
    assert.equal(definePlugin(plugin), plugin);
  });
});

describe('plugins through <Talks>', () => {
  let dom: DomHandle;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = installDom({ width: 1440 });
    container = dom.document.getElementById('root')!;
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    dom.cleanup();
  });

  async function render(props: Record<string, unknown>) {
    await act(async () => {
      root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, ...props }));
    });
    return container.querySelector('.wanderer') as HTMLElement;
  }

  const buttons = (section: Element, selector: string) => [...section.querySelectorAll<HTMLButtonElement>(selector)];

  test('rejecting preloads are contained on focus and a later activation still works', async () => {
    let attempts = 0;
    const section = await render({ views: [{ id: 'lazy', label: 'Lazy', Component: () => createElement('p', null, 'Loaded view'), preload: () => { attempts += 1; return Promise.reject(new Error('offline')); } }] });
    const button = buttons(section, '.wanderer-views__button').find((item) => item.textContent === 'Lazy')!;
    await act(async () => { button.focus(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(attempts, 1);
    await act(async () => { click(button, dom.window); });
    assert.ok(section.textContent?.includes('Loaded view'));
  });

  test('unsafe plugin links stay readable without a navigable anchor or router invocation', async () => {
    const section = await render({ plugins: [definePlugin({ id: 'unsafe', actions: [{ id: 'bad', label: 'Unsafe resource', getLink: () => ({ kind: 'general', url: 'javascript:void(0)' }) }] })] });
    assert.equal(section.querySelector('a[href^="javascript:"]'), null);
    assert.equal(section.querySelectorAll('span.wanderer-action').length, FIXTURE_TALKS.length);
    assert.ok(section.textContent?.includes('Unsafe resource'));
  });

  test('a plugin filter appears as a chip after the built-ins and narrows the list when toggled', async () => {
    const plugin = definePlugin({
      id: 'harbor',
      filters: [{ id: 'harbor-only', order: 10, label: 'Harbor only', predicate: (talk: { event: string }) => talk.event === 'Harbor Conf' }],
    });
    const section = await render({ plugins: [plugin] });
    const chips = buttons(section, '.wanderer-chip');
    assert.deepEqual(chips.map((chip) => chip.textContent), ['With recording', 'Upcoming only', 'Harbor only']);
    await act(async () => { click(chips[2], dom.window); });
    assert.equal(chips[2].getAttribute('aria-pressed'), 'true');
    const titles = [...section.querySelectorAll('.wanderer-talk__title')].map((node) => node.textContent);
    assert.deepEqual(titles, ['Beacon Observability Patterns', 'Ember Networking Deep Dive']);
    assert.equal(section.querySelector('.wanderer-toolbar__count span')?.textContent, '2 of 5 talks');
  });

  test('an unordered plugin filter sorts among the order-0 built-ins by id', async () => {
    const plugin = definePlugin({ id: 'z', filters: [{ id: 'aaa', label: 'AAA', predicate: () => true }, { id: 'zzz', label: 'ZZZ', predicate: () => true }] });
    const section = await render({ plugins: [plugin] });
    assert.deepEqual(buttons(section, '.wanderer-chip').map((chip) => chip.textContent), ['AAA', 'With recording', 'ZZZ', 'Upcoming only']);
  });

  test('a plugin action renders as a button (onAction) or a typed link (getLink), honoring when()', async () => {
    const calls: string[] = [];
    const plugin: TalksPlugin = definePlugin({
      id: 'extras',
      actions: [
        {
          id: 'share',
          label: (talk) => `Share ${talk.id}`,
          onAction: (talk, context) => { calls.push(`${talk.id}:${context.instanceId.length > 0}`); },
        },
        {
          id: 'transcript',
          label: 'Transcript',
          when: (talk) => talk.id === 'aurora-2030',
          getLink: (talk) => ({ kind: 'general', url: `https://transcripts.example/${talk.id}` }),
        },
      ],
    });
    const section = await render({ plugins: [plugin] });
    const aurora = [...section.querySelectorAll('.wanderer-talk')].find((card) => card.textContent?.includes('Aurora'))!;
    const beacon = [...section.querySelectorAll('.wanderer-talk')].find((card) => card.textContent?.includes('Beacon'))!;
    const shareButton = buttons(aurora, 'button.wanderer-action').find((button) => button.textContent === 'Share aurora-2030')!;
    assert.ok(shareButton, 'share button rendered');
    assert.equal(shareButton.getAttribute('aria-label'), 'Share aurora-2030: Aurora Scheduling at Scale');
    await act(async () => { click(shareButton, dom.window); });
    assert.deepEqual(calls, ['aurora-2030:true']);
    const transcript = aurora.querySelector<HTMLAnchorElement>('a[href="https://transcripts.example/aurora-2030"]');
    assert.ok(transcript, 'transcript link rendered through the navigation layer');
    assert.equal(transcript.getAttribute('data-wanderer-link'), 'general');
    assert.equal(transcript.getAttribute('target'), '_blank');
    assert.ok(transcript.getAttribute('rel')?.includes('noopener'));
    assert.equal(beacon.querySelector('a[href^="https://transcripts.example/"]'), null, 'when() excluded this talk');
    assert.ok(buttons(beacon, 'button.wanderer-action').some((button) => button.textContent === 'Share beacon-2029'));
  });

  test('a plugin action with no link for a talk and no onAction is skipped instead of rendering an inert button', async () => {
    const transcripts: Record<string, string> = { 'aurora-2030': 'https://transcripts.example/aurora-2030' };
    const plugin = definePlugin({
      id: 'transcripts',
      actions: [
        { id: 'transcript', label: 'Transcript', getLink: (talk) => (transcripts[talk.id] ? { kind: 'general', url: transcripts[talk.id] } : undefined) },
        { id: 'nothing', label: 'Nothing' },
      ],
    });
    const section = await render({ plugins: [plugin] });
    assert.equal(section.querySelectorAll('button.wanderer-action').length, 0, 'no button without a handler');
    const rendered = [...section.querySelectorAll('.wanderer-action')].filter((node) => ['Transcript', 'Nothing'].includes(node.textContent ?? ''));
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].getAttribute('href'), 'https://transcripts.example/aurora-2030');
  });

  test('a plugin renderer with when() replaces the default card for matching talks only', async () => {
    function Compact({ talk }: TalkRendererProps) {
      return createElement('div', { className: 'custom-card', 'data-talk': talk.id }, talk.title.toUpperCase());
    }
    const plugin = definePlugin({
      id: 'compact',
      renderers: [{ id: 'compact-online', when: (talk: { format: string }) => talk.format === 'online', Component: Compact }],
    });
    const section = await render({ plugins: [plugin] });
    const custom = [...section.querySelectorAll('.custom-card')];
    assert.deepEqual(custom.map((node) => node.getAttribute('data-talk')), ['cinder-online']);
    assert.equal(custom[0].textContent, 'CINDER BUILD PIPELINES');
    assert.equal(section.querySelectorAll('.wanderer-talk').length, FIXTURE_TALKS.length - 1);
  });

  test('context.getActions falls back to the default label when a talk built outside validation has a blank link label', async () => {
    const labels: string[][] = [];
    function Probe({ talk, context }: TalkRendererProps) {
      const raw = { ...talk, links: [{ kind: 'general' as const, url: 'https://raw.example', label: '  ' }, { kind: 'general' as const, url: 'https://named.example', label: 'Notes' }] };
      labels.push(context.getActions(raw).filter((action) => action.link).map((action) => action.label));
      return createElement('div', { className: 'probe' }, talk.id);
    }
    await render({ talks: [FIXTURE_TALKS[2]], plugins: [definePlugin({ id: 'probe', renderers: [{ id: 'probe', Component: Probe }] })] });
    assert.ok(labels.length > 0, 'the renderer ran');
    assert.deepEqual(labels.at(-1), ['Link', 'Notes']);
  });

  test('a renderer that throws is contained by the error boundary and the rest still renders', async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      function Broken(): ReactNode { throw new Error('renderer exploded'); }
      const plugin = definePlugin({ id: 'broken', renderers: [{ id: 'explode', when: (talk: { id: string }) => talk.id === 'dune-hybrid', Component: Broken }] });
      const section = await render({ plugins: [plugin] });
      assert.equal(section.querySelectorAll('.wanderer-error').length, 1);
      assert.equal(section.querySelector('.wanderer-error')?.textContent, 'This part of the page failed to render.');
      assert.equal(section.querySelectorAll('.wanderer-talk').length, FIXTURE_TALKS.length - 1);
    } finally {
      console.error = originalError;
    }
  });

  test('a plugin view appears in the view switcher and can be selected', async () => {
    function Timeline({ context, headingId, viewId }: TalkViewProps) {
      return createElement('ol', { className: 'timeline', 'data-heading': headingId, 'data-view': viewId },
        context.talks.map((talk) => createElement('li', { key: talk.id }, talk.id)));
    }
    const plugin = definePlugin({ id: 'timeline', views: [{ id: 'timeline', label: 'Timeline', heading: 'Talks over time', Component: Timeline, order: 5 }] });
    const section = await render({ plugins: [plugin] });
    const viewButtons = buttons(section, '.wanderer-views__button');
    assert.deepEqual(viewButtons.map((button) => button.textContent), ['List', 'Timeline']);
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    await act(async () => { click(viewButtons[1], dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'timeline');
    const timeline = section.querySelector('.timeline')!;
    assert.equal(timeline.querySelectorAll('li').length, FIXTURE_TALKS.length);
    assert.equal(section.querySelector('.wanderer-view__heading')?.textContent, 'Talks over time');
    assert.equal(timeline.getAttribute('data-heading'), section.querySelector('.wanderer-view__heading')?.id);
    assert.equal(dom.document.activeElement?.id, timeline.getAttribute('data-heading'));
  });

  test('slots: props win over plugins, and among plugins the first ordered plugin wins', async () => {
    const make = (name: string) => function Slot({ id, value, onChange, label }: SearchSlotProps) {
      return createElement('input', { id, value, 'aria-label': label, 'data-slot': name, onChange: (event: { target: { value: string } }) => onChange(event.target.value) });
    };
    const pluginA = definePlugin({ id: 'a', order: 2, slots: { SearchInput: make('plugin-a') } });
    const pluginB = definePlugin({ id: 'b', order: 1, slots: { SearchInput: make('plugin-b') } });
    let section = await render({ plugins: [pluginA, pluginB] });
    assert.equal(section.querySelector('input')?.getAttribute('data-slot'), 'plugin-b', 'lower order wins among plugins');
    section = await render({ plugins: [pluginA, pluginB], slots: { SearchInput: make('props') } });
    assert.equal(section.querySelector('input')?.getAttribute('data-slot'), 'props', 'props override plugins');
  });

  test('a plugin that registers the reserved view id "list" throws', async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const plugin = definePlugin({ id: 'rogue', views: [{ id: 'list', label: 'Mine', Component: () => null }] });
      await assert.rejects(render({ plugins: [plugin] }), /Duplicate or reserved plugin\/contribution ID: list/);
    } finally {
      console.error = originalError;
    }
  });

  test('a plugin filter that reuses a built-in id throws, and duplicate plugin ids throw', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const reserved = definePlugin({ id: 'p', filters: [{ id: 'recording', label: 'x', predicate: () => true }] });
      await assert.rejects(render({ plugins: [reserved] }), /recording/);
      await assert.rejects(render({ plugins: [definePlugin({ id: 'same' }), definePlugin({ id: 'same' })] }), /same/);
    } finally {
      console.error = originalError;
    }
  });

  test('useTalks exposes the instance context to a plugin view', async () => {
    let seen: string | undefined;
    function Probe() {
      const context = useTalks();
      seen = `${context.talks.length}:${context.view}:${context.locale}`;
      return null;
    }
    await render({ plugins: [definePlugin({ id: 'probe', views: [{ id: 'probe', label: 'Probe', Component: Probe }] })], defaultView: 'probe', locale: 'fr-FR' });
    assert.equal(seen, '5:probe:fr-FR');
  });
});
