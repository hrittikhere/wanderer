'use client';

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { LinkPolicy, NavigationOptions } from '../component-types.js';
import type { LinkKind, Talk, TalkLink } from '../types.js';

const DEFAULT_POLICIES: Record<LinkKind, LinkPolicy> = {
  detail: {},
  event: { target: '_blank' },
  recording: { target: '_blank' },
  slides: { target: '_blank' },
  general: { target: '_blank' },
};

/** Resolves target/rel for a link kind. New-tab links always carry noopener unless the consumer's rel already protects. */
export function resolveLinkPolicy(kind: LinkKind, policies?: NavigationOptions['policies']): Required<Pick<LinkPolicy, 'rel'>> & LinkPolicy {
  const policy = { ...DEFAULT_POLICIES[kind], ...(policies?.[kind] ?? {}) };
  let rel = policy.rel ?? '';
  if (policy.target === '_blank') {
    const tokens = new Set(rel.split(/\s+/).filter(Boolean));
    if (!tokens.has('noopener') && !tokens.has('noreferrer')) tokens.add('noopener');
    if (policy.rel === undefined) tokens.add('noreferrer');
    rel = [...tokens].join(' ');
  }
  return { ...policy, rel };
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export interface TalkLinkAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  link: TalkLink;
  talk?: Talk;
  navigation: NavigationOptions;
  children?: ReactNode;
}

/**
 * Renders a typed link through the navigation options: the consumer's link
 * component for configured kinds, otherwise a plain anchor. `onNavigate`
 * only intercepts unmodified primary clicks on same-window links, so
 * middle-click, modifier-click, and new-tab policies keep native behavior.
 */
export function TalkLinkAnchor({ link, talk, navigation, children, onClick, ...rest }: TalkLinkAnchorProps) {
  const policy = resolveLinkPolicy(link.kind, navigation.policies);
  const kinds = navigation.linkComponentKinds ?? ['detail'];
  const LinkComponent = navigation.LinkComponent;
  const useComponent = Boolean(LinkComponent) && kinds.includes(link.kind) && policy.target !== '_blank';

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !navigation.onNavigate) return;
    if (isModifiedClick(event)) return;
    if (policy.target && policy.target !== '_self') return;
    event.preventDefault();
    navigation.onNavigate(link, talk, event);
  };

  const anchorProps = {
    ...rest,
    href: link.url,
    target: policy.target,
    rel: policy.rel || undefined,
    'data-wanderer-link': link.kind,
    onClick: handleClick,
  };

  if (useComponent && LinkComponent) {
    return <LinkComponent {...anchorProps}>{children}</LinkComponent>;
  }
  return <a {...anchorProps}>{children}</a>;
}
