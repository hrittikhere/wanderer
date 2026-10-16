// Globe entry: use Wanderer for a globe with opt-in additions, or pass
// globeView() through the views prop for advanced Talks composition. The WebGL
// renderer and cobe load lazily on mount or through preloadGlobeView().
export { GlobeView, globeView, preloadGlobeView, GlobeRegionList } from './globe/GlobeView.js';
export type { GlobeViewOptions, GlobeViewProps } from './globe/GlobeView.js';
export type { GlobeColors, GlobeRendererProps, PositionedMilestone, Rgb } from './globe/renderer-types.js';
export { Wanderer } from './globe/Wanderer.js';
export type { WandererProps } from './globe/Wanderer.js';
