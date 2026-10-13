'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import type { ColorScheme, Theme } from './component-types.js';

function noopSubscribe(): () => void {
  return () => {};
}

/** True after hydration; false on the server and during the first hydration render. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * SSR-safe media query. Returns undefined on the server and during hydration,
 * then the live match. Environments without matchMedia report false.
 */
export function useMediaQuery(query: string | null): boolean | undefined {
  const subscribe = useCallback((onChange: () => void) => {
    if (!query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  const getSnapshot = useCallback(() => {
    if (!query) return undefined;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)') === true;
}

function readHostScheme(element: Element | null): ColorScheme | null {
  const host = element?.closest('[data-wanderer-scheme]');
  const value = host?.getAttribute('data-wanderer-scheme');
  return value === 'dark' || value === 'light' ? value : null;
}

/**
 * Resolves the color scheme the stylesheet will use. Explicit themes win.
 * For `system`, an ancestor `data-wanderer-scheme` host hint wins over the
 * operating-system preference, mirroring styles.css. Light during SSR and the
 * first hydration render; the real value arrives from an effect.
 */
export function useColorScheme(theme: Theme, rootRef?: RefObject<Element | null>): ColorScheme {
  const prefersDark = useMediaQuery(theme === 'system' ? '(prefers-color-scheme: dark)' : null);
  const [hostScheme, setHostScheme] = useState<ColorScheme | null>(null);
  useEffect(() => {
    if (theme !== 'system' || typeof MutationObserver === 'undefined') return;
    const element = rootRef?.current ?? null;
    const sync = () => setHostScheme(readHostScheme(element));
    sync();
    const host = element?.closest('[data-wanderer-scheme]');
    if (!host) return;
    const observer = new MutationObserver(sync);
    observer.observe(host, { attributes: true, attributeFilter: ['data-wanderer-scheme'] });
    return () => observer.disconnect();
  }, [theme, rootRef]);
  if (theme !== 'system') return theme;
  if (hostScheme) return hostScheme;
  return prefersDark ? 'dark' : 'light';
}

/** Controlled when `value` is defined; otherwise internal state seeded from `defaultValue`. */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [inner, setInner] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : inner;
  const set = useCallback((next: T) => {
    if (!isControlled) setInner(next);
    onChange?.(next);
  }, [isControlled, onChange]);
  return [current, set];
}
