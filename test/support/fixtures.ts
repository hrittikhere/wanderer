// Synthetic speaker data for tests. Nothing here comes from a real site.
import type { Talk } from '../../src/types.js';

export const REFERENCE_DATE = '2031-06-15';

export function talk(overrides: Partial<Talk> & { id: string }): Talk {
  return {
    title: `Talk ${overrides.id}`,
    event: `Event ${overrides.id}`,
    date: '2030-03-10',
    description: `Description for ${overrides.id}`,
    format: 'in-person',
    ...overrides,
  };
}

export const FIXTURE_TALKS: Talk[] = [
  talk({
    id: 'aurora-2030',
    title: 'Aurora Scheduling at Scale',
    event: 'Northwind Summit',
    date: '2030-03-10',
    description: 'How the fictional Aurora scheduler balances batch and interactive work.',
    location: 'Reykjavik, Iceland',
    coordinates: [64.1466, -21.9426],
    format: 'in-person',
    recordingUrl: 'https://videos.example/aurora',
    slidesUrl: 'https://slides.example/aurora',
    eventUrl: 'https://northwind.example/2030',
    tags: ['scheduling', 'batch'],
  }),
  talk({
    id: 'beacon-2029',
    title: 'Beacon Observability Patterns',
    event: 'Harbor Conf',
    date: '2029-11-02',
    description: 'Tracing fictional services with the Beacon toolkit.',
    location: { city: 'Lisbon', country: 'Portugal' },
    coordinates: [38.7223, -9.1393],
    format: 'in-person',
    eventUrl: 'https://harbor.example/2029',
    detailUrl: '/talks/beacon-2029',
    tags: ['observability'],
  }),
  talk({
    id: 'cinder-online',
    title: 'Cinder Build Pipelines',
    event: 'Remote Builders Meetup',
    date: '2031-08-20',
    description: 'An upcoming online session about Cinder, a fictional build system.',
    format: 'online',
    eventUrl: 'https://remote-builders.example/cinder',
    links: [{ kind: 'general', url: 'https://notes.example/cinder', label: 'Notes' }],
  }),
  talk({
    id: 'dune-hybrid',
    title: 'Dune Storage Internals',
    event: 'Desert Data Days',
    date: '2031-07-01',
    description: 'Upcoming hybrid talk on the fictional Dune storage engine.',
    location: 'Marrakesh, Morocco',
    coordinates: [31.6295, -7.9811],
    format: 'hybrid',
    recordingUrl: 'https://videos.example/dune',
  }),
  talk({
    id: 'ember-2029',
    title: 'Ember Networking Deep Dive',
    event: 'Harbor Conf',
    date: '2029-11-01',
    description: 'Packet flows in the fictional Ember mesh.',
    location: 'Lisbon, Portugal',
    coordinates: [38.72, -9.14],
    format: 'in-person',
    eventUrl: 'https://harbor.example/2029',
  }),
];
