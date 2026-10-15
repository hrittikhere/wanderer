// The navigation layer: TalkLinkAnchor's LinkComponent gating, onNavigate
// click handling, per-kind policies and primary link precedence, both
// directly and through <Talks navigation>.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { Talks, TalkLinkAnchor, type TalkLinkAnchorProps } from '../src/index.js';
import type { LinkComponentProps, NavigationOptions } from '../src/component-types.js';
import type { Talk, TalkLink } from '../src/types.js';
import { installDom, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();

const TALK: Talk = FIXTURE_TALKS[1];
const DETAIL: TalkLink = { kind: 'detail', url: '/talks/beacon-2029' };
const RECORDING: TalkLink = { kind: 'recording', url: 'https://videos.example/beacon' };
const GENERAL: TalkLink = { kind: 'general', url: 'https://notes.example/beacon' };

describe('navigation layer', () => {
  let dom: DomHandle;
  let root: Root;
  let container: HTMLElement;
  let navigations: { link: TalkLink; talk: Talk | undefined; prevented: boolean }[];
  let componentRenders: LinkComponentProps[];

  function FakeLink(props: LinkComponentProps) {
    componentRenders.push(props);
    return createElement('a', { ...props, 'data-via': 'component' });
  }

  const onNavigate: NonNullable<NavigationOptions['onNavigate']> = (link, talk, event) => {
    navigations.push({ link, talk, prevented: event.defaultPrevented });
  };

  beforeEach(() => {
    dom = installDom({ width: 1440 });
    container = dom.document.getElementById('root')!;
    root = createRoot(container);
    navigations = [];
    componentRenders = [];
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    dom.cleanup();
  });

  async function renderAnchor(link: TalkLink, navigation: NavigationOptions, props: Partial<Omit<TalkLinkAnchorProps, 'link' | 'navigation'>> = {}) {
    await act(async () => {
      root.render(createElement(TalkLinkAnchor, { link, talk: TALK, navigation, ...props }, 'Label'));
    });
    return container.firstElementChild as HTMLElement;
  }

  /** Dispatches a click and reports whether the browser default was prevented. */
  function clickWith(element: Element, init: MouseEventInit = {}): boolean {
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }

  test('an unmodified primary click on a same-window link prevents the default and calls onNavigate(link, talk, event)', async () => {
    const anchor = await renderAnchor(DETAIL, { onNavigate });
    assert.equal(anchor.tagName, 'A');
    assert.equal(clickWith(anchor), true);
    assert.equal(navigations.length, 1);
    assert.equal(navigations[0].link, DETAIL);
    assert.equal(navigations[0].talk, TALK);
    assert.equal(navigations[0].prevented, true, 'the default is prevented before onNavigate runs');
  });

  test('modifier, middle and secondary clicks keep native behavior', async () => {
    const anchor = await renderAnchor(DETAIL, { onNavigate });
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
      assert.equal(clickWith(anchor, init), false, JSON.stringify(init));
    }
    assert.equal(navigations.length, 0);
  });

  test('without onNavigate a primary click is never prevented', async () => {
    const anchor = await renderAnchor(DETAIL, {});
    assert.equal(clickWith(anchor), false);
  });

  test('new-tab and named-target links skip onNavigate; a _self policy routes through it', async () => {
    let anchor = await renderAnchor(RECORDING, { onNavigate });
    assert.equal(clickWith(anchor), false);
    anchor = await renderAnchor(DETAIL, { onNavigate, policies: { detail: { target: 'preview-frame' } } });
    assert.equal(clickWith(anchor), false);
    assert.equal(navigations.length, 0);
    anchor = await renderAnchor(RECORDING, { onNavigate, policies: { recording: { target: '_self' } } });
    assert.equal(anchor.getAttribute('target'), '_self');
    assert.equal(clickWith(anchor), true);
    assert.deepEqual(navigations.map((entry) => entry.link), [RECORDING]);
  });

  test('target keywords match case-insensitively: _BLANK stays a protected plain anchor, _SELF routes', async () => {
    const navigation: NavigationOptions = { LinkComponent: FakeLink, linkComponentKinds: ['general'], onNavigate, policies: { general: { target: '_BLANK' } } };
    let anchor = await renderAnchor(GENERAL, navigation);
    assert.equal(anchor.getAttribute('data-via'), null, 'new-tab links never render through LinkComponent');
    assert.equal(componentRenders.length, 0);
    assert.deepEqual(anchor.getAttribute('rel')?.split(' ').sort(), ['noopener', 'noreferrer']);
    assert.equal(clickWith(anchor), false);
    anchor = await renderAnchor(GENERAL, { ...navigation, policies: { general: { target: '_SELF' } } });
    assert.equal(anchor.getAttribute('data-via'), 'component');
    assert.equal(clickWith(anchor), true);
    assert.equal(navigations.length, 1);
  });

  test('a consumer onClick runs first, and its preventDefault suppresses onNavigate', async () => {
    const order: string[] = [];
    let anchor = await renderAnchor(DETAIL, { onNavigate: (...args) => { order.push('navigate'); onNavigate(...args); } }, { onClick: () => { order.push('consumer'); } });
    clickWith(anchor);
    assert.deepEqual(order, ['consumer', 'navigate']);
    anchor = await renderAnchor(DETAIL, { onNavigate }, { onClick: (event) => { event.preventDefault(); } });
    navigations = [];
    clickWith(anchor);
    assert.equal(navigations.length, 0);
  });

  test('links with a download attribute keep native behavior, on plain anchors and through LinkComponent', async () => {
    for (const download of ['slides.pdf', true] as const) {
      let anchor = await renderAnchor(DETAIL, { onNavigate }, { download });
      assert.equal(anchor.hasAttribute('download'), true);
      assert.equal(clickWith(anchor), false, `download=${download}`);
      anchor = await renderAnchor(DETAIL, { onNavigate, LinkComponent: FakeLink }, { download });
      assert.equal(anchor.getAttribute('data-via'), 'component');
      assert.equal(clickWith(anchor), false, `download=${download} through LinkComponent`);
    }
    assert.equal(navigations.length, 0);
  });

  test('LinkComponent renders only configured kinds whose target is not _blank', async () => {
    const LinkComponent = FakeLink;
    let anchor = await renderAnchor(DETAIL, { LinkComponent }, { className: 'title' });
    assert.equal(anchor.getAttribute('data-via'), 'component', 'detail is configured by default');
    assert.equal(anchor.getAttribute('data-wanderer-link'), 'detail');
    assert.equal(anchor.getAttribute('class'), 'title');
    assert.equal(anchor.hasAttribute('target'), false);
    assert.equal(anchor.hasAttribute('rel'), false);

    anchor = await renderAnchor(RECORDING, { LinkComponent, linkComponentKinds: ['detail', 'recording'] });
    assert.equal(anchor.getAttribute('data-via'), null, 'recording defaults to _blank');
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');

    anchor = await renderAnchor(GENERAL, { LinkComponent, linkComponentKinds: ['general'], policies: { general: { target: '_self' } } });
    assert.equal(anchor.getAttribute('data-via'), 'component');

    anchor = await renderAnchor(DETAIL, { LinkComponent, linkComponentKinds: [] });
    assert.equal(anchor.getAttribute('data-via'), null);

    anchor = await renderAnchor(DETAIL, { LinkComponent, policies: { detail: { target: '_blank' } } });
    assert.equal(anchor.getAttribute('data-via'), null, 'a detail link opened in a new tab skips LinkComponent');
    assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');
  });

  test('onNavigate fires through LinkComponent, and a modified click on it stays native', async () => {
    const anchor = await renderAnchor(DETAIL, { LinkComponent: FakeLink, onNavigate });
    assert.equal(clickWith(anchor, { metaKey: true }), false);
    assert.equal(clickWith(anchor), true);
    assert.equal(navigations.length, 1);
  });

  test('unsafe URLs render a noninteractive span and never reach LinkComponent or onNavigate', async () => {
    const navigation: NavigationOptions = { LinkComponent: FakeLink, linkComponentKinds: ['detail', 'general'], onNavigate, policies: { general: { target: '_self' } } };
    for (const link of [
      { kind: 'detail', url: 'javascript:alert(1)' },
      { kind: 'detail', url: '//evil.test/x' },
      { kind: 'detail', url: 'https://user:pw@evil.test' },
      { kind: 'general', url: '/relative-only-for-detail' },
    ] satisfies TalkLink[]) {
      const node = await renderAnchor(link, navigation, { className: 'wanderer-action' });
      assert.equal(node.tagName, 'SPAN', link.url);
      assert.equal(node.getAttribute('class'), 'wanderer-action');
      assert.equal(node.getAttribute('data-wanderer-unsafe'), 'true');
      assert.equal(node.hasAttribute('href'), false);
      clickWith(node);
    }
    assert.equal(componentRenders.length, 0);
    assert.equal(navigations.length, 0);
  });

  test('href, target and rel props are ignored in favor of the link and its kind policy', async () => {
    let anchor = await renderAnchor(DETAIL, {}, { href: '/elsewhere', target: '_blank', rel: 'nofollow', id: 'kept' });
    assert.equal(anchor.getAttribute('href'), DETAIL.url);
    assert.equal(anchor.hasAttribute('target'), false);
    assert.equal(anchor.hasAttribute('rel'), false);
    assert.equal(anchor.id, 'kept', 'other anchor props are forwarded');
    anchor = await renderAnchor(RECORDING, {}, { target: '_self', rel: 'nofollow' });
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');
  });

  describe('through <Talks navigation>', () => {
    async function renderTalks(navigation: NavigationOptions) {
      await act(async () => {
        root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, navigation }));
      });
      const card = [...container.querySelectorAll('.wanderer-talk')].find((node) => node.textContent?.includes('Beacon'))!;
      return { card, title: card.querySelector<HTMLAnchorElement>('.wanderer-talk__title-link')! };
    }

    test('the title link uses LinkComponent and onNavigate, while new-tab actions stay plain anchors', async () => {
      const { card, title } = await renderTalks({ LinkComponent: FakeLink, onNavigate });
      assert.equal(title.getAttribute('href'), '/talks/beacon-2029');
      assert.equal(title.getAttribute('data-via'), 'component');
      assert.equal(clickWith(title, { metaKey: true }), false);
      assert.equal(clickWith(title), true);
      assert.equal(navigations.length, 1);
      assert.equal(navigations[0].talk?.id, 'beacon-2029');
      const event = card.querySelector<HTMLAnchorElement>('a.wanderer-action[data-wanderer-link="event"]')!;
      assert.equal(event.getAttribute('data-via'), null);
      assert.equal(event.getAttribute('target'), '_blank');
      assert.equal(clickWith(event), false);
      assert.equal(navigations.length, 1);
    });

    test('primaryLink reorders the title link and demotes the default primary to an action', async () => {
      const { card, title } = await renderTalks({ primaryLink: ['event', 'detail'] });
      assert.equal(title.getAttribute('href'), 'https://harbor.example/2029');
      assert.equal(title.getAttribute('data-wanderer-link'), 'event');
      const detail = card.querySelector<HTMLAnchorElement>('a.wanderer-action[data-wanderer-link="detail"]');
      assert.equal(detail?.getAttribute('href'), '/talks/beacon-2029');
    });
  });
});
