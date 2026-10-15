// Per-test JSDOM harness. Each call creates a fresh window, installs the DOM
// globals React DOM needs, and stubs window.matchMedia with a controllable
// implementation so tests can simulate breakpoint and OS preference changes.
// jsdom has no IntersectionObserver or ResizeObserver; recording fakes stand
// in, and tests deliver entries with intersect() and resize(). An exception
// that reaches the window (React reports a throwing event handler there)
// fails cleanup() unless the test drained it with takeErrors().
import { JSDOM, VirtualConsole } from 'jsdom';

export interface MediaFlags {
  width: number;
  prefersDark: boolean;
  reducedMotion: boolean;
}

interface MediaEntry {
  list: FakeMediaQueryList;
  matches: boolean;
}

type ChangeListener = (event: { matches: boolean; media: string }) => void;

class FakeMediaQueryList {
  readonly media: string;
  matches: boolean;
  onchange: ChangeListener | null = null;
  private listeners = new Set<ChangeListener>();
  constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }
  addEventListener(type: string, listener: ChangeListener): void {
    if (type === 'change') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: ChangeListener): void {
    if (type === 'change') this.listeners.delete(listener);
  }
  addListener(listener: ChangeListener): void { this.listeners.add(listener); }
  removeListener(listener: ChangeListener): void { this.listeners.delete(listener); }
  dispatch(): void {
    const event = { matches: this.matches, media: this.media };
    for (const listener of [...this.listeners]) listener(event);
    this.onchange?.(event);
  }
  get listenerCount(): number { return this.listeners.size + (this.onchange ? 1 : 0); }
}

function evaluate(query: string, flags: MediaFlags): boolean {
  const min = /\(min-width:\s*([\d.]+)px\)/.exec(query);
  const max = /\(max-width:\s*([\d.]+)px\)/.exec(query);
  if (min && flags.width < Number(min[1])) return false;
  if (max && flags.width > Number(max[1])) return false;
  if (/prefers-color-scheme:\s*dark/.test(query) && !flags.prefersDark) return false;
  if (/prefers-color-scheme:\s*light/.test(query) && flags.prefersDark) return false;
  if (/prefers-reduced-motion:\s*reduce/.test(query) && !flags.reducedMotion) return false;
  if (/prefers-reduced-motion:\s*no-preference/.test(query) && flags.reducedMotion) return false;
  return Boolean(min || max || /prefers-/.test(query));
}

type ObserverKind = 'intersection' | 'resize';

interface ObserverRecord {
  observer: object;
  callback: (entries: object[], observer: object) => void;
  targets: Set<Element>;
}

/** IntersectionObserver and ResizeObserver stand-ins that only report when a test says so. */
function fakeObservers(registry: Record<ObserverKind, Set<ObserverRecord>>) {
  const make = (kind: ObserverKind) => class {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
    private readonly record: ObserverRecord;
    constructor(callback: ObserverRecord['callback']) {
      this.record = { observer: this, callback, targets: new Set() };
      registry[kind].add(this.record);
    }
    observe(target: Element): void { this.record.targets.add(target); }
    unobserve(target: Element): void { this.record.targets.delete(target); }
    disconnect(): void { this.record.targets.clear(); }
    takeRecords(): object[] { return []; }
  };
  return { IntersectionObserver: make('intersection'), ResizeObserver: make('resize') };
}

export interface DomHandle {
  dom: JSDOM;
  window: JSDOM['window'];
  document: Document;
  flags: MediaFlags;
  /** Updates the viewport width and notifies matching media query lists whose result changed. */
  setWidth(width: number): void;
  setPrefersDark(value: boolean): void;
  setReducedMotion(value: boolean): void;
  /** Number of live matchMedia lists that currently have change listeners. */
  subscriptionCount(): number;
  /** Delivers an IntersectionObserver entry for `target` to every observer watching it. */
  intersect(target: Element, isIntersecting: boolean): void;
  /** Delivers a ResizeObserver entry with this content box for `target` to every observer watching it. */
  resize(target: Element, width: number, height: number): void;
  /** Elements currently observed by any observer of this kind. */
  observed(kind: ObserverKind): Element[];
  /** Returns and clears the exceptions that reached the window since the last call. */
  takeErrors(): unknown[];
  /** Restores the globals and closes the window; throws if an exception reached the window and was not taken. */
  cleanup(): void;
}

const GLOBAL_KEYS = [
  'window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'HTMLButtonElement',
  'HTMLCanvasElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent',
  'getComputedStyle', 'DocumentFragment', 'SVGElement', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
] as const;

export function installDom(options: Partial<MediaFlags> & { html?: string } = {}): DomHandle {
  const flags: MediaFlags = {
    width: options.width ?? 1024,
    prefersDark: options.prefersDark ?? false,
    reducedMotion: options.reducedMotion ?? false,
  };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {});
  const dom = new JSDOM(options.html ?? '<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.test/',
    virtualConsole,
  });
  const { window } = dom;
  const entries: MediaEntry[] = [];
  const matchMedia = (query: string) => {
    const list = new FakeMediaQueryList(query, evaluate(query, flags));
    entries.push({ list, matches: list.matches });
    return list;
  };
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
  const observers: Record<ObserverKind, Set<ObserverRecord>> = { intersection: new Set(), resize: new Set() };
  for (const [name, value] of Object.entries(fakeObservers(observers))) {
    if (!(name in window)) Object.defineProperty(window, name, { value, configurable: true, writable: true });
  }
  const deliver = (kind: ObserverKind, target: Element, entry: object) => {
    for (const record of [...observers[kind]]) {
      if (record.targets.has(target)) record.callback([{ target, time: window.performance.now(), ...entry }], record.observer);
    }
  };
  const errors: unknown[] = [];
  window.addEventListener('error', (event) => { errors.push(event.error ?? event.message); });

  const notify = () => {
    for (const entry of entries) {
      const next = evaluate(entry.list.media, flags);
      if (next === entry.matches) continue;
      entry.matches = next;
      entry.list.matches = next;
      entry.list.dispatch();
    }
  };

  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of GLOBAL_KEYS) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = (window as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  return {
    dom,
    window,
    document: window.document,
    flags,
    setWidth(width) { flags.width = width; notify(); },
    setPrefersDark(value) { flags.prefersDark = value; notify(); },
    setReducedMotion(value) { flags.reducedMotion = value; notify(); },
    subscriptionCount() { return entries.filter((entry) => entry.list.listenerCount > 0).length; },
    intersect(target, isIntersecting) {
      const rect = target.getBoundingClientRect();
      deliver('intersection', target, {
        isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, boundingClientRect: rect,
        intersectionRect: isIntersecting ? rect : new window.DOMRect(), rootBounds: null,
      });
    },
    resize(target, width, height) {
      const size = [{ inlineSize: width, blockSize: height }];
      deliver('resize', target, {
        contentRect: new window.DOMRect(0, 0, width, height), contentBoxSize: size, borderBoxSize: size, devicePixelContentBoxSize: size,
      });
    },
    observed(kind) { return [...observers[kind]].flatMap((record) => [...record.targets]); },
    takeErrors() { return errors.splice(0); },
    cleanup() {
      for (const key of GLOBAL_KEYS) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      window.close();
      if (errors.length) {
        const messages = errors.splice(0).map((error) => (error instanceof Error ? error.stack ?? error.message : String(error)));
        throw new Error(`An exception reached the window and no test took it:\n${messages.join('\n')}`);
      }
    },
  };
}

/** Fires a React-compatible input event that updates a controlled input's value. */
export function setInputValue(input: HTMLInputElement, value: string, window: DomHandle['window']): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

export function click(element: Element, window: DomHandle['window']): void {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

export function keydown(element: Element, key: string, window: DomHandle['window'], init: { preventDefault?: boolean } = {}): void {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (init.preventDefault) event.preventDefault();
  element.dispatchEvent(event);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
