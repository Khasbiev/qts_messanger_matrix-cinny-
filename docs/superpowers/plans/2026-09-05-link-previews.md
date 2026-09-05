# Link Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `http(s)://` URL typed into a message becomes, once sent, clickable text for every link found plus a Telegram/Discord-style preview card (site name, title, description, image) below the text for the first link only, per `docs/superpowers/specs/2026-09-05-link-previews-design.md`.

**Architecture:** Task 1 adds `lib/linkify.js` (`findUrlSpans`) and merges it into `MessageBubble.jsx`'s text renderer alongside the existing mention-highlight logic, so every detected URL becomes clickable — this needs no server support and is independently testable. Task 2 adds the preview card: a `getLinkPreview` wrapper around `matrix-js-sdk`'s `client.getUrlPreview()`, a new `LinkPreview.jsx` component (reusing a newly-extracted `useResolvedMedia` hook to resolve the `og:image` `mxc://` URL), wiring it into `MessageBubble.jsx` for the first URL found, and fixing the local Synapse test harness to actually enable link previews (it currently doesn't, unlike production) so the task can be verified at all.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings (this feature introduces no new user-facing copy, but any added later must follow this).
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- Only the first URL in a message gets a preview card; every URL (including the first) becomes clickable text regardless.
- A preview card must render nothing (not an error, not an empty box) when the fetch fails or returns no usable OpenGraph data — silent graceful degradation, matching this codebase's established convention (e.g. search's message-search failure handling).
- No live preview while composing, no multi-card messages, no rich embeds beyond an image+text card, no editing/dismissing a sent message's card — all explicitly out of scope.

---

### Task 1: Clickable links in message text

**Files:**
- Create: `client/src/lib/linkify.js`
- Modify: `client/src/components/Chat/MessageBubble.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`lib/linkify.js`): `findUrlSpans(text): Array<{ start, end, url }>`, position-sorted, each `url` trimmed of common trailing punctuation.
- Produces (`MessageBubble.jsx`): the local `renderWithMentions(text, mentions)` helper is replaced by `renderMessageText(text, mentions, urlSpans)`, and the component body computes `const urlSpans = text ? findUrlSpans(text) : []` before the `return`. Task 2 consumes `urlSpans` (specifically `urlSpans[0]`) — do not rename these without also updating Task 2's expectations.

- [ ] **Step 1: Create `lib/linkify.js`**

Create `client/src/lib/linkify.js`:

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

- [ ] **Step 2: Import `findUrlSpans` in `MessageBubble.jsx`**

Find:

```jsx
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import { findMentionSpans } from '../../lib/mentions'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

Replace with:

```jsx
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import { findMentionSpans } from '../../lib/mentions'
import { findUrlSpans } from '../../lib/linkify'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

- [ ] **Step 3: Replace `renderWithMentions` with a combined mention+link renderer**

Find:

```jsx
function renderWithMentions(text, mentions) {
  if (!mentions?.length) return text
  const spans = findMentionSpans(text, mentions)
  if (spans.length === 0) return text
  const nodes = []
  let cursor = 0
  spans.forEach((span, i) => {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    nodes.push(
      <span key={i} style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
        {text.slice(span.start, span.end)}
      </span>
    )
    cursor = span.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
```

Replace with:

```jsx
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

- [ ] **Step 4: Compute `urlSpans` and use the new renderer**

Find:

```jsx
  const { isOwn, sender, avatar, time, text, file, image, voice, roundVideo, reactions, readBy } = message
```

Replace with:

```jsx
  const { isOwn, sender, avatar, time, text, file, image, voice, roundVideo, reactions, readBy } = message
  const urlSpans = text ? findUrlSpans(text) : []
```

Find:

```jsx
          {text && (
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: '1.5', margin: 0 }}>
              {renderWithMentions(text, message.mentions)}
            </p>
          )}
```

Replace with:

```jsx
          {text && (
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: '1.5', margin: 0 }}>
              {renderMessageText(text, message.mentions, urlSpans)}
            </p>
          )}
```

- [ ] **Step 5: Manual verification**

Setup: `scripts/dev/local-test-synapse.sh start` (reuse if already running —
check `docker ps`), `cd client && npm run dev`, log in as `tester1` in a
room shared with `tester2`.

1. Send a message like `Смотри https://example.com/page тут` — confirm
   the URL renders as clickable underlined teal text (`var(--accent-teal)`)
   and the surrounding plain text is unaffected.
2. Click the link — confirm it opens `https://example.com/page` in a new
   browser tab (not the same tab, not navigating away from the app).
3. Send a message ending a sentence with a URL, e.g.
   `Ссылка: https://example.com/page.` — confirm the trailing period is
   NOT part of the clickable link (the link text should end at `page`, the
   period renders as plain text right after it).
4. Send a message with two URLs — confirm both are independently
   clickable.
5. Send a message combining an `@mention` (of a joined member's exact
   display name) and a URL, e.g. `@tester2 смотри https://example.com` —
   confirm the mention still renders with its orange highlight AND the URL
   still renders as a clickable teal link, with no visual or functional
   interference between the two.
6. Send a plain message with no URL — confirm no regression (renders
   exactly as before this change).
7. Confirm no console errors throughout.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/linkify.js client/src/components/Chat/MessageBubble.jsx
git commit -m "Make URLs in message text clickable"
```

---

### Task 2: Preview card for the first link

**Files:**
- Create: `client/src/lib/useResolvedMedia.js`
- Create: `client/src/components/Chat/LinkPreview.jsx`
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/components/Chat/MessageBubble.jsx`
- Modify: `scripts/dev/local-test-synapse.sh`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: Task 1's `urlSpans` computed in `MessageBubble.jsx` (specifically `urlSpans[0]?.url`).
- Produces (`lib/useResolvedMedia.js`): default export `useResolvedMedia(mxcUrl): string | null` (an object-URL string once resolved, or `null` while loading / if `mxcUrl` is falsy).
- Produces (`lib/matrix.js`): `getLinkPreview(url): Promise<object>` — the raw OpenGraph-ish object from `client.getUrlPreview()`.
- Produces (`LinkPreview.jsx`): default export `LinkPreview({ url })` — a self-contained component that renders `null` when there's nothing worth showing.

- [ ] **Step 1: Extract `useResolvedMedia` into its own module**

Create `client/src/lib/useResolvedMedia.js`:

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

In `client/src/components/Chat/MessageBubble.jsx`, find:

```jsx
import { useState, useEffect, useRef } from 'react'
import { IconDownload, IconLoader2, IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react'
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import { findMentionSpans } from '../../lib/mentions'
import { findUrlSpans } from '../../lib/linkify'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

Replace with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { IconDownload, IconLoader2, IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react'
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import { findMentionSpans } from '../../lib/mentions'
import { findUrlSpans } from '../../lib/linkify'
import useResolvedMedia from '../../lib/useResolvedMedia'
import LinkPreview from './LinkPreview'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

(`resolveMediaUrl` stays imported here — `DownloadButton`, later in this
same file, calls it directly and is untouched by this task. Only the
locally-defined hook is being replaced by the imported one.)

Find:

```jsx
function useResolvedMedia(mxcUrl) {
  const [blobUrl, setBlobUrl] = useState(null)
  useEffect(() => {
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

Delete this whole block — the hook now lives in `lib/useResolvedMedia.js`
and is imported instead (the import added above already covers every
call site in this file: `MediaImage`, `VoicePlayer`, `RoundVideoPlayer`,
and, after Step 4 below, `LinkPreview` — none of those call sites need to
change, since the imported hook has the same name and signature as the
one being deleted).

- [ ] **Step 2: Add `getLinkPreview` to `lib/matrix.js`**

Append near `resolveMediaUrl` (find):

```js
export async function resolveMediaUrl(mxcUrl) {
  if (!_client) throw new Error('Not connected')
  const httpUrl = _client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, false, false, true)
  if (!httpUrl) throw new Error('Invalid media URL')
  const resp = await fetch(httpUrl, {
    headers: { Authorization: `Bearer ${_client.getAccessToken()}` },
  })
  if (!resp.ok) throw new Error('Не удалось загрузить медиафайл')
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}
```

Insert immediately after it:

```js

export async function getLinkPreview(url) {
  if (!_client) throw new Error('Not connected')
  return _client.getUrlPreview(url, Date.now())
}
```

- [ ] **Step 3: Create `Chat/LinkPreview.jsx`**

Create `client/src/components/Chat/LinkPreview.jsx`:

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

- [ ] **Step 4: Render the card in `MessageBubble.jsx`**

Find:

```jsx
          {text && (
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: '1.5', margin: 0 }}>
              {renderMessageText(text, message.mentions, urlSpans)}
            </p>
          )}

          {image && (
```

Replace with:

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

          {image && (
```

- [ ] **Step 5: Fix the local Synapse test harness to enable link previews**

In `scripts/dev/local-test-synapse.sh`, find:

```bash
      echo >> "$DATA_DIR/homeserver.yaml"   # generated file has no trailing newline
      cat >> "$DATA_DIR/homeserver.yaml" <<'YAML'
enable_registration: true
enable_registration_without_verification: true
user_directory:
  search_all_users: true
YAML
```

Replace with:

```bash
      echo >> "$DATA_DIR/homeserver.yaml"   # generated file has no trailing newline
      cat >> "$DATA_DIR/homeserver.yaml" <<'YAML'
enable_registration: true
enable_registration_without_verification: true
user_directory:
  search_all_users: true
url_preview_enabled: true
url_preview_ip_range_blacklist:
  - "127.0.0.0/8"
  - "10.0.0.0/8"
  - "172.16.0.0/12"
  - "192.168.0.0/16"
  - "100.64.0.0/10"
  - "::1/128"
  - "fe80::/10"
YAML
```

This block only runs the first time (`if [ ! -f "$DATA_DIR/homeserver.yaml" ]`
in the script) — if a `.local-test-synapse/data/homeserver.yaml` already
exists from a previous run, it won't pick up this change automatically.

- [ ] **Step 6: Manual verification**

If `.local-test-synapse/data/homeserver.yaml` already exists from before
this change, regenerate it so the new config takes effect:
`bash scripts/dev/local-test-synapse.sh reset` (wipes local test data —
this is the disposable local harness, never production) then
`bash scripts/dev/local-test-synapse.sh start` and
`bash scripts/dev/local-test-synapse.sh seed` to recreate `tester1`/
`tester2`. Otherwise just `start` if it doesn't exist yet — the new block
will be included on first generation. Then `cd client && npm run dev`,
log in as `tester1` in a room shared with `tester2`.

1. Send a message with a URL that has rich Open Graph metadata (e.g.
   `https://github.com/matrix-org/matrix-js-sdk` or
   `https://en.wikipedia.org/wiki/Matrix_(protocol)`) — confirm a preview
   card appears below the message text with an image, title, description,
   and site name, for both the sender's own view and `tester2`'s view of
   the same message.
2. Click the card itself (not the inline text link) — confirm it opens
   the URL in a new tab.
3. Send a message with two URLs, one of them the rich-metadata one from
   step 1 listed first — confirm only one card appears (for the first
   URL), while both URLs are still clickable text (per Task 1).
4. Send a message with a URL that has no useful Open Graph data (e.g. a
   bare IP-blacklisted address, or a URL to a plain-text file) — confirm
   no card appears at all (no error box, no empty placeholder) and no
   console errors.
5. Forward a message containing a link (per the existing forward feature)
   to another chat — confirm the preview card still renders correctly in
   the destination chat.
6. Confirm no console errors throughout, and confirm the app's other
   media features (image upload/display, voice messages, video notes,
   file download) still work — this task refactored the shared
   `useResolvedMedia` hook they all depend on.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/useResolvedMedia.js client/src/lib/matrix.js client/src/components/Chat/LinkPreview.jsx client/src/components/Chat/MessageBubble.jsx scripts/dev/local-test-synapse.sh
git commit -m "Add link preview cards for the first URL in a message"
```
