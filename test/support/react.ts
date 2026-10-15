// Loads react-dom/client after a DOM exists. React DOM decides whether it can
// use the DOM when its module first evaluates, so the import has to happen
// after installDom() has put window and document on globalThis.
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { installDom } from './dom.js';

type ClientModule = typeof import('react-dom/client');

let clientModule: ClientModule | null = null;

export async function loadReactDomClient(): Promise<ClientModule> {
  if (clientModule) return clientModule;
  const hasDom = typeof (globalThis as { document?: unknown }).document !== 'undefined';
  const boot = hasDom ? null : installDom();
  clientModule = await import('react-dom/client');
  boot?.cleanup();
  return clientModule;
}

/**
 * Hydrates `element` into server-rendered `container` and collects every
 * hydration problem. React 19 reports text and structure mismatches through
 * onRecoverableError but attribute and class mismatches only through
 * console.error (leaving the server value in place), so both are captured.
 */
export async function hydrate(container: Element, element: ReactNode): Promise<{ root: Root; errors: string[] }> {
  const { hydrateRoot } = await loadReactDomClient();
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  let root!: Root;
  try {
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: (error) => { errors.push(String(error)); } }); });
  } finally {
    console.error = original;
  }
  return { root, errors };
}
