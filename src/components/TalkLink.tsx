'use client';

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { LinkPolicy, NavigationOptions } from '../component-types.js';
import type { LinkKind, Talk, TalkLink } from '../types.js';
import { safeUrl } from '../helpers.js';

const DEFAULT_POLICIES: Record<LinkKind, LinkPolicy> = {
  detail: {},
  event: { target: '_blank' },
  recording: { target: '_blank' },
  slides: { target: '_blank' },
  general: { target: '_blank' },
};

// HTML matches target keywords ASCII case-insensitively, so `_BLANK` is a new tab too.
const NEW_TAB = /^_blank$/i;
const SAME_WINDOW = /^_self$/i;

/** Resolves target/rel for a link kind. New-tab links always carry noopener unless the consumer's rel already protects. */
export function resolveLinkPolicy(kind: LinkKind, policies?: NavigationOptions['policies']): Required<Pick<LinkPolicy, 'rel'>> & LinkPolicy {
  const policy = { ...DEFAULT_POLICIES[kind], ...(policies?.[kind] ?? {}) };
  let rel = policy.rel ?? '';
  if (policy.target && NEW_TAB.test(policy.target)) {
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
  /** @deprecated Ignored: the href is always `link.url` after the `safeUrl` gate. */
  href?: string;
  /** @deprecated Ignored: set it per kind with `navigation.policies`. */
  target?: AnchorHTMLAttributes<HTMLAnchorElement>['target'];
  /** @deprecated Ignored: set it per kind with `navigation.policies`. */
  rel?: string;
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
  // Also gate plugin-returned links and direct use of this public component.
  const href = safeUrl(link.url, { allowRelative: link.kind === 'detail' });
  if (!href) return <span className={rest.className} data-wanderer-unsafe="true">{children}</span>;
  const policy = resolveLinkPolicy(link.kind, navigation.policies);
  const kinds = navigation.linkComponentKinds ?? ['detail'];
  const LinkComponent = navigation.LinkComponent;
  const useComponent = Boolean(LinkComponent) && kinds.includes(link.kind) && !(policy.target && NEW_TAB.test(policy.target));

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !navigation.onNavigate) return;
    if (isModifiedClick(event)) return;
    if (policy.target && !SAME_WINDOW.test(policy.target)) return;
    // A download is not a navigation; let the browser save the file.
    if (event.currentTarget?.hasAttribute('download')) return;
    event.preventDefault();
    navigation.onNavigate(link, talk, event);
  };

  const anchorProps = {
    ...rest,
    href,
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
