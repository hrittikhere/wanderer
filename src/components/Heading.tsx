import { createElement, type HTMLAttributes, type ReactNode } from 'react';

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level: number;
  children?: ReactNode;
}

/** Renders h1 to h6; levels outside that range clamp. */
export function Heading({ level, children, ...rest }: HeadingProps) {
  const clamped = Math.min(6, Math.max(1, Math.round(level)));
  return createElement(`h${clamped}`, rest, children);
}
