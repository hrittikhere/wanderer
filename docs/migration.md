# Migrating from a site-specific talk shape

This guide moves data from a hand-rolled `Talk` interface, as found in many personal sites, to the portable schema. The source array stays untouched; a small adapter projects it into `Talk` from `@wanderer/talks/helpers`.

## Field mapping

| Legacy field | Portable field | Rule |
|---|---|---|
| `slug` | `id` | Must be unique and nonempty. Also drives `detailUrl`. |
| `title` | `title` | As is. |
| `event` | `event` | As is. |
| `date` (`DD/MM/YYYY`) | `date` (`YYYY-MM-DD`) | String rewrite, no `Date` parsing. See below. |
| `description` | `description` | As is. Required as a string; use `''` when missing. |
| `location` (string) | `location` | A string is accepted. `locationParts` splits `"City, Region, Country"` into city and country on the first and last comma. An object `{ city, country }` is also accepted. |
| `coordinates` (`[lat, lng]`) | `coordinates` | As is. Out-of-range or non-finite values are a validation error. |
| derived | `format` | `'in-person'`, `'online'` or `'hybrid'`. A common legacy convention is an "(online)" suffix in the event name. |
| `eventUrl` | `eventUrl` | Unless its host is a video host, in which case it becomes the recording. |
| `videoUrl`, `video` | `recordingUrl` | First one present. |
| `externalLink`, `link` | `recordingUrl` or `links[]` | Recording when the host is a known video host; otherwise `links[]` with `kind: 'general'`. |
| `slides` | `slidesUrl` | As is. |
| `abstract`, `content` | `detailUrl` | When either is present: `'/talks/<slug>'`. A relative path is allowed for `detail` only. |
| `tags` | `tags` | Strings only; non-strings are dropped. |
| `category`, `readTime`, `image`, `organizer`, `speakers`, `seoTitle`, `seoDescription` | not in the schema | Keep them in the site. Render them through a plugin renderer or keep the detail page site-owned. |

### Date conversion

Convert with a regular expression. Do not go through `new Date('DD/MM/YYYY')`, which parses as `MM/DD` or rolls impossible dates over.

```ts
// src/lib/adapt.ts
export function legacyTalkDateToIso(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
```

`parseCalendarDate` rejects `2025-02-30` and `2025-13-01` instead of normalizing them, so a bad source date surfaces as an `invalid_date` error.

### Detail URL rule

A detail page exists when the site renders one, which usually means long-form content (`abstract` or `content`) is present. Set `detailUrl` to the site-relative path. `detail` is the only kind that accepts relative paths, and it is first in the default primary link precedence, so the talk title links to the detail page when there is one and to the event page otherwise.

### Format rule

The schema requires `format`. Decide the rule once:

```ts
format: /\(online\)/i.test(talk.event) ? 'online' : 'in-person'
```

Mark hybrid events explicitly if your data knows them. Online talks are never placed on the globe, even with coordinates.

### Link classification

See [links.md](links.md) for the full adapter. The rules in short:

- `videoUrl` and `video` are recordings.
- Any other URL is a recording only when its hostname is `youtube.com`, `youtu.be`, `youtube-nocookie.com`, `vimeo.com` or a subdomain of one. Compare hostnames, not substrings.
- `eventUrl` keeps its meaning unless it points at a video host.
- Leftover URLs go into `links[]` as `general` (or `recording` when classified), with the legacy field name as the link `id`. Ambiguous links stay `general`; the library never infers a kind from a URL.

### Coordinates resolver

If the site keeps a city table instead of per-talk coordinates, do not bake it into the data. Pass a resolver:

```tsx
import { Talks } from '@wanderer/talks';
import { locationParts } from '@wanderer/talks/helpers';
import { CITY_COORDINATES } from './coordinates';

<Talks
  talks={talks}
  geography={{
    resolveCoordinates: (talk) => {
      const { city, country } = locationParts(talk.location);
      return city ? CITY_COORDINATES[`${city}, ${country ?? ''}`] ?? CITY_COORDINATES[city] : undefined;
    },
    mergeDistanceKm: 64,
    assignRegion: (talk, [lat, lng]) => (lng < -30 ? 'Americas' : lng < 60 ? 'Europe and Africa' : 'Asia Pacific'),
  }}
/>
```

The resolver is called only for talks without explicit `coordinates`, never for online talks. `assignRegion` is optional; without it no region summary is shown, only locations.

### Milestones

Globe callouts that used to be hardcoded in a globe component become data:

```ts
import type { Milestone } from '@wanderer/talks';

export const milestones: Milestone[] = [
  {
    id: 'first-keynote',
    title: 'First keynote',
    description: 'KubeCon India 2024',
    talkId: 'kubecon-india-2024-keynote',       // anchors at that talk's coordinates
    image: { src: '/images/keynote.jpg', alt: 'On stage at KubeCon India', width: 1200, height: 800 },
  },
  { id: 'hq', title: 'Home base', coordinates: [12.9716, 77.5946] },
];
```

Images render through `ImageComponent`, so pass `next/image` there. A milestone whose `talkId` is filtered out of the current result set has no coordinates and is hidden until the filter clears.

### Timezone and contact features belong in a site plugin

Features that depend on site data, such as the speaker's current timezone, an invitation email, or a "where am I now" card, are not part of the schema. Implement them as a plugin:

```tsx
import { definePlugin } from '@wanderer/talks/helpers';

export const sitePlugin = definePlugin({
  id: 'site',
  actions: [
    {
      id: 'invite',
      label: 'Invite me to speak',
      when: (talk) => talk.format !== 'online',
      getLink: () => ({ kind: 'general', url: 'mailto:hello@example.com?subject=Speaking%20invitation', label: 'Invite me to speak' }),
    },
  ],
  slots: {
    GlobeAside: ({ context }) => <p className="wanderer-globe__section-empty">Based in {context.locale === 'en-IN' ? 'Bengaluru' : 'India'}</p>,
  },
});
```

A card that should float over the globe itself, such as a "your area" contact card, goes in `slots.GlobeStageOverlay` instead; it renders in `.wanderer-globe__overlay` and you position it. Anything that reads the visitor's timezone or locale must do so in an effect, so the server HTML and the first client render match.

`mailto:` and `tel:` are safe schemes, so the action renders. Reserved action ids (`event`, `recording`, `slides`, `detail`, `general`) cannot be reused.

## Compatibility re-exports

Keep call sites stable while you migrate. Put the adapter in one module and re-export legacy names from it, implemented on top of the helpers:

```ts
// src/lib/talks-adapter.ts
import { formatCalendarDate, parseCalendarDate } from '@wanderer/talks/helpers';
import { legacyTalkDateToIso } from './adapt';

export { adaptTalk, adaptTalks, legacyTalkDateToIso } from './adapt';

/** Legacy name kept for existing imports. */
export function formatTalkDate(legacyDate: string): string {
  return formatCalendarDate(legacyTalkDateToIso(legacyDate), 'en-US');
}

/** Legacy name kept for existing imports. */
export function validLegacyTalkDate(value: string): Date | null {
  return parseCalendarDate(legacyTalkDateToIso(value));
}
```

Then replace the old implementations module by module. When every import points at the adapter, delete the legacy helpers and, finally, the re-exports.

## Checklist

1. Write `adaptTalk` and `adaptTalks` (strict validation, throw on errors).
2. Run `adaptTalks(TALKS)` in a script or test and fix every error. Review warnings; they usually mean a malformed URL in the source.
3. Replace the page's list and globe with `<Talks>` behind a client adapter. Pass `referenceDate` from the server.
4. Move site-only features (timezone, contact, SEO) into a plugin or keep them in the page.
5. Add `data-wanderer-scheme` to the host's inline theme script and pass `theme` explicitly after hydration.
6. Add the host scroll-lock CSS if you use the immersive globe.
