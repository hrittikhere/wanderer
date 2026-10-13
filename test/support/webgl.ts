// A fake WebGL environment for jsdom so the real cobe/phenomenon renderer can
// mount: every GL call is a no-op, requestAnimationFrame is a manual queue the
// test flushes frame by frame, and counters expose what the renderer did.
import type { DomHandle } from './dom.js';

type FrameCallback = (now: number) => void;

export class FrameQueue {
  private queue = new Map<number, FrameCallback>();
  private nextId = 1;
  now = 0;

  request(callback: FrameCallback): number {
    const id = this.nextId++;
    this.queue.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Runs every callback queued so far, in registration order, as one animation frame. */
  flush(step = 16): void {
    const batch = [...this.queue.values()];
    this.queue.clear();
    this.now += step;
    for (const callback of batch) callback(this.now);
  }
}

export interface FakeWebGl {
  frames: FrameQueue;
  /** Programs created: one per cobe globe instance. */
  programs: number;
  /** gl.clear calls: one per phenomenon render frame. */
  clears: number;
  /** WEBGL_lose_context.loseContext() calls, made by the support probe. */
  released: number;
  setVisible(visible: boolean): void;
  cleanup(): void;
}

export interface FakeWebGlOptions {
  /** Return true to deny a WebGL context for this canvas (phenomenon then throws). */
  deny?: (canvas: HTMLCanvasElement) => boolean;
}

export function installFakeWebGl(dom: DomHandle, options: FakeWebGlOptions = {}): FakeWebGl {
  const { window } = dom;
  const frames = new FrameQueue();
  const state: FakeWebGl = {
    frames,
    programs: 0,
    clears: 0,
    released: 0,
    setVisible(visible) {
      visibility = visible ? 'visible' : 'hidden';
      dom.document.dispatchEvent(new window.Event('visibilitychange'));
    },
    cleanup,
  };
  let visibility = 'visible';

  const makeGl = () => {
    const known: Record<string, unknown> = {
      getContextAttributes: () => ({ alpha: true }),
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => { state.released += 1; }, restoreContext: () => {} } : null),
      createProgram: () => { state.programs += 1; return {}; },
      clear: () => { state.clears += 1; },
      createShader: () => ({}),
      createBuffer: () => ({}),
      createTexture: () => ({}),
      getUniformLocation: () => ({}),
      getAttribLocation: () => 0,
      getParameter: () => ({}),
      drawingBufferWidth: 1,
      drawingBufferHeight: 1,
    };
    return new Proxy(known, {
      get(target, property) {
        if (property in target) return target[property as string];
        if (typeof property === 'symbol') return undefined;
        return () => undefined;
      },
    });
  };

  const canvasPrototype = window.HTMLCanvasElement.prototype;
  const previousGetContext = Object.getOwnPropertyDescriptor(canvasPrototype, 'getContext');
  Object.defineProperty(canvasPrototype, 'getContext', {
    configurable: true,
    writable: true,
    value: function getContext(this: HTMLCanvasElement, type: string) {
      if (type === '2d') return null;
      if (options.deny?.(this)) return null;
      return makeGl();
    },
  });

  const elementPrototype = window.Element.prototype as unknown as Record<string, unknown>;
  const pointerMethods = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const;
  const previousPointer = pointerMethods.map((name) => [name, Object.getOwnPropertyDescriptor(elementPrototype, name)] as const);
  for (const name of pointerMethods) {
    Object.defineProperty(elementPrototype, name, { configurable: true, writable: true, value: () => (name === 'hasPointerCapture' ? false : undefined) });
  }

  const previousVisibility = Object.getOwnPropertyDescriptor(dom.document, 'visibilityState');
  Object.defineProperty(dom.document, 'visibilityState', { configurable: true, get: () => visibility });

  const request = (callback: FrameCallback) => frames.request(callback);
  const cancel = (id: number) => frames.cancel(id);
  const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
  // cobe's texture setup uses the bare `Image` constructor.
  const globals: [string, unknown][] = [['requestAnimationFrame', request], ['cancelAnimationFrame', cancel], ['Image', window.Image]];
  for (const [name, value] of globals) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    if (name !== 'Image') Object.defineProperty(window, name, { configurable: true, writable: true, value });
  }

  const previousNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => frames.now });

  function cleanup() {
    if (previousGetContext) Object.defineProperty(canvasPrototype, 'getContext', previousGetContext);
    for (const [name, descriptor] of previousPointer) {
      if (descriptor) Object.defineProperty(elementPrototype, name, descriptor);
      else delete elementPrototype[name];
    }
    if (previousVisibility) Object.defineProperty(dom.document, 'visibilityState', previousVisibility);
    else delete (dom.document as unknown as Record<string, unknown>).visibilityState;
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    if (previousNow) Object.defineProperty(performance, 'now', previousNow);
    else delete (performance as unknown as Record<string, unknown>).now;
  }

  return state;
}
