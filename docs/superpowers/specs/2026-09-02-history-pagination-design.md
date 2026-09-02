# History Pagination — Scroll-Up to Load Older Messages

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk` (see
`2026-09-01-custom-messenger-frontend-mvp-design.md` and
`2026-09-02-message-actions-design.md`). `lib/matrix.js`'s `startSync()`
calls `client.startClient({ initialSyncLimit: 30 })`, so a room only ever
has its most recent ~30 events loaded — there is no way to see anything
older. This was identified as the next-highest-priority gap after message
actions (reply/edit/delete/reactions, shipped) in the same review that
originally listed it, alongside typing indicators/read receipts (tracked
separately, partially addressed already by an unrelated bug fix that wired
up `sendReadReceipt` for the unread badge — full typing indicators and
"read by" checkmarks remain a separate future spec).

`MessageList.jsx`'s architecture already fits pagination well: `extractMessages()`
re-reads the room's entire live timeline from scratch on every relevant
event, so once older events are prepended to that timeline (by whatever
mechanism loads them), the existing recompute pipeline picks them up with
no changes needed there.

## Goal

Scrolling to the top of an open chat's message list transparently loads the
next batch of older messages, Telegram-style — no explicit "load more"
button, no page reload, and no loss of scroll position while it happens.

## Scope for this iteration

In scope:
1. Auto-loading older history when the user scrolls near the top of the
   message list, using `client.scrollback(room, 30)`.
2. A loading indicator while a batch is being fetched.
3. A "Начало истории" (beginning of history) indicator once the room has
   no more history to load, so the app stops retrying.
4. Fixing the message list's current "always scroll to bottom on any
   change" behavior to only do so when the user is already at (or near)
   the bottom, or on first opening a room — a **required** part of this
   feature, not a separate polish item: without it, prepending older
   messages at the top would immediately snap the view back to the
   bottom, making pagination unusable.

Explicitly out of scope for this iteration:
- A manual "load more" button (auto-scroll-trigger only, per user
  decision).
- Any "jump to latest" / "N new messages" affordance for when the user is
  reading old history and new messages arrive elsewhere in the room —
  new messages simply won't move their viewport; there's no button to
  jump back down other than scrolling manually. Can be added later if it
  turns out to matter.
- Retry/backoff handling for a failed `scrollback()` call beyond logging
  to console — matches the existing no-retry-system convention used
  everywhere else in this codebase (uploads, sends, message actions).
- Typing indicators and per-message "read by" receipts (own message
  checkmarks) — separate, already-tracked future item.

## Design

### 1. Triggering pagination

`MessageList.jsx` gains a `containerRef` on its scrollable outer `<div>`
(currently unref'd) and an `onScroll` handler. On every scroll event, the
handler:
- Updates a ref tracking whether the user is currently near the bottom
  (`scrollHeight - scrollTop - clientHeight < 120px`) — used by the
  scroll-follow fix in section 3.
- If `scrollTop < 150px` and a load isn't already in flight and the room's
  history isn't already known to be exhausted, calls `loadMoreHistory()`.

`loadMoreHistory()`:
```js
const loadMoreHistory = async () => {
  const container = containerRef.current
  if (!container || loadingHistory || reachedStart) return
  setLoadingHistory(true)
  const prevScrollHeight = container.scrollHeight
  try {
    const updatedRoom = await client.scrollback(room, 30)
    const hasMore = updatedRoom.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS) != null
    if (!hasMore) setReachedStart(true)
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight - prevScrollHeight
      }
    })
  } catch (err) {
    console.error('History pagination failed:', err)
  } finally {
    setLoadingHistory(false)
  }
}
```

`client.scrollback()` fetches older events and prepends them directly into
the room's live timeline; the existing `RoomEvent.Timeline` /
`RoomEvent.LocalEchoUpdated` listener (already in `MessageList.jsx` from
the reactions work) fires for each one and recomputes `messages` via the
unchanged `extractMessages()` — no new listener needed. Because pagination
only triggers while the user is scrolled near the top (`scrollTop < 150`),
the near-bottom ref used for the auto-scroll-to-bottom decision (section 3)
is already `false` at that point, so those intermediate re-renders during
the `scrollback()` call don't fight with the scroll-position restoration.

`loadingHistory` and `reachedStart` both reset (`useState` re-init via the
`[client, room]` effect) whenever the active room changes, so switching
chats always re-attempts pagination fresh.

### 2. Loading / exhausted UI

Rendered as a small fixed-height block at the very top of the message
list (above the first message, inside the scroll container so it scrolls
with the content):
- `loadingHistory` → a centered spinner (reuse `IconLoader2` +
  `className="spin"`, the same pattern already used for media loading
  states in `MessageBubble.jsx`).
- `reachedStart` → the text "Начало истории" in muted, small type, no
  spinner.
- Neither → render nothing (zero height, so it doesn't shift layout when
  inactive).

### 3. Fixing auto-scroll-to-bottom

Current behavior (`useEffect` keyed on `[messages]`) unconditionally calls
`bottomRef.current?.scrollIntoView()` on every change — including a
pagination-triggered prepend, which would immediately undo the scroll
position restoration in section 1. Replaced with: only call
`scrollIntoView()` when the near-bottom ref (tracked by the `onScroll`
handler from section 1) is `true` at the time `messages` changes. This
also happens to fix a related annoyance not previously reported: today,
any live event in the room (someone else's reaction, an edit) yanks
whoever is reading old history back to the bottom; after this change it
won't, matching standard chat-app behavior.

On first opening a room, the near-bottom ref should default to `true` (so
the initial 30 messages still land scrolled to the bottom, as today).

## Error handling

A failed `scrollback()` call is logged via `console.error` and simply
allows the next scroll-near-top tick to retry — no exponential backoff, no
user-visible error message, matching the rest of the codebase's
error-handling convention (established across the message-actions work:
no retry/toast system exists anywhere yet).

## Testing

No automated test framework exists in `client/`. Verification is manual:
send more than 30 messages in a room (or use a room from prior manual
testing that already has that much history), reload so only the initial
30 are loaded, scroll to the top, and confirm older messages load in with
the viewport staying anchored (not jumping), a spinner shows briefly, and
"Начало истории" appears once the room's actual beginning is reached.
Separately confirm the auto-scroll-to-bottom fix: open a room, scroll up
to read history, have a second account send a new message — the viewport
should stay put rather than jumping to the new message.
