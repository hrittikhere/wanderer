// Runs in a child process with process.env.TZ fixed before startup, so the
// local zone differs from UTC. Prints the observations as JSON for the parent.
import { classifyTalkDate, formatCalendarDate, isUpcoming, parseCalendarDate } from '../../src/helpers.js';

const observations = {
  tz: process.env.TZ,
  offsetMinutes: new Date('2030-01-01T12:00:00Z').getTimezoneOffset(),
  newYearsEve: formatCalendarDate('2030-12-31'),
  newYearsDay: formatCalendarDate('2031-01-01'),
  leapDay: formatCalendarDate('2024-02-29'),
  german: formatCalendarDate('2030-03-10', 'de-DE'),
  japanese: formatCalendarDate('2030-03-10', 'ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }),
  isoRoundTrip: parseCalendarDate('2030-12-31')?.toISOString(),
  utcParts: (() => {
    const date = parseCalendarDate('2030-12-31');
    return date ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()] : null;
  })(),
  sameDayUpcoming: isUpcoming('2030-12-31', '2030-12-31'),
  dayBeforeUpcoming: isUpcoming('2030-12-30', '2030-12-31'),
  dayAfterUpcoming: isUpcoming('2031-01-01', '2030-12-31'),
  classifySameDay: classifyTalkDate('2030-12-31', '2030-12-31'),
  classifyDayBefore: classifyTalkDate('2030-12-30', '2030-12-31'),
};
process.stdout.write(JSON.stringify(observations));
