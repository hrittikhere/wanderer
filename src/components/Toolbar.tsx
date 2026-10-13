'use client';

import type { TalksContext } from '../component-types.js';
import { CloseIcon, SearchIcon } from './icons.js';

/** Preloading is speculative. A later view mount owns error reporting and retry. */
function preload(preloadView?: () => Promise<unknown>): void {
  if (preloadView) void Promise.resolve().then(preloadView).catch(() => {});
}

interface ToolbarProps {
  context: TalksContext;
  /** The view this toolbar belongs to; differs per shell before hydration measures the viewport. */
  activeView: string | undefined;
  shellKey: string;
}

export function Toolbar({ context, activeView, shellKey }: ToolbarProps) {
  const {
    copy, views, setView, search, setSearch, filters, toggleFilter, availableFilters,
    hasActiveFilters, resetAll, talks, allTalks, slots,
  } = context;
  const searchId = `${context.instanceId}-${shellKey}-search`;
  const SearchInput = slots.SearchInput;
  const showViews = views.length > 1;

  return (
    <div className="wanderer-toolbar">
      <div className="wanderer-toolbar__search">
        {SearchInput ? (
          <SearchInput
            id={searchId}
            value={search}
            onChange={setSearch}
            label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
            resultCount={talks.length}
            context={context}
          />
        ) : (
          <div className="wanderer-search">
            <label htmlFor={searchId} className="wanderer-visually-hidden">{copy.searchLabel}</label>
            <SearchIcon className="wanderer-search__icon" />
            <input
              id={searchId}
              type="search"
              className="wanderer-search__input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            {search && (
              <button
                type="button"
                className="wanderer-search__clear"
                onClick={() => setSearch('')}
                aria-label={copy.clearSearch}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        )}
      </div>

      {availableFilters.length > 0 && (
        <div className="wanderer-filters" role="group" aria-label={copy.filtersLabel}>
          {availableFilters.map((filter) => (
            <button
              type="button"
              key={filter.id}
              className="wanderer-chip"
              aria-pressed={filters.includes(filter.id)}
              onClick={() => toggleFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      <p className="wanderer-toolbar__count">
        <span>{copy.resultCount(talks.length, allTalks.length)}</span>
        {hasActiveFilters && (
          <button type="button" className="wanderer-link-button" onClick={resetAll}>
            {copy.resetAll}
          </button>
        )}
      </p>

      {showViews && (
        <div className="wanderer-views" role="group" aria-label={copy.viewsLabel}>
          {views.map((view) => (
            <button
              type="button"
              key={view.id}
              className="wanderer-views__button"
              aria-pressed={view.id === activeView}
              onClick={() => setView(view.id, 'user')}
              onPointerEnter={() => preload(view.preload)}
              onFocus={() => preload(view.preload)}
            >
              {view.icon}
              <span>{view.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
