// Server-side smoke test. Runs without jsdom, counts every access to
// window/document on globalThis, traces every module Node resolves, and
// prints the observations as JSON for the parent test.
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const accesses: string[] = [];
for (const name of ['window', 'document']) {
  if (name in globalThis) throw new Error(`${name} already defined in the SSR child`);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { accesses.push(name); return undefined; },
  });
}

const { port1, port2 } = new MessageChannel();
const resolved: string[] = [];
port1.on('message', (url: string) => { resolved.push(url); });
port1.unref();
register('./trace-hooks.mjs', { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });

const { Talks } = await import('../../src/index.js');
const { globeView, preloadGlobeView } = await import('../../src/globe.js');

const talks = [
  { id: 'one', title: 'One', event: 'Event One', date: '2030-01-05', description: 'First', format: 'in-person', location: 'Oslo, Norway', coordinates: [59.91, 10.75] },
  { id: 'two', title: 'Two', event: 'Event Two', date: '2031-09-09', description: 'Second', format: 'online' },
];

const responsive = renderToString(createElement(Talks, {
  talks, referenceDate: '2031-06-15', views: [globeView()], responsive: { small: 'list', large: 'globe' },
}));
const fixedList = renderToString(createElement(Talks, { talks, referenceDate: '2031-06-15', views: [globeView()], defaultView: 'list' }));
const fixedGlobe = renderToString(createElement(Talks, { talks, referenceDate: '2031-06-15', views: [globeView()], defaultView: 'globe' }));

const renderAccesses = [...accesses];
const preload = preloadGlobeView();
const preloadIsPromise = preload instanceof Promise;
let preloadSettled = false;
await preload.then(() => { preloadSettled = true; });
// Give the hook thread a moment to deliver any resolution messages.
await new Promise((resolve) => setTimeout(resolve, 100));

const count = (html: string, needle: string) => html.split(needle).length - 1;
process.stdout.write(JSON.stringify({
  renderAccesses,
  accesses,
  resolved,
  preloadIsPromise,
  preloadSettled,
  responsive: {
    length: responsive.length,
    smallShells: count(responsive, 'wanderer-shell--small'),
    largeShells: count(responsive, 'wanderer-shell--large'),
    activeShells: count(responsive, 'wanderer-shell--active'),
    hasBreakpoint: responsive.includes('data-wanderer-breakpoint="1024"'),
    viewSmall: /data-wanderer-view-small="([^"]*)"/.exec(responsive)?.[1],
    viewLarge: /data-wanderer-view-large="([^"]*)"/.exec(responsive)?.[1],
    globeStatus: /data-wanderer-globe-status="([^"]*)"/.exec(responsive)?.[1],
  },
  fixedList: {
    smallShells: count(fixedList, 'wanderer-shell--small'),
    largeShells: count(fixedList, 'wanderer-shell--large'),
    activeShells: count(fixedList, 'wanderer-shell--active'),
    view: /data-wanderer-view="([^"]*)"/.exec(fixedList)?.[1],
  },
  fixedGlobe: {
    activeShells: count(fixedGlobe, 'wanderer-shell--active'),
    view: /data-wanderer-view="([^"]*)"/.exec(fixedGlobe)?.[1],
    globeStatus: /data-wanderer-globe-status="([^"]*)"/.exec(fixedGlobe)?.[1],
  },
}));
