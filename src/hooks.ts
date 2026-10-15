'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
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
 * For `system`, the nearest ancestor `data-wanderer-scheme` host hint wins
 * over the operating-system preference, mirroring styles.css. Without
 * `rootRef` (or before it is attached) the hint on `<html>` applies. Hints
 * added, changed or removed after mount are followed. Light during SSR and
 * the first hydration render; the real value arrives from an effect.
 */
export function useColorScheme(theme: Theme, rootRef?: RefObject<Element | null>): ColorScheme {
  const prefersDark = useMediaQuery(theme === 'system' ? '(prefers-color-scheme: dark)' : null);
  const [hostScheme, setHostScheme] = useState<ColorScheme | null>(null);
  useEffect(() => {
    if (theme !== 'system' || typeof document === 'undefined') return;
    // The element is read on every check, not once: the root can be replaced
    // without this effect re-running (Talks swaps it when a strict error clears).
    const sync = () => setHostScheme(readHostScheme(rootRef?.current ?? document.documentElement));
    sync();
    if (typeof MutationObserver === 'undefined') return;
    // The whole document, so a hint that appears after mount, or on another
    // ancestor than the one present at mount, is picked up as well.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-wanderer-scheme'], subtree: true });
    return () => observer.disconnect();
  }, [theme, rootRef]);
  if (theme !== 'system') return theme;
  if (hostScheme) return hostScheme;
  return prefersDark ? 'dark' : 'light';
}

/** A next value, or a function of the latest value (including updates not rendered yet). */
export type ControllableUpdate<T> = T | ((previous: T) => T);

/**
 * Controlled when `value` is defined; otherwise internal state seeded from
 * `defaultValue`. The setter is stable and accepts a function of the latest
 * value, so several updates in one handler compose in both modes: each sees
 * the value the previous one produced, while a controlled value the parent
 * did not adopt is dropped at the next render.
 */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: ControllableUpdate<T>) => void] {
  const [inner, setInner] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : inner;
  const latestRef = useRef(current);
  latestRef.current = current;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const resetQueuedRef = useRef(false);
  const set = useCallback((next: ControllableUpdate<T>) => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(latestRef.current) : next;
    latestRef.current = resolved;
    if (!isControlled) setInner(resolved);
    else if (!resetQueuedRef.current) {
      // Updates in the same handler build on each other; once it is over, the
      // prop is the truth again, whether or not the parent adopted the value.
      resetQueuedRef.current = true;
      queueMicrotask(() => {
        resetQueuedRef.current = false;
        if (valueRef.current !== undefined) latestRef.current = valueRef.current;
      });
    }
    onChangeRef.current?.(resolved);
  }, [isControlled]);
  return [current, set];
}

/**
 * Returns the previous value while a new one is shallowly equal (same array
 * items, or same own keys and values), so inline literals such as
 * `plugins={[a]}` or `copy={{ ... }}` do not invalidate memoized work.
 */
export function useShallowStable<T>(value: T): T {
  const ref = useRef(value);
  if (!shallowEqual(ref.current, value)) ref.current = value;
  return ref.current;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    // Array.every skips holes, which would retain stale data when a sparse
    // array is replaced with populated entries of the same length.
    for (let index = 0; index < a.length; index += 1) {
      if (!Object.is(a[index], b[index])) return false;
    }
    return true;
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
