// Browser entry for the SSR test: hydrates the server markup with the same
// element and records every recoverable hydration error.
import { hydrateRoot } from 'react-dom/client';
import { ssrApp, type SsrConfig } from './app.js';

declare global {
  interface Window {
    wandererSsr: SsrConfig;
    wandererRecoverableErrors: string[];
  }
}

window.wandererRecoverableErrors = [];
hydrateRoot(document.getElementById('root')!, ssrApp(window.wandererSsr), {
  onRecoverableError: (error) => { window.wandererRecoverableErrors.push(String(error)); },
});
