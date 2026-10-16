'use client';

import type { TalksContext } from '../component-types.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { CloseIcon, SearchIcon } from './icons.js';

/** Preloading is speculative. A later view mount owns error reporting and retry. */
function preload(preloadView?: () => Promise<unknown>): void {
  if (preloadView) void Promise.resolve().then(preloadView).catch(() => {});
}

export interface ToolbarProps {
  context: TalksContext;
  /** The view this toolbar belongs to; differs per shell before hydration measures the viewport. */
  activeView: string | undefined;
  /**
   * Suffix for the search field's id (`${context.instanceId}-${shellKey}-search`),
   * unique per toolbar. `Talks` uses `active`, or `small` and `large` for the
   * two shells it renders before hydration; a second toolbar needs another key.
   */
  shellKey: string;
  /** The search text as typed. Defaults to `context.search`, which can trail the field by a render. */
  search?: string;
  /** The filter ids as toggled. Defaults to `context.filters`. */
  filters?: readonly string[];
  /** Whether search text or a filter is active, from the values above. Defaults to `context.hasActiveFilters`. */
  hasActiveFilters?: boolean;
  /** Each toolbar addition can be enabled independently. Defaults preserve Talks composition. */
  enableSearch?: boolean;
  enableFilters?: boolean;
  enableResultCount?: boolean;
  enableViewSwitcher?: boolean;
}

export function Toolbar({ context, activeView, shellKey, search = context.search, filters = context.filters, hasActiveFilters = context.hasActiveFilters, enableSearch = true, enableFilters = true, enableResultCount = true, enableViewSwitcher = true }: ToolbarProps) {
  const {
    copy, views, setView, setSearch, toggleFilter, availableFilters, resetAll, talks, allTalks, slots,
  } = context;
  const searchId = `${context.instanceId}-${shellKey}-search`;
  const SearchInput = slots.SearchInput;
  const showViews = enableViewSwitcher && views.length > 1;
  const showFilters = enableFilters && availableFilters.length > 0;
  if (!enableSearch && !showFilters && !enableResultCount && !showViews) return null;

  return (
    <div className="wanderer-toolbar">
      {enableSearch && <div className="wanderer-toolbar__search">
        {SearchInput ? (
          // A slot that throws loses only the field; the chips, count and views keep working.
          <ErrorBoundary fallback={<p className="wanderer-error" role="alert">{copy.pluginError}</p>}>
            <SearchInput
              id={searchId}
              value={search}
              onChange={setSearch}
              label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              resultCount={talks.length}
              context={context}
            />
          </ErrorBoundary>
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
      </div>}

      {showFilters && (
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

      {enableResultCount && <p className="wanderer-toolbar__count">
        <span>{copy.resultCount(talks.length, allTalks.length)}</span>
        {hasActiveFilters && (
          <button type="button" className="wanderer-link-button" onClick={resetAll}>
            {copy.resetAll}
          </button>
        )}
      </p>}

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
