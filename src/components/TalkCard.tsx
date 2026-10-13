'use client';

import type { ReactNode } from 'react';
import type { TalkAction, TalkRendererProps } from '../component-types.js';
import { locationLabel, parseCalendarDate } from '../helpers.js';
import { Heading } from './Heading.js';
import { ArrowIcon, CalendarIcon, ExternalIcon, PinIcon, PlayIcon, SlidesIcon } from './icons.js';

function actionIcon(action: TalkAction): ReactNode {
  if (action.icon !== undefined) return action.icon;
  switch (action.kind) {
    case 'recording': return <PlayIcon className="wanderer-action__icon" />;
    case 'slides': return <SlidesIcon className="wanderer-action__icon" />;
    case 'detail': return <ArrowIcon className="wanderer-action__icon" />;
    case 'event':
    case 'general': return <ExternalIcon className="wanderer-action__icon" />;
    default: return null;
  }
}

/** The default talk renderer. Plugins can replace it per talk through a renderer contribution. */
export function TalkCard({ talk, context, upcoming }: TalkRendererProps) {
  const { copy, density, headingLevel } = context;
  const date = parseCalendarDate(talk.date);
  const monthLabel = date ? context.formatDate(talk.date, { month: 'short' }) : '';
  const fullDate = date ? context.formatDate(talk.date) : copy.undated;
  const primary = context.getPrimaryLink(talk);
  const actions = context.getActions(talk);
  const location = locationLabel(talk.location);
  const formatLabel = talk.format === 'online' ? copy.online : talk.format === 'hybrid' ? copy.hybrid : undefined;

  return (
    <article
      className="wanderer-talk"
      data-wanderer-upcoming={upcoming ? 'true' : undefined}
      data-wanderer-format={talk.format}
    >
      <div className="wanderer-talk__when" aria-hidden="true">
        {date ? <span>{monthLabel}</span> : <span>&ndash;</span>}
      </div>
      <div className="wanderer-talk__body">
        {upcoming && <span className="wanderer-badge wanderer-badge--accent">{copy.upcomingBadge}</span>}
        <Heading level={headingLevel + 2} className="wanderer-talk__title">
          {primary
            ? context.renderLink(primary, talk.title, talk, { className: 'wanderer-talk__title-link' })
            : talk.title}
        </Heading>
        <p className="wanderer-talk__event">{talk.event}</p>
        <p className="wanderer-talk__meta">
          <span className="wanderer-talk__meta-item">
            <CalendarIcon className="wanderer-talk__meta-icon" />
            {date ? <time dateTime={talk.date}>{fullDate}</time> : <span>{fullDate}</span>}
          </span>
          {location && (
            <span className="wanderer-talk__meta-item">
              <PinIcon className="wanderer-talk__meta-icon" />
              <span>{location}</span>
            </span>
          )}
          {formatLabel && <span className="wanderer-badge wanderer-badge--muted">{formatLabel}</span>}
        </p>
        {density === 'comfortable' && talk.description && (
          <p className="wanderer-talk__description">{talk.description}</p>
        )}
        {actions.length > 0 && (
          <ul className="wanderer-talk__actions">
            {actions.map((action) => (
              <li key={action.id}>
                {action.link ? (
                  context.renderLink(
                    action.link,
                    <>{actionIcon(action)}<span>{action.label}</span></>,
                    talk,
                    { className: 'wanderer-action', 'aria-label': copy.actionLabel(action.label, talk.title) },
                  )
                ) : (
                  <button
                    type="button"
                    className="wanderer-action"
                    onClick={action.onAction}
                    aria-label={copy.actionLabel(action.label, talk.title)}
                  >
                    {actionIcon(action)}<span>{action.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
