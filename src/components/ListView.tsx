'use client';

import { useId, type ReactNode } from 'react';
import type { TalkViewProps, TalksContext, ViewContribution } from '../component-types.js';
import type { TalkGroup } from '../types.js';
import { Heading } from './Heading.js';
import { ListIcon } from './icons.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="wanderer-empty" role="status">
      {icon && <div className="wanderer-empty__icon" aria-hidden="true">{icon}</div>}
      <p className="wanderer-empty__title">{title}</p>
      {description && <p className="wanderer-empty__description">{description}</p>}
      {action && <div className="wanderer-empty__action">{action}</div>}
    </div>
  );
}

export function TalkGroupSection({ group, context }: { group: TalkGroup; context: TalksContext }) {
  // Unique per rendered section: the same group can render in both shells before hydration, or in two views.
  const id = `${useId()}-group-${group.id}`;
  const isUpcoming = group.id === 'upcoming';
  return (
    <section className="wanderer-group" data-wanderer-group={group.id} aria-labelledby={id}>
      <div className="wanderer-group__header">
        <Heading level={context.headingLevel + 1} id={id} className="wanderer-group__title">
          {isUpcoming && <span className="wanderer-group__dot" aria-hidden="true" />}
          {group.label}
        </Heading>
        <span className="wanderer-group__count">{context.copy.groupCount(group.talks.length)}</span>
      </div>
      <ul className={`wanderer-group__list${isUpcoming ? ' wanderer-group__list--cards' : ''}`}>
        {group.talks.map((talk) => (
          <li key={talk.id} className="wanderer-group__item">
            {context.renderTalk(talk, group)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The built-in list view: upcoming, year groups, undated, with empty and no-match states. */
export function ListView({ context }: TalkViewProps) {
  const { groups, copy, allTalks, talks } = context;
  if (allTalks.length === 0) {
    return <EmptyState title={copy.noTalks} description={copy.noTalksDescription} />;
  }
  if (talks.length === 0) {
    return (
      <EmptyState
        title={copy.noMatches}
        description={copy.noMatchesDescription}
        action={
          <button type="button" className="wanderer-button" onClick={context.resetAll}>
            {copy.resetAll}
          </button>
        }
      />
    );
  }
  return (
    <div className="wanderer-list">
      {groups.map((group) => (
        <TalkGroupSection key={group.id} group={group} context={context} />
      ))}
    </div>
  );
}

/** The list view contribution registered by default under the reserved id `list`. */
export function listView(options: { label?: string; heading?: string; order?: number } = {}): ViewContribution {
  return {
    id: 'list',
    order: options.order ?? 0,
    label: options.label ?? '',
    heading: options.heading,
    icon: <ListIcon className="wanderer-views__icon" />,
    Component: ListView,
  };
}
