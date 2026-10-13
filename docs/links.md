# Links

Talks carry typed links. A kind says what the link is; the URL never implies a kind.

## The link model

```ts
type LinkKind = 'event' | 'recording' | 'slides' | 'detail' | 'general';

interface TalkLink {
  id?: string;     // stable id for the action; defaults to `${kind}-${index}`
  kind: LinkKind;
  url: string;
  label?: string;  // action text; defaults to copy.<kind>Action
}

interface Talk {
  // ...
  eventUrl?: string;
  recordingUrl?: string;
  slidesUrl?: string;
  detailUrl?: string;
  links?: readonly TalkLink[];
}
```

The four dedicated fields are shortcuts for one link of each kind. `links[]` holds additional or unclassified links, including several of the same kind. Use `kind: 'general'` for a source you cannot classify; do not guess from the URL.

`getTalkLinks(talk)` from `@wanderer/talks/helpers` flattens everything into one ordered array:

1. `detailUrl` as `detail`
2. `recordingUrl` as `recording`
3. `slidesUrl` as `slides`
4. `eventUrl` as `event`
5. `links[]` in order

Entries with an unknown kind or an unsafe URL are dropped. Duplicates are removed by `kind + url`, so the same URL under two kinds is kept twice on purpose (an event page that is also a general link stays both).

## What the validator rejects or warns on

`safeUrl(value, { allowRelative })` is the single gate. It returns the URL unchanged or `undefined`.

Rejected (the link is dropped, the validator emits an `invalid_url` warning):

- Not a nonempty string.
- Contains whitespace, control characters (`U+0000` to `U+001F`, `U+007F`) or a backslash anywhere.
- A scheme other than `http:`, `https:`, `mailto:` or `tel:`. `javascript:`, `data:`, `file:`, `vbscript:` and everything else never render.
- `http`/`https` without a hostname or with embedded credentials (`user:pass@host`).
- `mailto:` or `tel:` with an empty path.
- A relative path on any kind except `detail`.

Accepted:

- Absolute `http` and `https` URLs.
- `mailto:` and `tel:` with a target.
- For `detail` only: relative paths starting with `/` (not `//`), `./`, `../`, `#` or `?`.

Links are validated again when read, so a talk built outside `validateTalks` still cannot render an unsafe `href`. Links returned by plugin actions through `getLink` are the plugin's responsibility; run them through `safeUrl` when they come from data.

## Primary link

The primary link is the talk title's destination. `getPrimaryLink(talk, precedence)` returns the first link whose kind appears earliest in the precedence list:

```ts
DEFAULT_PRIMARY_LINK_PRECEDENCE = ['detail', 'event', 'recording', 'slides', 'general'];
```

Override with `navigation.primaryLink`. A talk with no safe link renders its title as plain text. The primary link is also what `GlobeRegionList` uses for talk titles under a location.

## Actions

`context.getActions(talk)` returns the remaining links as actions, in `getTalkLinks` order, excluding the primary link (compared by identity, then by `kind + url`). Each action takes its label from `link.label` or from `copy.eventAction`, `copy.recordingAction`, `copy.slidesAction`, `copy.detailAction` or `copy.generalAction`, and an icon by kind. Plugin actions follow. The built-in card renders actions as a list of pill links or buttons with `aria-label` from `copy.actionLabel(label, title)`.

The `recording` filter and the `recordingOnly` option of `filterTalks` test for any link of kind `recording`, from either the dedicated field or `links[]`.

## Navigation

`navigation` on `<Talks>`:

```ts
interface NavigationOptions {
  LinkComponent?: ComponentType<LinkComponentProps>;
  linkComponentKinds?: readonly LinkKind[];   // default ['detail']
  onNavigate?: (link: TalkLink, talk: Talk | undefined, event: MouseEvent<HTMLAnchorElement>) => void;
  policies?: Partial<Record<LinkKind, LinkPolicy>>;
  primaryLink?: readonly LinkKind[];
}

interface LinkPolicy {
  target?: '_self' | '_blank' | (string & {});
  rel?: string;
}
```

### Anchors, LinkComponent, onNavigate

Every link in the library renders through `TalkLinkAnchor` (exported from the root and list entries). The resolution:

1. The policy for the link's kind is resolved (see below).
2. If `LinkComponent` is set, the kind is in `linkComponentKinds` and the resolved target is not `_blank`, the link renders as `<LinkComponent href target rel data-wanderer-link onClick ...>`. This is where `next/link` or a router link goes. New-tab links always stay plain anchors.
3. Otherwise a plain `<a>` renders with the same props.

`onClick` handling, in order: your own `onClick` from `renderLink` props runs first. Then, when `onNavigate` is set and the event is not default-prevented, the click is an unmodified primary click (button 0, no Meta, Ctrl, Shift or Alt), and the policy target is unset or `_self`, the default is prevented and `onNavigate(link, talk, event)` is called. Middle clicks, modifier clicks and new-tab links keep native behavior.

### Policies

Defaults:

| Kind | target | rel |
|---|---|---|
| `detail` | same window | none |
| `event` | `_blank` | `noopener noreferrer` |
| `recording` | `_blank` | `noopener noreferrer` |
| `slides` | `_blank` | `noopener noreferrer` |
| `general` | `_blank` | `noopener noreferrer` |

`resolveLinkPolicy(kind, policies)` merges your per-kind policy over the default and then applies the `_blank` rule:

- `target: '_blank'` with no `rel` given: `rel="noopener noreferrer"`.
- `target: '_blank'` with a `rel` that lacks both `noopener` and `noreferrer`: `noopener` is appended to your tokens.
- `target: '_blank'` with a `rel` containing either: your `rel` is used unchanged.
- Any other target: your `rel` is used as given, or omitted.

Examples:

```tsx
<Talks
  talks={talks}
  navigation={{
    policies: {
      recording: { target: '_self' },                       // play in the same tab
      event: { target: '_blank', rel: 'noopener' },         // no noreferrer
      detail: { target: '_blank' },                         // detail pages in a new tab; LinkComponent is then skipped for detail
    },
    linkComponentKinds: ['detail', 'general'],
    primaryLink: ['recording', 'detail', 'event', 'slides', 'general'],
  }}
/>
```

Every anchor carries `data-wanderer-link="<kind>"` for styling and analytics.

## Classifying legacy data

Suppose the old shape looks like this:

```ts
interface LegacyTalk {
  slug: string;
  title: string;
  date: string;          // DD/MM/YYYY
  event: string;
  description: string;
  location?: string;
  coordinates?: [number, number];
  externalLink?: string; // "recording or event URL (preferred)"
  link?: string;         // "recording or event URL (fallback)"
  video?: string;
  videoUrl?: string;
  slides?: string;
  eventUrl?: string;
  abstract?: string;
  content?: string;
  tags?: string[];
}
```

The migration rules:

- `videoUrl` and `video` are recordings by declaration.
- `eventUrl`, `externalLink` and `link` are recordings only when their host is a known video host (`youtube.com`, `youtu.be`, `youtube-nocookie.com`, `vimeo.com`, or a subdomain of one). Compare hostnames, not substrings: `youtube.com.example.org` is not YouTube.
- `eventUrl` stays `eventUrl` unless it is a recording host.
- `slides` becomes `slidesUrl`.
- A detail page exists when `abstract` or `content` is present: `detailUrl: '/talks/<slug>'`.
- Everything left over goes into `links[]`. A leftover that was classified as a recording gets `kind: 'recording'`; anything else is `general` because a generic "externalLink" carries no reliable semantics. The legacy field name becomes the link `id`.
- URLs already placed in a dedicated field are not repeated in `links[]`.

```ts
import { validateTalks, type Talk, type TalkLink } from '@wanderer/talks/helpers';

function isRecordingHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com']
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function toIsoDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

export function adaptTalk(talk: LegacyTalk): Talk {
  const recordings = [talk.videoUrl, talk.video, talk.eventUrl, talk.externalLink, talk.link]
    .filter((url): url is string => Boolean(url))
    .filter((url) => url === talk.videoUrl || url === talk.video || isRecordingHost(url));
  const recordingUrl = recordings[0];
  const eventUrl = talk.eventUrl && !isRecordingHost(talk.eventUrl) ? talk.eventUrl : undefined;

  const links: TalkLink[] = [];
  const classified = new Set([eventUrl, recordingUrl, talk.slides].filter(Boolean));
  for (const [field, url] of [
    ['videoUrl', talk.videoUrl], ['video', talk.video],
    ['externalLink', talk.externalLink], ['link', talk.link], ['eventUrl', talk.eventUrl],
  ] as const) {
    if (!url || classified.has(url)) continue;
    links.push({ id: field, kind: recordings.includes(url) ? 'recording' : 'general', url });
    classified.add(url);
  }

  return {
    id: talk.slug,
    title: talk.title,
    event: talk.event,
    date: toIsoDate(talk.date),
    description: talk.description,
    location: talk.location,
    coordinates: talk.coordinates,
    format: /\(online\)/i.test(talk.event) ? 'online' : 'in-person',
    eventUrl,
    recordingUrl,
    slidesUrl: talk.slides,
    detailUrl: talk.abstract || talk.content ? `/talks/${talk.slug}` : undefined,
    links,
    tags: talk.tags,
  };
}

export function adaptTalks(talks: readonly LegacyTalk[]): Talk[] {
  const result = validateTalks(talks.map(adaptTalk), { mode: 'strict' });
  if (!result.valid) throw new Error(JSON.stringify(result.errors));
  return result.talks;
}
```

Worked example:

```ts
const legacy: LegacyTalk = {
  slug: 'kubecon-eu-2025-tenant-isolation',
  title: 'Tenant isolation without the hypervisor',
  date: '02/04/2025',
  event: 'KubeCon + CloudNativeCon Europe 2025',
  description: '...',
  location: 'London, United Kingdom',
  externalLink: 'https://www.youtube.com/watch?v=abc123',
  link: 'https://sched.example.com/event/xyz',
  eventUrl: 'https://events.example.com/kubecon-eu-2025',
  slides: 'https://speakerdeck.example.com/tenant-isolation',
  abstract: 'Long abstract',
};

adaptTalk(legacy);
// {
//   id: 'kubecon-eu-2025-tenant-isolation',
//   date: '2025-04-02',
//   format: 'in-person',
//   eventUrl: 'https://events.example.com/kubecon-eu-2025',
//   recordingUrl: 'https://www.youtube.com/watch?v=abc123',   // externalLink, YouTube host
//   slidesUrl: 'https://speakerdeck.example.com/tenant-isolation',
//   detailUrl: '/talks/kubecon-eu-2025-tenant-isolation',       // abstract present
//   links: [{ id: 'link', kind: 'general', url: 'https://sched.example.com/event/xyz' }], // ambiguous host stays general
//   ...
// }
```

The title links to `/talks/kubecon-eu-2025-tenant-isolation` (detail first in precedence). Actions render as Watch recording, Slides, Event page and Link, in `getTalkLinks` order. See [migration.md](migration.md) for the rest of the field mapping.
