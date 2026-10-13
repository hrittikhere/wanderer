import type { Milestone, Talk } from '@wanderer/talks';

// Synthetic appearances: repeated titles have distinct, stable IDs.
export const talks: Talk[] = [
  { id: 'lisbon-2025', title: 'Building reliable platforms', event: 'Harbor Conference', date: '2025-11-02', description: 'Practical lessons in observability, resilience and the teams behind a platform.', location: 'Lisbon, Portugal', coordinates: [38.72, -9.14], format: 'in-person', tags: ['platforms'], recordingUrl: 'https://example.com/recording', slidesUrl: 'https://example.com/slides' },
  { id: 'tokyo-2025', title: 'Building reliable platforms', event: 'Platform Days', date: '2025-06-17', description: 'A new audience, new questions and lessons from operating at scale.', location: 'Tokyo, Japan', coordinates: [35.68, 139.69], format: 'in-person', tags: ['platforms'], eventUrl: 'https://example.com/tokyo' },
  { id: 'london-2024', title: 'A hands-on introduction to tracing', event: 'Open Systems Workshop', date: '2024-09-19', description: 'Follow a request through a distributed system and find where the time goes.', location: 'London, United Kingdom', coordinates: [51.51, -0.13], format: 'hybrid', tags: ['workshop', 'observability'], slidesUrl: 'https://example.com/tracing' },
  { id: 'delhi-2024', title: 'From clusters to communities', event: 'Community Summit', date: '2024-03-21', description: 'Making cloud infrastructure approachable for a growing community.', location: 'New Delhi, India', coordinates: [28.61, 77.21], format: 'in-person', eventUrl: 'https://example.com/community' },
  { id: 'sydney-2023', title: 'Debugging across boundaries', event: 'Southern Software', date: '2023-10-12', description: 'A field guide to incidents spanning services, regions and teams.', location: 'Sydney, Australia', coordinates: [-33.87, 151.21], format: 'in-person', recordingUrl: 'https://example.com/debugging' },
  { id: 'remote-2026', title: 'The next chapter of platform engineering', event: 'Remote Builders', date: '2026-11-20', description: 'An upcoming online session with questions from the community.', location: 'Online', format: 'online', tags: ['platforms'], eventUrl: 'https://example.com/remote' },
];

export const milestones: Milestone[] = [
  { id: 'first-stage', talkId: 'lisbon-2025', title: 'A room full of questions', description: 'A highlight from the speaking journey. Open the full image without losing your place.', image: { src: '/stage.svg', alt: 'Illustrated conference stage', width: 1200, height: 1800 } },
  { id: 'community', talkId: 'delhi-2024', title: 'Connecting with the community', description: 'Sharing practical ideas, one conversation at a time.' },
];
