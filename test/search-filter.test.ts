import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { filterTalks, groupTalks, normalizeSearch } from '../src/helpers.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const ids = (talks: readonly { id: string }[]) => talks.map((item) => item.id);

describe('normalizeSearch', () => {
  test('applies NFKD, strips diacritics, lowercases, and collapses whitespace', () => {
    assert.equal(normalizeSearch('  Zürich   Café '), 'zurich cafe');
    assert.equal(normalizeSearch('São\tPaulo\n\nBRASIL'), 'sao paulo brasil');
    assert.equal(normalizeSearch('ﬁne'), 'fine', 'compatibility ligatures decompose under NFKD');
    assert.equal(normalizeSearch('ＫＵＢＥ'), 'kube', 'full-width letters fold to ASCII');
    assert.equal(normalizeSearch('İstanbul'), 'istanbul');
    assert.equal(normalizeSearch(''), '');
  });
});

describe('filterTalks', () => {
  test('matches each search term against title, event, description, location, and tags (AND semantics)', () => {
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'aurora' })), ['aurora-2030']);
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'harbor' })), ['beacon-2029', 'ember-2029'], 'event');
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'toolkit' })), ['beacon-2029'], 'description');
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'lisbon' })), ['beacon-2029', 'ember-2029'], 'string and object locations');
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'observability' })), ['beacon-2029'], 'tags');
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'harbor ember' })), ['ember-2029'], 'all terms must match');
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { search: 'harbor nothing-here' })), []);
  });

  test('search is diacritic and case insensitive and ignores surrounding whitespace', () => {
    const talks = [talk({ id: 'z', title: 'Zürich Meetup' }), talk({ id: 'p', title: 'Porto', location: 'São Paulo, Brasil' })];
    assert.deepEqual(ids(filterTalks(talks, { search: '  ZURICH ' })), ['z']);
    assert.deepEqual(ids(filterTalks(talks, { search: 'sao paulo' })), ['p']);
    assert.deepEqual(ids(filterTalks(talks, { search: '   ' })), ['z', 'p'], 'blank search keeps everything');
  });

  test('filters by format and treats "all" as no filter', () => {
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { format: 'online' })), ['cinder-online']);
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { format: 'hybrid' })), ['dune-hybrid']);
    assert.equal(filterTalks(FIXTURE_TALKS, { format: 'all' }).length, FIXTURE_TALKS.length);
  });

  test('recordingOnly counts only links of kind recording, never a video-looking eventUrl', () => {
    const talks = [
      talk({ id: 'with-recording', recordingUrl: 'https://videos.example/x' }),
      talk({ id: 'youtube-event', eventUrl: 'https://www.youtube.com/watch?v=abc' }),
      talk({ id: 'general-youtube', links: [{ kind: 'general', url: 'https://youtu.be/abc' }] }),
      talk({ id: 'typed-link', links: [{ kind: 'recording', url: 'https://videos.example/y' }] }),
      talk({ id: 'unsafe-recording', recordingUrl: 'javascript:alert(1)' }),
    ];
    assert.deepEqual(ids(filterTalks(talks, { recordingOnly: true })), ['with-recording', 'typed-link']);
  });

  test('upcomingOnly uses the reference date and keeps same-day talks', () => {
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { upcomingOnly: true, referenceDate: REFERENCE_DATE })), ['cinder-online', 'dune-hybrid']);
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { upcomingOnly: true, referenceDate: '2031-08-20' })), ['cinder-online']);
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { upcomingOnly: true })), [], 'no reference date means nothing is upcoming');
  });

  test('predicates combine with AND and with the other options', () => {
    const inPerson = (item: { format: string }) => item.format === 'in-person';
    const harbor = (item: { event: string }) => item.event === 'Harbor Conf';
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { predicates: [inPerson, harbor] })), ['beacon-2029', 'ember-2029']);
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { predicates: [inPerson, harbor], search: 'beacon' })), ['beacon-2029']);
    assert.deepEqual(ids(filterTalks(FIXTURE_TALKS, { predicates: [() => false] })), []);
  });

  test('returns a new array and never mutates the input', () => {
    const input = [...FIXTURE_TALKS];
    const output = filterTalks(input, {});
    assert.notEqual(output, input);
    assert.deepEqual(input, FIXTURE_TALKS);
  });
});

describe('groupTalks', () => {
  const dated = [
    talk({ id: 'u2', date: '2031-09-01' }),
    talk({ id: 'u1', date: '2031-07-01' }),
    talk({ id: 'p-2030-b', date: '2030-05-01' }),
    talk({ id: 'p-2030-a', date: '2030-06-01' }),
    talk({ id: 'p-2028', date: '2028-01-01' }),
    talk({ id: 'nodate', date: '' }),
  ];

  test('separate mode puts upcoming first (ascending) then years descending then undated', () => {
    const groups = groupTalks(dated, { referenceDate: REFERENCE_DATE });
    assert.deepEqual(groups.map((group) => group.id), ['upcoming', 'year-2030', 'year-2028', 'undated']);
    assert.deepEqual(groups.map((group) => group.label), ['Upcoming', '2030', '2028', 'Undated']);
    assert.deepEqual(ids(groups[0].talks), ['u1', 'u2'], 'upcoming ascending');
    assert.deepEqual(ids(groups[1].talks), ['p-2030-a', 'p-2030-b'], 'years descending by date');
    assert.deepEqual(ids(groups[3].talks), ['nodate']);
  });

  test('duplicate mode lists upcoming talks in both the upcoming group and their year', () => {
    const groups = groupTalks(dated, { referenceDate: REFERENCE_DATE, upcoming: 'duplicate' });
    assert.deepEqual(groups.map((group) => group.id), ['upcoming', 'year-2031', 'year-2030', 'year-2028', 'undated']);
    assert.deepEqual(ids(groups[0].talks), ['u1', 'u2']);
    assert.deepEqual(ids(groups[1].talks), ['u2', 'u1'], 'the year group keeps descending order');
  });

  test('none mode has no upcoming group and keeps every talk in its year', () => {
    const groups = groupTalks(dated, { referenceDate: REFERENCE_DATE, upcoming: 'none' });
    assert.deepEqual(groups.map((group) => group.id), ['year-2031', 'year-2030', 'year-2028', 'undated']);
  });

  test('labels for the upcoming and undated groups are configurable', () => {
    const groups = groupTalks(dated, { referenceDate: REFERENCE_DATE, undatedLabel: 'Ohne Datum', upcomingLabel: 'Demnächst' });
    assert.equal(groups[0].label, 'Demnächst');
    assert.equal(groups[groups.length - 1].label, 'Ohne Datum');
  });

  test('omits empty groups and returns no groups for no talks', () => {
    assert.deepEqual(groupTalks([], { referenceDate: REFERENCE_DATE }), []);
    const groups = groupTalks([talk({ id: 'only', date: '2030-01-01' })], { referenceDate: REFERENCE_DATE });
    assert.deepEqual(groups.map((group) => group.id), ['year-2030']);
  });

  test('derived counts add up: separate mode partitions, duplicate mode double-counts upcoming', () => {
    const total = dated.length;
    const separate = groupTalks(dated, { referenceDate: REFERENCE_DATE });
    assert.equal(separate.reduce((sum, group) => sum + group.talks.length, 0), total);
    const duplicate = groupTalks(dated, { referenceDate: REFERENCE_DATE, upcoming: 'duplicate' });
    assert.equal(duplicate.reduce((sum, group) => sum + group.talks.length, 0), total + 2);
    const none = groupTalks(dated, { referenceDate: REFERENCE_DATE, upcoming: 'none' });
    assert.equal(none.reduce((sum, group) => sum + group.talks.length, 0), total);
  });
});
