// Globe entry: optional. Importing it registers nothing; pass `globeView()`
// through the `views` prop. The WebGL renderer and `cobe` load lazily when the
// view mounts or when `preloadGlobeView()` is called.
export { GlobeView, globeView, preloadGlobeView, GlobeRegionList } from './globe/GlobeView.js';
export type { GlobeViewOptions } from './globe/GlobeView.js';
export type { GlobeColors, GlobeRendererProps, PositionedMilestone, Rgb } from './globe/renderer-types.js';
