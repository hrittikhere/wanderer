import { cacheLife } from 'next/cache';
import { validateTalks } from '@wanderer/talks/helpers';
import { TalksClient } from './talks-client';

// Server render and hydration must agree on "today". Under Cache Components,
// reading the clock during prerender is an error; a cached scope pins the
// date and refreshes it on the cache profile.
async function getReferenceDate(): Promise<string> {
  'use cache';
  cacheLife('hours');
  return new Date().toISOString().slice(0, 10);
}

export default async function Page() {
  const result = validateTalks([{ id: 'lisbon-2025', title: 'Building reliable platforms', event: 'Harbor Conference', date: '2025-11-02', description: 'A synthetic session for this runnable example.', location: 'Lisbon, Portugal', coordinates: [38.72, -9.14], format: 'in-person', detailUrl: '/session' }]);
  if (!result.valid) throw new Error('Invalid example data');
  return <main><h1>Speaking history</h1><TalksClient talks={result.talks} referenceDate={await getReferenceDate()} /></main>;
}
