import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRIMARY_LINK_PRECEDENCE, getPrimaryLink, getTalkLinks, safeUrl } from '../src/helpers.js';
import { resolveLinkPolicy } from '../src/components/TalkLink.js';
import { talk } from './support/fixtures.js';

describe('safeUrl', () => {
  test('allows https, http, mailto, and tel', () => {
    assert.equal(safeUrl('https://example.test/a?b=1#c'), 'https://example.test/a?b=1#c');
    assert.equal(safeUrl('http://example.test'), 'http://example.test');
    assert.equal(safeUrl('mailto:someone@example.test'), 'mailto:someone@example.test');
    assert.equal(safeUrl('tel:+15555550100'), 'tel:+15555550100');
    assert.equal(safeUrl('HTTPS://EXAMPLE.TEST/UPPER'), 'HTTPS://EXAMPLE.TEST/UPPER');
  });

  test('rejects dangerous or malformed schemes', () => {
    for (const value of [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'vbscript:msgbox', 'file:///etc/passwd',
      'ftp://example.test/x', 'about:blank', 'https://', 'https://user:pw@example.test', 'mailto:', 'tel:',
    ]) {
      assert.equal(safeUrl(value), undefined, `${value} must be rejected`);
    }
  });

  test('rejects http(s) without the // authority marker, which browsers resolve against the page', () => {
    for (const value of ['https:example.test', 'https:/example.test', 'HTTP:/EXAMPLE', 'https:sched.example.com/event/1', 'http:example.test']) {
      assert.equal(safeUrl(value), undefined, `${value} must be rejected`);
      assert.equal(safeUrl(value, { allowRelative: true }), undefined, `${value} must be rejected for detail links too`);
    }
    assert.equal(safeUrl('HTTPS://example.test/x'), 'HTTPS://example.test/x');
  });

  test('rejects whitespace, control characters, and backslashes inside the URL', () => {
    for (const value of [
      'https://example.test/a b', ' https://example.test', 'https://example.test\n', 'https://example.test/\t',
      'https://example.test/\u0000', 'https://example.test/\u001f', 'https://example.test/\u007f', 'https:\\\\example.test',
      'java\tscript:alert(1)', 'java\nscript:alert(1)',
    ]) {
      assert.equal(safeUrl(value), undefined, `${JSON.stringify(value)} must be rejected`);
    }
  });

  test('rejects non-string and empty input', () => {
    for (const value of [undefined, null, 1, {}, [], '']) assert.equal(safeUrl(value), undefined);
  });

  test('allows relative paths only when explicitly opted in', () => {
    assert.equal(safeUrl('/talks/a'), undefined);
    assert.equal(safeUrl('/talks/a', { allowRelative: true }), '/talks/a');
    assert.equal(safeUrl('./a', { allowRelative: true }), './a');
    assert.equal(safeUrl('../a', { allowRelative: true }), '../a');
    assert.equal(safeUrl('#section', { allowRelative: true }), '#section');
    assert.equal(safeUrl('?q=1', { allowRelative: true }), '?q=1');
    assert.equal(safeUrl('//evil.test/x', { allowRelative: true }), undefined, 'protocol-relative is not a relative path');
    assert.equal(safeUrl('talks/a', { allowRelative: true }), undefined, 'bare relative paths are not accepted');
    assert.equal(safeUrl('javascript:alert(1)', { allowRelative: true }), undefined);
  });
});

describe('getTalkLinks', () => {
  test('classifies dedicated fields first with their kinds in a fixed order', () => {
    const links = getTalkLinks(talk({
      id: 'x',
      eventUrl: 'https://event.test', recordingUrl: 'https://rec.test', slidesUrl: 'https://slides.test', detailUrl: '/talks/x',
    }));
    assert.deepEqual(links, [
      { kind: 'detail', url: '/talks/x' },
      { kind: 'recording', url: 'https://rec.test' },
      { kind: 'slides', url: 'https://slides.test' },
      { kind: 'event', url: 'https://event.test' },
    ]);
  });

  test('keeps general links and preserves their kinds, ids, and labels after the dedicated fields', () => {
    const links = getTalkLinks(talk({
      id: 'x',
      eventUrl: 'https://event.test',
      links: [
        { kind: 'general', url: 'https://notes.test', label: 'Notes', id: 'notes' },
        { kind: 'recording', url: 'https://alt-rec.test' },
      ],
    }));
    assert.deepEqual(links, [
      { kind: 'event', url: 'https://event.test' },
      { kind: 'general', url: 'https://notes.test', label: 'Notes', id: 'notes' },
      { kind: 'recording', url: 'https://alt-rec.test' },
    ]);
  });

  test('drops duplicates by kind and URL but keeps the same URL under a different kind', () => {
    const links = getTalkLinks(talk({
      id: 'x',
      eventUrl: 'https://same.test',
      links: [
        { kind: 'event', url: 'https://same.test', label: 'dup' },
        { kind: 'general', url: 'https://same.test' },
      ],
    }));
    assert.deepEqual(links, [
      { kind: 'event', url: 'https://same.test' },
      { kind: 'general', url: 'https://same.test' },
    ]);
  });

  test('drops unsafe URLs, unknown kinds, and malformed entries', () => {
    const links = getTalkLinks(talk({
      id: 'x',
      recordingUrl: 'javascript:alert(1)',
      eventUrl: 'https://ok.test',
      links: [
        { kind: 'video' as never, url: 'https://unknown-kind.test' },
        { kind: 'general', url: 'data:text/html,x' },
        { kind: 'event', url: '/relative-not-allowed' },
        null as never,
        { kind: 'detail', url: '/relative-ok' },
      ],
    }));
    assert.deepEqual(links, [{ kind: 'event', url: 'https://ok.test' }, { kind: 'detail', url: '/relative-ok' }]);
  });

  test('tolerates a links value that is not an array', () => {
    assert.deepEqual(getTalkLinks(talk({ id: 'x', links: 'nope' as never })), []);
  });
});

describe('getPrimaryLink', () => {
  const full = talk({
    id: 'x', eventUrl: 'https://event.test', recordingUrl: 'https://rec.test', slidesUrl: 'https://slides.test', detailUrl: '/talks/x',
    links: [{ kind: 'general', url: 'https://general.test' }],
  });

  test('follows the default precedence detail, event, recording, slides, general', () => {
    assert.deepEqual(DEFAULT_PRIMARY_LINK_PRECEDENCE, ['detail', 'event', 'recording', 'slides', 'general']);
    assert.equal(getPrimaryLink(full)?.kind, 'detail');
    assert.equal(getPrimaryLink({ ...full, detailUrl: undefined })?.kind, 'event');
    assert.equal(getPrimaryLink({ ...full, detailUrl: undefined, eventUrl: undefined })?.kind, 'recording');
    assert.equal(getPrimaryLink({ ...full, detailUrl: undefined, eventUrl: undefined, recordingUrl: undefined })?.kind, 'slides');
    assert.equal(getPrimaryLink({ ...full, detailUrl: undefined, eventUrl: undefined, recordingUrl: undefined, slidesUrl: undefined })?.kind, 'general');
    assert.equal(getPrimaryLink(talk({ id: 'none' })), undefined);
  });

  test('honors a custom precedence and ignores kinds not listed', () => {
    assert.equal(getPrimaryLink(full, ['recording', 'detail'])?.kind, 'recording');
    assert.equal(getPrimaryLink(full, ['slides'])?.url, 'https://slides.test');
    assert.equal(getPrimaryLink({ ...full, slidesUrl: undefined }, ['slides']), undefined);
  });
});

describe('resolveLinkPolicy', () => {
  test('defaults: detail stays in the window, every other kind opens a new tab with noopener noreferrer', () => {
    assert.deepEqual(resolveLinkPolicy('detail'), { rel: '' });
    for (const kind of ['event', 'recording', 'slides', 'general'] as const) {
      const policy = resolveLinkPolicy(kind);
      assert.equal(policy.target, '_blank', kind);
      assert.deepEqual(policy.rel.split(' ').sort(), ['noopener', 'noreferrer'], kind);
    }
  });

  test('keeps a consumer rel that already protects the opener as-is', () => {
    assert.equal(resolveLinkPolicy('event', { event: { rel: 'noopener' } }).rel, 'noopener');
    assert.equal(resolveLinkPolicy('event', { event: { rel: 'noreferrer' } }).rel, 'noreferrer');
    assert.equal(resolveLinkPolicy('event', { event: { rel: 'noopener nofollow' } }).rel, 'noopener nofollow');
  });

  test('appends noopener to a consumer rel that does not protect a new-tab link', () => {
    assert.equal(resolveLinkPolicy('event', { event: { rel: 'nofollow' } }).rel, 'nofollow noopener');
    assert.equal(resolveLinkPolicy('general', { general: { target: '_blank', rel: 'me' } }).rel, 'me noopener');
  });

  test('explicit _self keeps the consumer rel untouched and does not add noopener', () => {
    const policy = resolveLinkPolicy('event', { event: { target: '_self', rel: 'nofollow' } });
    assert.equal(policy.target, '_self');
    assert.equal(policy.rel, 'nofollow');
    assert.deepEqual(resolveLinkPolicy('recording', { recording: { target: '_self' } }), { target: '_self', rel: '' });
  });

  test('target keywords match case-insensitively, as in HTML', () => {
    for (const target of ['_BLANK', '_Blank']) {
      const policy = resolveLinkPolicy('general', { general: { target } });
      assert.equal(policy.target, target);
      assert.deepEqual(policy.rel.split(' ').sort(), ['noopener', 'noreferrer'], target);
    }
    assert.equal(resolveLinkPolicy('event', { event: { target: '_BLANK', rel: 'nofollow' } }).rel, 'nofollow noopener');
    assert.equal(resolveLinkPolicy('event', { event: { target: '_SELF', rel: 'nofollow' } }).rel, 'nofollow');
  });

  test('a detail policy that opts into _blank gets protection too', () => {
    const policy = resolveLinkPolicy('detail', { detail: { target: '_blank' } });
    assert.deepEqual(policy.rel.split(' ').sort(), ['noopener', 'noreferrer']);
  });
});
