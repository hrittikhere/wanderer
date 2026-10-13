import type { ReactNode } from 'react';
import type { ColorScheme, Milestone, TalksCopy, TextDirection } from '../component-types.js';
import type { Coordinates, GlobeMarker } from '../types.js';

export type Rgb = [number, number, number];

/** Colors resolved from the `--wanderer-globe-*` tokens, as 0..1 RGB for the WebGL renderer. */
export interface GlobeColors {
  land: Rgb;
  marker: Rgb;
  background: Rgb;
  glow: Rgb;
}

export type PositionedMilestone = Milestone & { coordinates: Coordinates };

export interface GlobeRendererProps {
  markers: readonly GlobeMarker[];
  milestones: readonly PositionedMilestone[];
  colors: GlobeColors;
  colorScheme: ColorScheme;
  /** Disables automatic rotation, the intro animation, and nonessential motion. */
  reducedMotion: boolean;
  /** True when the page is hidden or the stage is offscreen; rendering must stop. */
  paused: boolean;
  intro: boolean;
  autoRotate: boolean;
  /** False freezes the selected milestone while allowing manual globe interaction. */
  autoMilestones?: boolean;
  /** Draw connector lines from milestone markers toward the callout anchor (large layouts only). */
  showConnectors: boolean;
  calloutAnchor: { x: string; y: string };
  copy: TalksCopy;
  locale: string;
  direction: TextDirection;
  formatDate: (date: string, options?: Intl.DateTimeFormatOptions) => string;
  activeMilestoneId: string | null;
  onActiveMilestoneChange: (id: string | null) => void;
  /** Marker to rotate toward (set when a location is expanded in the accessible list). */
  focusMarkerId: string | null;
  /** Optional custom tooltip content for a hovered marker. */
  renderMarkerTooltip?: (marker: GlobeMarker) => ReactNode;
  /** The WebGL context was lost; the renderer asks the browser to restore it and rebuilds the globe when it does. */
  onContextLost?: () => void;
  onContextRestored?: () => void;
}
