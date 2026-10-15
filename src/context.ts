'use client';

import { createContext, useContext, type Context } from 'react';
import type { TalksContext } from './component-types.js';

// The package ships ESM and CommonJS copies. A process that loads both (an app
// importing the ESM build while a CommonJS plugin requires the other) would
// otherwise get two unrelated contexts, and `useTalks` in one copy could never
// see a `<Talks>` from the other. Both copies share one context per React
// instance through a global registry, the way react-redux avoids the same hazard.
const REGISTRY_KEY = Symbol.for('@wanderer/talks/context');
type Registry = Map<typeof createContext, Context<TalksContext | null>>;
const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
const registry: Registry = host[REGISTRY_KEY] ?? (host[REGISTRY_KEY] = new Map());

function sharedContext(): Context<TalksContext | null> {
  let context = registry.get(createContext);
  if (!context) {
    context = createContext<TalksContext | null>(null);
    context.displayName = 'WandererTalks';
    registry.set(createContext, context);
  }
  return context;
}

export const TalksReactContext = sharedContext();

/** Reads the instance context from custom views, renderers, actions, and slots. */
export function useTalks(): TalksContext {
  const value = useContext(TalksReactContext);
  if (!value) throw new Error('useTalks must be used inside <Talks>.');
  return value;
}
