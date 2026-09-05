# Link Previews

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. Message
text currently renders as either a plain string or, since the @mentions
feature, an array of React nodes built by `MessageBubble.jsx`'s
`renderWithMentions()` (plain text segments interleaved with orange
`<span>`s for mention highlights) — no URL is ever clickable today.

`matrix-js-sdk` already exposes `client.getUrlPreview(url, ts)`, which
calls the homeserver's `/preview_url` endpoint and returns an object of
OpenGraph-ish keys (`og:title`, `og:description`, `og:image`,
`og:site_name`, etc. — "may return synthesized attributes if the URL
lacked OG meta"). It buckets `ts` to the nearest minute and caches results
per `(url, ts-bucket)` internally, so repeated calls for the same link
don't hammer the server. `og:image`, when present, is an `mxc://` URL —
resolved the same way every other piece of media in this app already is:
`resolveMediaUrl()` in `lib/matrix.js` fetches it with a `Bearer` auth
header and returns an object URL. `MessageBubble.jsx`'s existing
`useResolvedMedia(mxcUrl)` hook is exactly that resolve-and-revoke dance,
currently private to that file and used by `MediaImage`/`VoicePlayer`/
`RoundVideoPlayer`.

Server-side, `synapse/homeserver.yaml.template` (production) already has
`url_preview_enabled: true` plus an SSRF-protective
`url_preview_ip_range_blacklist`. The disposable local test harness
(`scripts/dev/local-test-synapse.sh`) generates its own `homeserver.yaml`
via `docker run ... generate` and appends a small hand-written block
(`enable_registration`, `user_directory`) — it does **not** enable url
previews at all, so link previews cannot be exercised against the local
harness without fixing this first.

## Goal

A `http(s)://` URL typed into a message becomes, once sent: clickable
text (opens in a new tab) for every URL found, plus a Telegram/Discord-
style preview card — site name, title, description, and image — rendered
below the message text for the *first* URL only.

## Scope for this iteration

In scope:
1. Detecting URL(s) in a message's rendered text via a plain regex (no
   external linkify library).
2. Making every detected URL's text clickable (`target="_blank"`,
   `rel="noopener noreferrer"`), composed correctly alongside the existing
   mention-highlight rendering (a link and a mention never overlap in
   practice, but the merge logic must not break if they did).
3. A preview card for the first URL only, fetched per-viewer at render
   time via `client.getUrlPreview()` — not generated once at send time and
   not shown live while composing.
4. Graceful, silent degradation: if the homeserver rejects/fails the
   preview request, or returns no usable OG data (no title, no
   description, no image), no card is rendered — no error text, no empty
   box.
5. Fixing the local test harness to enable url previews (matching
   production's `url_preview_enabled` + `url_preview_ip_range_blacklist`),
   since this is the only way to manually verify the feature at all.

Explicitly out of scope:
- Live preview while typing in the composer.
- A card per link when a message has multiple URLs (only the first gets a
  card; the rest are still just clickable text).
- Rich embeds beyond an OG image + text card (no inline video players,
  no oEmbed).
- Editing or dismissing a message's preview card after the fact.
- Persisting/sharing preview data across viewers via the event itself —
  each client fetches its own, relying on the SDK's and homeserver's
  existing caching.

## Design

### 1. `lib/linkify.js` — new, dependency-free module

Mirrors the shape of `lib/mentions.js`'s `findMentionSpans`, for the same
reason: both the inline-clickable-text rendering and "which URL gets the
preview card" need the identical definition of "what counts as a link."

```js
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g
const TRAILING_PUNCTUATION = /[).,;:!?\]]+$/

export function findUrlSpans(text) {
  const spans = []
  let match
  URL_PATTERN.lastIndex = 0
  while ((match = URL_PATTERN.exec(text))) {
    let url = match[0]
    let end = match.index + url.length
    const trimMatch = url.match(TRAILING_PUNCTUATION)
    if (trimMatch) {
      url = url.slice(0, url.length - trimMatch[0].length)
      end -= trimMatch[0].length
    }
    if (url.length === 0) continue
    spans.push({ start: match.index, end, url })
  }
  return spans
}
```

The trailing-punctuation trim keeps a URL at the end of a sentence (e.g.
`"see https://example.com."`) from swallowing the period into the link.
This is a heuristic, not a full URL grammar — acceptable for this app's
scale, matching the existing regex-based, non-library approach already
used for mentions.

### 2. `lib/useResolvedMedia.js` — extracted shared hook

`MessageBubble.jsx`'s `useResolvedMedia` hook is moved, unchanged in
behavior, into its own module so the new `LinkPreview` component (in a
different file) can reuse it instead of duplicating the resolve/revoke
logic. One behavior addition: guard against a `null`/falsy `mxcUrl` (the
common case for a link preview with no `og:image`) by skipping the fetch
entirely rather than letting `resolveMediaUrl(null)` reject on every
render.

```js
import { useState, useEffect } from 'react'
import { resolveMediaUrl } from './matrix'

export default function useResolvedMedia(mxcUrl) {
  const [blobUrl, setBlobUrl] = useState(null)
  useEffect(() => {
    if (!mxcUrl) { setBlobUrl(null); return }
    let cancelled = false
    let url = null
    resolveMediaUrl(mxcUrl).then(resolved => {
      if (cancelled) { URL.revokeObjectURL(resolved); return }
      url = resolved
      setBlobUrl(resolved)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [mxcUrl])
  return blobUrl
}
```

`MessageBubble.jsx` drops its local definition and imports this instead;
`MediaImage`/`VoicePlayer`/`RoundVideoPlayer` are otherwise untouched
(they always pass a real, non-null `mxcUrl`, so the new guard is a no-op
for them).

### 3. `lib/matrix.js` addition

```js
export async function getLinkPreview(url) {
  if (!_client) throw new Error('Not connected')
  return _client.getUrlPreview(url, Date.now())
}
```

### 4. `Chat/LinkPreview.jsx` — new component

Props: `{ url }`. Fetches on mount / whenever `url` changes; renders
nothing while loading and nothing if the fetch fails or the response has
no title, description, or image at all (no spinner, no placeholder box —
a message with a dead/unpreviewable link should look exactly like a
message with no link).

```jsx
import { useState, useEffect } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import { getLinkPreview } from '../../lib/matrix'
import useResolvedMedia from '../../lib/useResolvedMedia'

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export default function LinkPreview({ url }) {
  const [preview, setPreview] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setPreview(null)
    getLinkPreview(url).then(data => {
      if (!cancelled) { setPreview(data); setLoaded(true) }
    }).catch(() => {
      if (!cancelled) { setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [url])

  const title = preview?.['og:title']
  const description = preview?.['og:description']
  const imageMxc = preview?.['og:image']
  const blobUrl = useResolvedMedia(imageMxc)

  if (!loaded || (!title && !description && !imageMxc)) return null

  const siteName = preview['og:site_name'] || hostnameOf(url)

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', gap: '10px', textDecoration: 'none',
        border: '1px solid var(--border)', borderRadius: '10px',
        padding: '8px', background: 'rgba(255,255,255,0.02)',
      }}
    >
      {imageMxc && (
        <div style={{ width: '64px', height: '64px', flexShrink: 0, borderRadius: '6px', overflow: 'hidden', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {blobUrl
            ? <img src={blobUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <IconLoader2 size={16} className="spin" color="var(--text-muted)" />}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{siteName}</div>
        {title && (
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
        )}
        {description && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {description}
          </div>
        )}
      </div>
    </a>
  )
}
```

The whole card is itself an `<a>` to the URL (clicking anywhere on the
card opens it), which is the standard Telegram/Discord affordance and
needs no separate click handler.

### 5. `MessageBubble.jsx` changes

Replace the mention-only `renderWithMentions` with a combined renderer
that also linkifies, and render `LinkPreview` for the first URL, right
after the text paragraph (same `paddingTop: text ? '8px' : '0'` pattern
already used for image/voice/file):

```js
import { findUrlSpans } from '../../lib/linkify'
import LinkPreview from './LinkPreview'
import useResolvedMedia from '../../lib/useResolvedMedia'
// (drop the local useResolvedMedia definition, drop its old import line)

function renderMessageText(text, mentions, urlSpans) {
  const mentionSpans = mentions?.length ? findMentionSpans(text, mentions) : []
  const linkSpans = urlSpans.filter(u => !mentionSpans.some(m => u.start < m.end && u.end > m.start))
  const spans = [...mentionSpans, ...linkSpans].sort((a, b) => a.start - b.start)
  if (spans.length === 0) return text
  const nodes = []
  let cursor = 0
  spans.forEach((span, i) => {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    if (span.url) {
      nodes.push(
        <a
          key={i}
          href={span.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ color: 'var(--accent-teal)', textDecoration: 'underline' }}
        >
          {text.slice(span.start, span.end)}
        </a>
      )
    } else {
      nodes.push(
        <span key={i} style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
          {text.slice(span.start, span.end)}
        </span>
      )
    }
    cursor = span.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
```

In the component body, compute once (`text` is already destructured from
`message`):

```js
const urlSpans = text ? findUrlSpans(text) : []
```

The text paragraph becomes:

```jsx
{text && (
  <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: '1.5', margin: 0 }}>
    {renderMessageText(text, message.mentions, urlSpans)}
  </p>
)}

{urlSpans[0] && (
  <div style={{ paddingTop: text ? '8px' : '0' }}>
    <LinkPreview url={urlSpans[0].url} />
  </div>
)}
```

Placed in the same position/order as the existing `image`/`voice`/
`roundVideo`/`file` blocks (right after them, since a message is
text-or-media per `extractMessages()`, a link preview and a media
attachment never co-occur in practice — but the ordering is harmless
either way since only one of `text`/`image`/`voice`/`roundVideo`/`file`
is ever populated on a given message).

### 6. `scripts/dev/local-test-synapse.sh` fix

The generated-config heredoc gains the same two settings production
already has, so link previews are testable at all against the local
harness:

```yaml
url_preview_enabled: true
url_preview_ip_range_blacklist:
  - "127.0.0.0/8"
  - "10.0.0.0/8"
  - "172.16.0.0/12"
  - "192.168.0.0/16"
  - "100.64.0.0/10"
  - "::1/128"
  - "fe80::/10"
```

## Error handling

- `getLinkPreview` rejecting (network error, homeserver 403 because the
  target IP is blacklisted, timeout, malformed response) is caught in
  `LinkPreview` and results in rendering nothing — never a visible error.
- A response with no `og:title`/`og:description`/`og:image` at all (some
  URLs just don't have any Open Graph metadata) also renders nothing.
- A resolvable `og:image` that fails to load (bad mxc, deleted media) just
  shows the spinner state indefinitely inside the small image box rather
  than breaking the card — the title/description still render normally
  since they don't depend on the image.

## Testing

No automated test framework exists in `client/`. Manual verification with
two logged-in test users, after fixing the local harness (Design §6):
send a message containing a well-known URL with rich OG tags (e.g. a
GitHub repo or Wikipedia article link) and confirm the card appears with
image/title/description/site name for both sender and recipient; confirm
the link text itself is clickable and opens in a new tab; send a message
with two URLs and confirm only the first gets a card while both are
clickable text; send a URL with no OG metadata (or one the homeserver
can't fetch) and confirm no card and no error appears; send a message
combining an `@mention` and a URL and confirm both render correctly
without one clobbering the other; confirm a forwarded message containing
a link still shows its preview; confirm no console errors throughout.
