import { validateTalks } from '@wanderer/talks/helpers';
import { TalksClient } from './talks-client';

export default function Page() {
  const result = validateTalks([{ id: 'lisbon-2025', title: 'Building reliable platforms', event: 'Harbor Conference', date: '2025-11-02', description: 'A synthetic session for this runnable example.', location: 'Lisbon, Portugal', coordinates: [38.72, -9.14], format: 'in-person', detailUrl: '/session' }]);
  if (!result.valid) throw new Error('Invalid example data');
  // Supply the same date to server render and hydration. A real app can read
  // it in its own request or cache boundary, according to its freshness needs.
  return <main><h1>Speaking history</h1><TalksClient talks={result.talks} referenceDate="2026-10-13" /></main>;
}
