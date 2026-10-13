import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGeography, groupTalks, validateTalks } from '../src/helpers.js';
import { REFERENCE_DATE, talk } from './support/fixtures.js';

const codes = (diagnostics: readonly { field: string; code: string }[]) => diagnostics.map((item) => `${item.field}:${item.code}`);

describe('validateTalks', () => {
  test('rejects non-array input', () => {
    const result = validateTalks({ not: 'an array' });
    assert.equal(result.valid, false);
    assert.deepEqual(result.talks, []);
    assert.equal(result.errors[0].code, 'invalid_type');
  });

  test('accepts a well-formed talk and returns a copy, never the input object', () => {
    const input = talk({ id: 'ok', coordinates: [1, 2], links: [{ kind: 'general', url: 'https://x.test' }] });
    const result = validateTalks([input]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.talks.length, 1);
    assert.notEqual(result.talks[0], input);
    assert.notEqual(result.talks[0].coordinates, input.coordinates);
    assert.deepEqual(result.talks[0], input);
  });

  test('never mutates or aliases nested input objects, even when the input is deeply frozen', () => {
    const deepFreeze = <T,>(value: T): T => {
      if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
      return value;
    };
    const input = deepFreeze(talk({
      id: 'frozen', location: { city: 'Lisbon', country: 'Portugal' }, coordinates: [1, 2], tags: ['a', 'b'],
      links: [{ kind: 'general', url: 'https://x.test', id: 'notes', label: 'Notes' }, { kind: 'general', url: 'https://y.test', id: 'event' }],
    }));
    const snapshot = JSON.stringify(input);
    const result = validateTalks([input], { mode: 'lenient' });
    assert.equal(JSON.stringify(input), snapshot, 'the source is unchanged');
    const [out] = result.talks;
    assert.notEqual(out.location, input.location);
    assert.notEqual(out.coordinates, input.coordinates);
    assert.notEqual(out.links, input.links);
    assert.notEqual(out.links![0], input.links![0]);
    assert.notEqual(out.links![1], input.links![1]);
    assert.notEqual(out.tags, input.tags);
    assert.deepEqual(out.links![1], { kind: 'general', url: 'https://y.test' }, 'the reserved id is dropped from the copy only');
  });

  test('keys outside the Talk schema are dropped from the projection without a diagnostic', () => {
    const input = { ...talk({ id: 'extra' }), category: 'keynote', readTime: 5, image: '/x.jpg' };
    for (const mode of ['strict', 'lenient'] as const) {
      const result = validateTalks([input], { mode });
      assert.deepEqual(Object.keys(result.talks[0]).sort(), ['date', 'description', 'event', 'format', 'id', 'title'], mode);
      assert.deepEqual(result.warnings, [], mode);
      assert.equal(result.valid, true, mode);
    }
    assert.equal(input.category, 'keynote', 'the source keeps its own fields');
  });

  test('missing id, title, or event are errors and the entry is dropped even in lenient mode', () => {
    const result = validateTalks([{ title: 'No id', event: 'E' }, { id: 'x', event: 'E' }, { id: 'y', title: '  ' }], { mode: 'lenient' });
    assert.deepEqual(codes(result.errors).sort(), ['event:required', 'id:required', 'title:required', 'title:required'].sort());
    assert.deepEqual(result.talks, []);
    assert.equal(result.valid, false);
  });

  test('a present but non-string id, title, or event is a required error', () => {
    const result = validateTalks([talk({ id: 2024 as never }), talk({ id: 'b', title: 42 as never }), talk({ id: 'c', event: ['E'] as never })], { mode: 'lenient' });
    assert.deepEqual(codes(result.errors), ['id:required', 'title:required', 'event:required']);
    assert.match(result.errors[0].message, /string/);
    assert.deepEqual(result.talks, []);
  });

  test('non-object entries are three required errors each and never become talks', () => {
    const result = validateTalks([null, 'str', ['x'], 42], { mode: 'lenient' });
    assert.deepEqual(result.errors.map((item) => `${item.index}:${item.field}:${item.code}`), [0, 1, 2, 3].flatMap((index) => [
      `${index}:id:required`, `${index}:title:required`, `${index}:event:required`,
    ]));
    assert.deepEqual(result.talks, []);
  });

  test('array holes are diagnosed like explicit undefined entries instead of being skipped', () => {
    const sparse: unknown[] = [talk({ id: 'a' })];
    sparse[2] = talk({ id: 'c' });
    const result = validateTalks(sparse);
    assert.equal(result.valid, false, 'strict mode rejects the hole');
    assert.deepEqual(result.errors.map((item) => `${item.index}:${item.field}:${item.code}`), ['1:id:required', '1:title:required', '1:event:required']);
    assert.equal(validateTalks(new Array(2)).valid, false);
    const links: unknown[] = [];
    links[1] = { kind: 'general', url: 'https://x.test' };
    const withHole = validateTalks([talk({ id: 'l', links: links as never })]);
    assert.deepEqual(codes(withHole.warnings), ['links[0]:invalid_link']);
    assert.deepEqual(withHole.talks[0].links, [{ kind: 'general', url: 'https://x.test' }]);
  });

  test('ids containing whitespace are an error in both modes because they become DOM ids and IDREFs', () => {
    for (const id of [' pad ', 'lisbon 2024', 'a\nb', 'tab\there']) {
      const result = validateTalks([talk({ id })], { mode: 'lenient' });
      assert.deepEqual(codes(result.errors), ['id:invalid_id'], JSON.stringify(id));
      assert.deepEqual(result.talks, []);
      assert.equal(result.valid, false);
    }
    assert.equal(validateTalks([talk({ id: 'lisbon-2024' })]).valid, true);
  });

  test('link ids must be unique per talk and may not reuse a kind or a generated kind-index id', () => {
    const result = validateTalks([talk({
      id: 'x',
      links: [
        { kind: 'general', url: 'https://a.test', id: 'notes' },
        { kind: 'general', url: 'https://b.test', id: 'notes' },
        { kind: 'general', url: 'https://c.test', id: 'event' },
        { kind: 'general', url: 'https://d.test', id: 'general-0' },
        { kind: 'general', url: 'https://e.test', id: 'has space' },
        { kind: 'general', url: 'https://f.test', id: '' },
        { kind: 'general', url: 'https://g.test', id: 'share' },
      ],
    })]);
    assert.equal(result.valid, true, 'link ids are warnings, never errors');
    assert.deepEqual(codes(result.warnings), ['links[1].id:invalid_link_id', 'links[2].id:invalid_link_id', 'links[3].id:invalid_link_id', 'links[4].id:invalid_link_id', 'links[5].id:invalid_link_id']);
    assert.deepEqual(result.talks[0].links!.map((link) => [link.url, link.id]), [
      ['https://a.test', 'notes'], ['https://b.test', undefined], ['https://c.test', undefined], ['https://d.test', undefined],
      ['https://e.test', undefined], ['https://f.test', undefined], ['https://g.test', 'share'],
    ], 'every link is kept; only the offending ids are dropped');
  });

  test('a non-string link id is dropped with an invalid_link_id warning and the link is kept', () => {
    const result = validateTalks([talk({
      id: 'x',
      links: [
        { kind: 'general', url: 'https://a.test', id: 5 as never },
        { kind: 'general', url: 'https://b.test', id: null as never },
        { kind: 'general', url: 'https://c.test', id: { value: 'x' } as never },
      ],
    })]);
    assert.equal(result.valid, true);
    assert.deepEqual(codes(result.warnings), ['links[0].id:invalid_link_id', 'links[1].id:invalid_link_id', 'links[2].id:invalid_link_id']);
    assert.deepEqual(result.talks[0].links, [
      { kind: 'general', url: 'https://a.test' }, { kind: 'general', url: 'https://b.test' }, { kind: 'general', url: 'https://c.test' },
    ]);
  });

  test('blank or non-string link labels are dropped with an invalid_link_label warning and the link is kept', () => {
    for (const mode of ['strict', 'lenient'] as const) {
      const result = validateTalks([talk({
        id: 'x',
        links: [
          { kind: 'general', url: 'https://a.test', label: '' },
          { kind: 'general', url: 'https://b.test', label: '   ' },
          { kind: 'general', url: 'https://c.test', label: '\t\n' },
          { kind: 'general', url: 'https://d.test', label: 7 as never },
          { kind: 'general', url: 'https://e.test', label: 'Notes' },
        ],
      })], { mode });
      assert.equal(result.valid, true, mode);
      assert.deepEqual(codes(result.warnings), ['links[0].label:invalid_link_label', 'links[1].label:invalid_link_label', 'links[2].label:invalid_link_label', 'links[3].label:invalid_link_label'], mode);
      assert.deepEqual(result.talks[0].links!.map((link) => [link.url, link.label]), [
        ['https://a.test', undefined], ['https://b.test', undefined], ['https://c.test', undefined], ['https://d.test', undefined], ['https://e.test', 'Notes'],
      ], mode);
      assert.ok(result.talks[0].links!.slice(0, 4).every((link) => !('label' in link)), mode);
    }
  });

  test('duplicate ids are an error and lenient mode keeps the first occurrence', () => {
    const result = validateTalks([talk({ id: 'dup', title: 'First' }), talk({ id: 'dup', title: 'Second' })], { mode: 'lenient' });
    assert.deepEqual(codes(result.errors), ['id:duplicate_id']);
    assert.equal(result.errors[0].index, 1);
    assert.deepEqual(result.talks.map((item) => item.title), ['First']);
  });

  test('an invalid date is an error; lenient mode retains the talk with an empty date that groups as Undated', () => {
    const result = validateTalks([talk({ id: 'bad-date', date: '2031-02-30' }), talk({ id: 'good', date: '2030-01-01' })], { mode: 'lenient' });
    assert.deepEqual(codes(result.errors), ['date:invalid_date']);
    assert.equal(result.talks.find((item) => item.id === 'bad-date')?.date, '');
    const groups = groupTalks(result.talks, { referenceDate: REFERENCE_DATE });
    assert.deepEqual(groups.map((group) => group.label), ['2030', 'Undated']);
    assert.deepEqual(groups[1].talks.map((item) => item.id), ['bad-date']);
  });

  test('non-finite or out-of-range coordinates are errors and the talk is excluded from geography', () => {
    const result = validateTalks([
      talk({ id: 'nan', coordinates: [Number.NaN, 0] }),
      talk({ id: 'inf', coordinates: [0, Number.POSITIVE_INFINITY] }),
      talk({ id: 'lat', coordinates: [91, 0] }),
      talk({ id: 'lng', coordinates: [0, -181] }),
      talk({ id: 'string', coordinates: ['1', '2'] as never }),
      talk({ id: 'short', coordinates: [1] as never }),
      talk({ id: 'ok', coordinates: [-90, 180] }),
    ], { mode: 'lenient' });
    assert.equal(result.errors.filter((item) => item.code === 'invalid_coordinates').length, 6);
    assert.equal(result.talks.length, 7, 'lenient keeps the talks');
    assert.ok(result.talks.filter((item) => item.id !== 'ok').every((item) => item.coordinates === undefined));
    const geography = deriveGeography(result.talks);
    assert.deepEqual(geography.mappedTalks.map((item) => item.id), ['ok']);
  });

  test('missing description or invalid format are errors with lenient defaults', () => {
    const result = validateTalks([{ id: 'a', title: 'A', event: 'E', date: '2030-01-01', format: 'metaverse' }], { mode: 'lenient' });
    assert.deepEqual(codes(result.errors).sort(), ['description:required', 'format:invalid_format']);
    assert.equal(result.talks[0].description, '');
    assert.equal(result.talks[0].format, 'online');
  });

  test('malformed URLs, including ones with whitespace, are warnings and the field is dropped', () => {
    const result = validateTalks([talk({
      id: 'urls',
      eventUrl: 'https://example.test/with space',
      recordingUrl: 'not a url',
      slidesUrl: 'https://ok.test/slides',
      detailUrl: 'ftp://nope.test',
      links: [{ kind: 'general', url: 'https://ok.test/general' }, { kind: 'general', url: ' https://leading.test' }, { kind: 'weird' as never, url: 'https://ok.test' }, 'string' as never],
    })]);
    assert.equal(result.valid, true, 'warnings alone keep the result valid');
    assert.deepEqual(codes(result.warnings).sort(), [
      'detailUrl:invalid_url', 'eventUrl:invalid_url', 'links[1].url:invalid_url', 'links[2].kind:invalid_link_kind', 'links[3]:invalid_link', 'recordingUrl:invalid_url',
    ]);
    const [out] = result.talks;
    assert.equal(out.eventUrl, undefined);
    assert.equal(out.recordingUrl, undefined);
    assert.equal(out.detailUrl, undefined);
    assert.equal(out.slidesUrl, 'https://ok.test/slides');
    assert.deepEqual(out.links, [{ kind: 'general', url: 'https://ok.test/general' }]);
  });

  test('links that is not an array is an invalid_links warning and the field is dropped', () => {
    for (const links of ['https://x.test', { kind: 'general', url: 'https://x.test' }, 42, null, true]) {
      const result = validateTalks([talk({ id: 'l', links: links as never })]);
      assert.equal(result.valid, true, JSON.stringify(links));
      assert.deepEqual(codes(result.warnings), ['links:invalid_links'], JSON.stringify(links));
      assert.equal(result.talks[0].links, undefined, JSON.stringify(links));
    }
  });

  test('http(s) URLs missing the // after the scheme are invalid_url warnings, not page-relative links', () => {
    const result = validateTalks([talk({
      id: 'slashless',
      eventUrl: 'https:sched.example.com/event/1',
      links: [{ kind: 'general', url: 'https:/notes.test' }],
    })]);
    assert.deepEqual(codes(result.warnings).sort(), ['eventUrl:invalid_url', 'links[0].url:invalid_url']);
    assert.equal(result.talks[0].eventUrl, undefined);
    assert.deepEqual(result.talks[0].links, []);
  });

  test('javascript: URLs never appear in the output in either mode', () => {
    const input = [talk({
      id: 'js',
      eventUrl: 'javascript:alert(1)',
      recordingUrl: 'JavaScript:alert(2)',
      detailUrl: 'javascript:alert(3)',
      links: [{ kind: 'general', url: 'javascript:alert(4)' }, { kind: 'detail', url: 'javascript:alert(5)' }],
    })];
    for (const mode of ['strict', 'lenient'] as const) {
      const result = validateTalks(input, { mode });
      assert.equal(result.valid, true, mode);
      assert.equal(JSON.stringify(result.talks).includes('javascript:'), false, mode);
      assert.equal(result.talks[0].links?.length, 0, mode);
    }
  });

  test('strict mode returns zero talks when any error exists, lenient keeps the usable ones', () => {
    const input = [talk({ id: 'ok' }), talk({ id: 'bad', date: 'nope' })];
    const strict = validateTalks(input);
    assert.equal(strict.valid, false);
    assert.deepEqual(strict.talks, []);
    assert.equal(strict.errors.length, 1);
    const lenient = validateTalks(input, { mode: 'lenient' });
    assert.equal(lenient.valid, false);
    assert.deepEqual(lenient.talks.map((item) => item.id), ['ok', 'bad']);
  });

  test('location objects need city and country strings; otherwise a warning and no location', () => {
    const result = validateTalks([
      talk({ id: 'obj', location: { city: 'Lisbon', country: 'Portugal' } }),
      talk({ id: 'partial', location: { city: 'Lisbon' } as never }),
      talk({ id: 'number', location: 42 as never }),
    ]);
    assert.equal(result.valid, true);
    assert.deepEqual(codes(result.warnings), ['location:invalid_location', 'location:invalid_location']);
    assert.deepEqual(result.talks[0].location, { city: 'Lisbon', country: 'Portugal' });
    assert.equal(result.talks[1].location, undefined);
  });

  test('blank locations are an invalid_location warning and the field is dropped', () => {
    const result = validateTalks([
      talk({ id: 'empty', location: '' }),
      talk({ id: 'spaces', location: '  ' }),
      talk({ id: 'blank-object', location: { city: ' ', country: '' } }),
      talk({ id: 'city-only', location: { city: 'Lisbon', country: '' } }),
      talk({ id: 'padded', location: ' Lisbon ' }),
    ]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.warnings.map((item) => `${item.talkId}:${item.code}`), ['empty:invalid_location', 'spaces:invalid_location', 'blank-object:invalid_location']);
    assert.deepEqual(result.talks.map((item) => item.location), [undefined, undefined, undefined, { city: 'Lisbon', country: '' }, ' Lisbon ']);
  });

  test('tags keep only strings', () => {
    const result = validateTalks([talk({ id: 't', tags: ['a', 1, null, 'b'] as never })]);
    assert.deepEqual(result.talks[0].tags, ['a', 'b']);
  });

  test('tags that is not an array is an invalid_tags warning and the field is dropped', () => {
    for (const tags of ['platforms', { a: 1 }, 42, null, true]) {
      const result = validateTalks([talk({ id: 't', tags: tags as never })]);
      assert.equal(result.valid, true, JSON.stringify(tags));
      assert.deepEqual(codes(result.warnings), ['tags:invalid_tags'], JSON.stringify(tags));
      assert.equal(result.talks[0].tags, undefined, JSON.stringify(tags));
    }
  });

  test('diagnostics carry the index and talk id', () => {
    const result = validateTalks([talk({ id: 'first' }), talk({ id: 'second', date: '' })]);
    assert.deepEqual(result.errors.map((item) => [item.index, item.talkId]), [[1, 'second']]);
  });
});
