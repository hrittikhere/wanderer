// Runtime floor check for the built package: loads every entry through
// import() and require() and server-renders <Talks> from both builds on
// whatever Node runs this script. CI runs it on the lowest release of each
// Node line `engines` admits, after building with the toolchain's Node. It
// deliberately uses only APIs available in the oldest supported Node.
//
//   npm run build && node scripts/runtime-smoke.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const manifest = require('../package.json');
const failures = [];

const talks = [
  { id: 'north', title: 'Northern Lights Routing', event: 'Fjord Summit', date: '2030-02-01', description: 'A fictional talk.', format: 'in-person', location: 'Tromso, Norway', coordinates: [69.65, 18.96] },
  { id: 'remote', title: 'Remote Pipelines', event: 'Online Meetup', date: '2031-07-07', description: 'Online only.', format: 'online' },
];

const React = require('react');
const { renderToString } = require('react-dom/server');

for (const format of ['import', 'require']) {
  const load = async (entry) => {
    const file = path.join(packageRoot, manifest.exports[entry][format].default);
    return format === 'import' ? import(pathToFileURL(file).href) : require(file);
  };
  try {
    const [root, helpers, list, globe] = await Promise.all(['.', './helpers', './list', './globe'].map(load));
    const { valid, talks: validated } = helpers.validateTalks(talks);
    if (!valid || validated.length !== talks.length) failures.push(`${format}: validateTalks rejected the fixture`);
    if (typeof list.ListView !== 'function') failures.push(`${format}: ./list does not export ListView`);
    const html = renderToString(React.createElement(root.Talks, {
      talks, referenceDate: '2031-06-15', views: [globe.globeView()], defaultView: 'globe',
    }));
    if (!html.includes('data-wanderer-view="globe"')) failures.push(`${format}: the globe view did not server-render`);
    const listHtml = renderToString(React.createElement(root.Talks, { talks, referenceDate: '2031-06-15' }));
    if (!listHtml.includes('Northern Lights Routing')) failures.push(`${format}: the list did not server-render the talks`);
  } catch (error) {
    failures.push(`${format}: ${error && error.stack ? error.stack : error}`);
  }
}

if (failures.length) {
  console.error(`runtime smoke failed on Node ${process.version}:\n${failures.map((item) => ` - ${item}`).join('\n')}`);
  process.exit(1);
}
console.log(`runtime smoke passed on Node ${process.version} (import and require, server rendering).`);
