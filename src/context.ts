'use client';

import { createContext, useContext } from 'react';
import type { TalksContext } from './component-types.js';

export const TalksReactContext = createContext<TalksContext | null>(null);

/** Reads the instance context from custom views, renderers, actions, and slots. */
export function useTalks(): TalksContext {
  const value = useContext(TalksReactContext);
  if (!value) throw new Error('useTalks must be used inside <Talks>.');
  return value;
}
