import type { CopyOverrides, TalksCopy } from './component-types.js';

/** English defaults. Every key can be overridden through the `copy` prop. */
export function createDefaultCopy(): TalksCopy {
  return {
    rootLabel: 'Talks',
    viewsLabel: 'View',
    listView: 'List',
    globeView: 'Globe',
    listHeading: 'All talks',
    globeHeading: 'Talks on the map',
    searchLabel: 'Search talks',
    searchPlaceholder: 'Search titles, events, locations',
    clearSearch: 'Clear search',
    filtersLabel: 'Filters',
    recordingFilter: 'With recording',
    upcomingFilter: 'Upcoming only',
    onlineFilter: 'Online',
    inPersonFilter: 'In person',
    hybridFilter: 'Hybrid',
    clearFilters: 'Clear filters',
    resetAll: 'Reset search and filters',
    upcoming: 'Upcoming',
    upcomingBadge: 'Upcoming',
    undated: 'Undated',
    undatedMonth: '–',
    noTalks: 'No talks yet',
    noTalksDescription: 'Talks will appear here once they are added.',
    noMatches: 'No talks match',
    noMatchesDescription: 'Try a different search or clear the filters.',
    loadingGlobe: 'Loading the globe',
    globeUnavailable: 'The globe could not be shown',
    globeUnavailableDescription: 'Your browser may not support WebGL, or the globe module failed to load. Everything is in the list.',
    noMappedTalks: 'No talks on the map',
    noMappedDescription: 'Add coordinates to talks, or supply a coordinate resolver, to place them on the globe.',
    useList: 'Open the list',
    backToList: 'Back to the list',
    exitFullscreen: 'Exit fullscreen',
    regions: 'Regions',
    locations: 'Locations',
    unassignedRegion: 'Other',
    unknownLocation: 'Unknown location',
    globeLabel: 'Interactive globe of talk locations',
    globeHint: 'Drag to rotate. Hover a marker for details.',
    milestones: 'Milestones',
    chooseMilestone: 'Choose a milestone',
    pauseGlobe: 'Pause animation',
    resumeGlobe: 'Resume animation',
    dismissMilestone: 'Dismiss milestone',
    viewMilestoneImage: 'View full photo',
    latest: 'Latest',
    eventAction: 'Event page',
    recordingAction: 'Watch recording',
    slidesAction: 'Slides',
    detailAction: 'Details',
    generalAction: 'Link',
    online: 'Online',
    inPerson: 'In person',
    hybrid: 'Hybrid',
    validationError: 'The talks could not be displayed because the data is invalid.',
    pluginError: 'This part of the page failed to render.',
    resultCount: (count, total) =>
      count === total ? `${count} ${count === 1 ? 'talk' : 'talks'}` : `${count} of ${total} talks`,
    groupCount: (count) => `${count} ${count === 1 ? 'talk' : 'talks'}`,
    mappedCount: (mapped, locations) =>
      `${mapped} ${mapped === 1 ? 'talk' : 'talks'} in ${locations} ${locations === 1 ? 'location' : 'locations'}`,
    locationCount: (count) => `${count} ${count === 1 ? 'talk' : 'talks'}`,
    regionPercentage: (percentage) => `${percentage.toFixed(1)}%`,
    actionLabel: (action, title) => `${action}: ${title}`,
  };
}

export function mergeCopy(overrides?: CopyOverrides): TalksCopy {
  const base = createDefaultCopy();
  if (!overrides) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    // undefined and null (a missing key after JSON or RSC serialization) keep the default.
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged as unknown as TalksCopy;
}
