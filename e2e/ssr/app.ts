// The element both sides of the SSR test render: the server (Playwright's Node
// process, through react-dom/server) and the browser (an esbuild bundle that
// hydrates it). Both import the built package by name, as a consumer would.
import { createElement } from 'react';
import { Talks, type Talk } from '@wanderer/talks';
import { globeView } from '@wanderer/talks/globe';

export interface SsrConfig {
  breakpoint?: number;
}

const talks: Talk[] = [
  { id: 'north', title: 'Northern Lights Routing', event: 'Fjord Summit', date: '2030-02-01', description: 'A fictional talk.', format: 'in-person', location: 'Tromso, Norway', coordinates: [69.65, 18.96] },
  { id: 'south', title: 'Southern Cross Storage', event: 'Reef Conf', date: '2031-09-01', description: 'Another fictional talk.', format: 'hybrid', location: 'Cairns, Australia', coordinates: [-16.92, 145.77] },
  { id: 'remote', title: 'Remote Pipelines', event: 'Online Meetup', date: '2031-07-07', description: 'Online only.', format: 'online' },
];
const views = [globeView()];

export function ssrApp(config: SsrConfig) {
  return createElement(Talks, {
    talks, referenceDate: '2031-06-15', views,
    responsive: { small: 'list', large: 'globe', breakpoint: config.breakpoint },
  });
}
