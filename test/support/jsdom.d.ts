// Minimal ambient typing for jsdom: the tests use only this surface and the
// package does not ship declarations (and @types/jsdom is not installed).
declare module 'jsdom' {
  interface JSDOMOptions {
    url?: string;
    pretendToBeVisual?: boolean;
    virtualConsole?: VirtualConsole;
  }
  class VirtualConsole {
    on(event: 'error' | 'warn' | 'info' | 'log' | 'jsdomError', listener: (...args: unknown[]) => void): this;
    sendTo(console: Console, options?: { omitJSDOMErrors?: boolean }): this;
  }
  class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis & { close(): void };
  }
}
