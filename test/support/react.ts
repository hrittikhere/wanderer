// Loads react-dom/client after a DOM exists. React DOM decides whether it can
// use the DOM when its module first evaluates, so the import has to happen
// after installDom() has put window and document on globalThis.
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
