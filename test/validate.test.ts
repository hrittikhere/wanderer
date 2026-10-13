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

  test('missing id, title, or event are errors and the entry is dropped even in lenient mode', () => {
    const result = validateTalks([{ title: 'No id', event: 'E' }, { id: 'x', event: 'E' }, { id: 'y', title: '  ' }], { mode: 'lenient' });
    assert.deepEqual(codes(result.errors).sort(), ['event:required', 'id:required', 'title:required', 'title:required'].sort());
    assert.deepEqual(result.talks, []);
    assert.equal(result.valid, false);
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

  test('tags keep only strings', () => {
    const result = validateTalks([talk({ id: 't', tags: ['a', 1, null, 'b'] as never })]);
    assert.deepEqual(result.talks[0].tags, ['a', 'b']);
  });

  test('diagnostics carry the index and talk id', () => {
    const result = validateTalks([talk({ id: 'first' }), talk({ id: 'second', date: '' })]);
    assert.deepEqual(result.errors.map((item) => [item.index, item.talkId]), [[1, 'second']]);
  });
});
