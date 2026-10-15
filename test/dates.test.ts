import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyTalkDate, compareIds, formatCalendarDate, isUpcoming, parseCalendarDate, sortTalks, talkYear,
} from '../src/helpers.js';
import { talk } from './support/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('parseCalendarDate', () => {
  test('accepts real ISO calendar dates and returns midnight UTC', () => {
    const date = parseCalendarDate('2030-03-10');
    assert.ok(date);
    assert.equal(date.toISOString(), '2030-03-10T00:00:00.000Z');
    assert.equal(parseCalendarDate('0001-01-01')?.getUTCFullYear(), 1);
  });

  test('accepts the leap day 2024-02-29', () => {
    assert.equal(parseCalendarDate('2024-02-29')?.toISOString(), '2024-02-29T00:00:00.000Z');
  });

  test('rejects impossible dates instead of normalizing them', () => {
    for (const value of ['2025-02-30', '2025-13-01', '2024-02-30', '2023-02-29', '2025-04-31', '2025-00-10', '2025-01-00']) {
      assert.equal(parseCalendarDate(value), null, `${value} must be rejected`);
    }
  });

  test('rejects non-string and non-ISO input', () => {
    for (const value of [undefined, null, 20250101, new Date('2025-01-01'), '2025-1-1', '01/01/2025', '2025-01-01T00:00:00Z', ' 2025-01-01', '']) {
      assert.equal(parseCalendarDate(value), null);
    }
  });
});

describe('isUpcoming and classifyTalkDate', () => {
  test('future dates are upcoming and past dates are not', () => {
    assert.equal(isUpcoming('2031-01-02', '2031-01-01'), true);
    assert.equal(isUpcoming('2030-12-31', '2031-01-01'), false);
  });

  test('the reference day itself counts as upcoming', () => {
    assert.equal(isUpcoming('2031-01-01', '2031-01-01'), true);
    assert.equal(classifyTalkDate('2031-01-01', '2031-01-01'), 'upcoming');
  });

  test('missing, invalid, or unparsable dates are never upcoming', () => {
    assert.equal(isUpcoming(undefined, '2031-01-01'), false);
    assert.equal(isUpcoming('', '2031-01-01'), false);
    assert.equal(isUpcoming('2031-02-30', '2031-01-01'), false);
    assert.equal(isUpcoming('2031-01-05', undefined), false);
    assert.equal(isUpcoming('2031-01-05', 'tomorrow'), false);
  });

  test('classifyTalkDate distinguishes upcoming, past, and undated', () => {
    assert.equal(classifyTalkDate('2031-01-02', '2031-01-01'), 'upcoming');
    assert.equal(classifyTalkDate('2030-01-02', '2031-01-01'), 'past');
    assert.equal(classifyTalkDate('', '2031-01-01'), 'undated');
    assert.equal(classifyTalkDate('2031-02-30', '2031-01-01'), 'undated');
    assert.equal(classifyTalkDate(undefined, '2031-01-01'), 'undated');
    assert.equal(classifyTalkDate('2031-01-02', undefined), 'past', 'without a reference nothing is upcoming');
  });

  test('talkYear reads the UTC year and is undefined for invalid dates', () => {
    assert.equal(talkYear('2030-12-31'), 2030);
    assert.equal(talkYear('2030-13-31'), undefined);
    assert.equal(talkYear(undefined), undefined);
  });
});

describe('formatCalendarDate', () => {
  test('formats with the given locale and falls back to the undated label', () => {
    assert.equal(formatCalendarDate('2030-03-10'), 'March 10, 2030');
    assert.equal(formatCalendarDate('2030-03-10', 'de-DE'), '10. März 2030');
    assert.equal(formatCalendarDate('2030-03-10', 'en-US', { month: 'short' }), 'Mar');
    assert.equal(formatCalendarDate('', 'en-US', undefined, 'Kein Datum'), 'Kein Datum');
    assert.equal(formatCalendarDate('2030-02-30'), 'Undated');
  });

  test('is independent of the process time zone (child processes with TZ set)', () => {
    const child = path.join(here, 'support', 'tz-child.ts');
    const zones = ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata', 'UTC'];
    const expectedOffsets: Record<string, number> = { 'Pacific/Kiritimati': -840, 'America/Los_Angeles': 480, 'Asia/Kolkata': -330, UTC: 0 };
    for (const tz of zones) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', child], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
        cwd: path.resolve(here, '..'),
      });
      assert.equal(result.status, 0, `child failed under TZ=${tz}: ${result.stderr}`);
      const observed = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(observed.tz, tz);
      assert.equal(observed.offsetMinutes, expectedOffsets[tz], `the child must actually run in ${tz}`);
      assert.equal(observed.newYearsEve, 'December 31, 2030', tz);
      assert.equal(observed.newYearsDay, 'January 1, 2031', tz);
      assert.equal(observed.leapDay, 'February 29, 2024', tz);
      assert.equal(observed.german, '10. März 2030', tz);
      assert.equal(observed.japanese, '2030年3月10日', tz);
      assert.equal(observed.isoRoundTrip, '2030-12-31T00:00:00.000Z', tz);
      assert.deepEqual(observed.utcParts, [2030, 12, 31], tz);
      assert.equal(observed.sameDayUpcoming, true, tz);
      assert.equal(observed.dayBeforeUpcoming, false, tz);
      assert.equal(observed.dayAfterUpcoming, true, tz);
      assert.equal(observed.classifySameDay, 'upcoming', tz);
      assert.equal(observed.classifyDayBefore, 'past', tz);
    }
  });
});

describe('sortTalks', () => {
  test('sorts descending by default and ascending on request', () => {
    const talks = [talk({ id: 'a', date: '2029-01-01' }), talk({ id: 'b', date: '2031-01-01' }), talk({ id: 'c', date: '2030-01-01' })];
    assert.deepEqual(sortTalks(talks).map((item) => item.id), ['b', 'c', 'a']);
    assert.deepEqual(sortTalks(talks, 'asc').map((item) => item.id), ['a', 'c', 'b']);
  });

  test('puts undated talks last in either order, sorted by id', () => {
    const talks = [talk({ id: 'z-undated', date: '' }), talk({ id: 'a-undated', date: '2030-02-30' }), talk({ id: 'm', date: '2030-01-01' })];
    assert.deepEqual(sortTalks(talks).map((item) => item.id), ['m', 'a-undated', 'z-undated']);
    assert.deepEqual(sortTalks(talks, 'asc').map((item) => item.id), ['m', 'a-undated', 'z-undated']);
  });

  test('orders same-day talks by code-point id, independent of locale', () => {
    const ids = ['b', 'B', 'a', '10', '2', 'A', '_x', 'ä'];
    const talks = ids.map((id) => talk({ id, date: '2030-05-05' }));
    const expected = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(sortTalks(talks).map((item) => item.id), expected);
    assert.deepEqual(expected, ['10', '2', 'A', 'B', '_x', 'a', 'b', 'ä']);
    assert.notDeepEqual(expected, [...ids].sort((a, b) => a.localeCompare(b)), 'the fixture must distinguish code-point from locale order');
    assert.equal(compareIds('a', 'B'), 1);
    assert.equal(compareIds('A', 'b'), -1);
  });

  test('compares ids by code point, so an astral id sorts after every BMP character', () => {
    const astral = '\u{1D400}';
    const fullwidthA = '\uFF21';
    assert.ok(astral < fullwidthA, 'UTF-16 code unit order would put the astral id first');
    assert.equal(compareIds(astral, fullwidthA), 1);
    assert.equal(compareIds(fullwidthA, astral), -1);
    assert.equal(compareIds(astral, astral), 0);
    assert.equal(compareIds('ab', 'abc'), -1, 'a prefix sorts first');
    assert.equal(compareIds(`x${astral}`, 'x\uE000'), 1, 'private-use BMP characters sort before astral ones');
    const talks = [talk({ id: astral, date: '2030-05-05' }), talk({ id: fullwidthA, date: '2030-05-05' })];
    assert.deepEqual(sortTalks(talks).map((item) => item.id), [fullwidthA, astral]);
    const expected = [...talks.map((item) => item.id)].sort((a, b) => {
      const left = [...a].map((char) => char.codePointAt(0)!);
      const right = [...b].map((char) => char.codePointAt(0)!);
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) if (left[index] !== right[index]) return left[index] - right[index];
      return left.length - right.length;
    });
    assert.deepEqual(sortTalks(talks).map((item) => item.id), expected, 'matches a true code-point comparator');
  });

  test('does not mutate the input array', () => {
    const talks = [talk({ id: 'b', date: '2029-01-01' }), talk({ id: 'a', date: '2031-01-01' })];
    const copy = [...talks];
    sortTalks(talks);
    assert.deepEqual(talks, copy);
  });
});
