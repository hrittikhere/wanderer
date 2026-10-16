'use client';

import { createContext, useContext, useMemo } from 'react';
import type { BuiltinFilterId, TalkViewProps, TalksProps } from '../component-types.js';
import { Talks } from '../components/Talks.js';
import { GlobeView, globeView, type GlobeViewOptions } from './GlobeView.js';

export interface WandererProps extends Omit<TalksProps, 'talks' | 'views' | 'enabledViews'> {
  /** Optional speaking history. Milestones with explicit coordinates work on their own. */
  talks?: TalksProps['talks'];
  /** Include the location and region sidebox. Default false. */
  enableSidebox?: boolean;
  /** Include the list view and its view switcher. Default false. */
  enableList?: boolean;
  /** Show the drag and hover hint. Default false. */
  enableHint?: boolean;
  /** Globe motion, labels, order and presentation. Additions use the top-level enable props. */
  globe?: Omit<GlobeViewOptions, 'enableSidebox' | 'enableHint'>;
}

const CORE_VIEWS = ['globe'] as const;
const LIST_VIEWS = ['list', 'globe'] as const;
const DEFAULT_FILTERS: readonly BuiltinFilterId[] = ['recording', 'upcoming'];
const NO_TALKS: TalksProps['talks'] = [];
const GlobeOptions = createContext<GlobeViewOptions>({});

// Additions can change without replacing the globe, its WebGL context or the selected milestone.
function WandererGlobe(props: TalkViewProps) {
  return <GlobeView {...props} options={useContext(GlobeOptions)} />;
}

/** A globe and milestone component. Page controls and the sidebox are explicit additions. */
export function Wanderer({
  talks = NO_TALKS,
  enableSidebox = false,
  enableList = false,
  enableHint = false,
  enableSearch = false,
  enableFilters = false,
  enableResultCount = false,
  globe,
  builtinFilters,
  ...props
}: WandererProps) {
  const { presentation, intro, autoRotate, label, heading, order } = globe ?? {};
  const options = useMemo(() => ({
    presentation, intro, autoRotate, label, heading, order, enableSidebox, enableHint,
  }), [presentation, intro, autoRotate, label, heading, order, enableSidebox, enableHint]);
  const views = useMemo(() => [{ ...globeView(options), Component: WandererGlobe }], [options]);
  return (
    <GlobeOptions.Provider value={options}>
      <Talks
        {...props}
        talks={talks}
        views={views}
        enabledViews={enableList ? LIST_VIEWS : CORE_VIEWS}
        defaultView={props.defaultView ?? 'globe'}
        viewHeadings={props.viewHeadings ?? 'visually-hidden'}
        enableSearch={enableSearch}
        enableFilters={enableFilters}
        enableResultCount={enableResultCount}
        builtinFilters={builtinFilters ?? DEFAULT_FILTERS}
      />
    </GlobeOptions.Provider>
  );
}
