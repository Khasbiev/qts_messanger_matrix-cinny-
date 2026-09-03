# Search

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. The
sidebar's search box (`Sidebar/index.jsx`) is currently decorative — an
`<input>` with a placeholder and no state, no handler. There is no way to
search message history at all. Both are next on the priority list after
channel member management.

`matrix-js-sdk` exposes global full-text search via
`client.searchRoomEvents({ term, filter })`: `filter` is optional
(`IRoomEventFilter`), and omitting it searches across every room the user
has joined — exactly what's needed for a global, Telegram-style search.
The SDK hardcodes `order_by: 'recent'` internally (see
`client.js`'s `searchRoomEvents`), so results already come back
newest-first with no client-side re-sorting needed. Each result
(`SearchResult`) exposes `.context.getEvent()`, a `MatrixEvent` with
`.getRoomId()`, `.getSender()`, `.getContent()`, `.getId()`, and
`.getTs()` (the same timestamp accessor already used elsewhere in this
codebase, e.g. `Sidebar/index.jsx`'s `getPreview`).

There's no existing "jump to an arbitrary message" capability in
`MessageList.jsx`. History pagination (already shipped) loads older
messages into the room's live timeline via `client.scrollback(room, 30)`,
stopping when `getPaginationToken(EventTimeline.BACKWARDS)` returns null.
This same primitive is reused for jumping to a search result rather than
introducing a second timeline-set-based architecture
(`client.getEventTimeline`) alongside it.

## Goal

Typing in the sidebar search box shows live results in two sections:
- **Чаты** — joined rooms/DMs whose name matches, filtered locally.
- **Сообщения** — messages matching the term, searched globally across
  every joined room via `client.searchRoomEvents`, newest first.

Clicking a chat result opens it (existing behavior). Clicking a message
result opens that room and scrolls to/highlights the matching message,
paginating backward first if the message isn't already loaded.

## Scope for this iteration

In scope:
1. Wiring up the sidebar search box: debounced input, a results view that
   replaces the normal chat list while a query is active, clearing back
   to the normal list when the input is cleared.
2. Local chat/DM name filtering (reusing the existing DM-name-resolution
   and `isDirectRoom`/`colorFor` conventions already used elsewhere).
3. Global message search via `client.searchRoomEvents`, with each result
   showing a snippet, sender name, room name, and relative time.
4. Click-through: chat result → `onRoomSelect`; message result → open the
   room, then jump to and highlight the specific message.
5. Jump-to-message: if the event is already in the loaded timeline, scroll
   and highlight immediately. If not, page backward with the existing
   `scrollback` loop (capped) until found or the cap is hit, then scroll
   and highlight (or silently fall back to the normal bottom-of-timeline
   view if never found — not a user-facing error, since this is an edge
   case around very old history).
6. Graceful degradation: if the search backend isn't enabled on the
   homeserver (or the request otherwise fails), the "Сообщения" section
   shows an inline Russian error while "Чаты" (which needs no server
   round-trip beyond what's already synced) keeps working.

Explicitly out of scope:
- Per-chat (non-global) message search — the user chose global-only, this
  isn't a fallback view of it.
- Highlighting the matched substring within the message snippet — showing
  the message body/snippet plainly is enough for this iteration.
- Any search filters (by sender, by date range, by media type).
- Searching room topics/names via the server `content.name`/
  `content.topic` search keys — only `content.body` (message text).

## Design

### 1. `lib/matrix.js` addition

```js
export async function searchMessages(term) {
  if (!_client) throw new Error('Not connected')
  const results = await _client.searchRoomEvents({ term })
  return results.results.map(r => {
    const event = r.context.getEvent()
    const roomId = event.getRoomId()
    const room = _client.getRoom(roomId)
    return {
      id: event.getId(),
      roomId,
      roomName: room?.name || roomId,
      senderId: event.getSender(),
      senderName: room?.getMember(event.getSender())?.name || event.getSender(),
      body: event.getContent()?.body || '',
      ts: event.getTs(),
    }
  })
}
```

No wrapper for the local chat filter — it's a plain `.filter()` over
`client.getRooms()` done directly in the component, mirroring how
`ForwardModal.jsx`'s `buildRoomList` already does it.

### 2. `Sidebar/index.jsx` — search state and view switch

The search `<input>` gets `value`/`onChange` wired to a `query` state.
Debounce message search (300ms) with a `cancelled`-flag guard (the
established pattern in this codebase for stale-async-write prevention) —
local chat filtering runs synchronously on every keystroke, no debounce
needed.

When `query` is non-empty, the sidebar's normal categorized room list is
replaced by a `SearchResults` view (new component,
`Sidebar/SearchResults.jsx`) showing the two sections. When `query` is
cleared (empty string or the input's clear action), the normal list
returns. No separate "search mode" toggle — typing anything switches the
view, clearing it switches back, matching how the box already reads as
live-filtering rather than a submit-driven search.

### 3. `Sidebar/SearchResults.jsx` — new component

Props: `client`, `query`, `onRoomSelect(room, opts)`, `onClose` (clears
the query, called after a click-through).

- **Чаты section:** `client.getRooms().filter(r => r.getMyMembership() === 'join')`,
  resolve DM display names the same way `Sidebar/index.jsx`/`ForwardModal.jsx`
  already do, case-insensitively substring-match against `query`. Empty
  section is simply omitted (no "nothing found" per-section noise) unless
  *both* sections are empty, in which case a single "Ничего не найдено" is
  shown once for the whole panel.
- **Сообщения section:** debounced call to `searchMessages(query)`. Loading
  state: a small inline spinner/label while in flight. Error state: catch
  and show "Поиск сообщений недоступен" inline in this section only — the
  Чаты section is unaffected since it never touched the network. Each
  result row: sender name, message snippet (truncated, plain — no
  highlighting), room name, relative timestamp (reuse `formatChatTime`,
  the module-scoped helper already defined in `Sidebar/index.jsx` for the
  chat list's own timestamps — export it from that file so
  `SearchResults.jsx` can import it, rather than duplicating the logic).
- Clicking a Чаты row: `onRoomSelect(room)`, then `onClose()`.
- Clicking a Сообщения row: `onRoomSelect(room, { jumpToEventId: result.id })`,
  then `onClose()`.

### 4. Wiring `jumpToEventId` through to `MessageList.jsx`

`Sidebar`'s `onRoomSelect` prop is the same one `App.jsx` already passes
down (`handleRoomSelect`). Extend `handleRoomSelect(room, opts)` in
`App.jsx` to accept an optional second argument and store it alongside
`activeRoom` (e.g. `activeRoom` becomes `{ room, jumpToEventId }`
internally, or a sibling `jumpToEventId` state cleared whenever a room is
selected without one) — implementation detail for the plan to pin down,
but the shape threading down is: `App.jsx` → `Chat/index.jsx` →
`MessageList.jsx` gets a `jumpToEventId` prop.

`MessageList.jsx`, on mount (or when `jumpToEventId` changes) with a
non-null value:
1. Check `room.findEventById(jumpToEventId)`. If found: scroll it into
   view (`block: 'center'`) instead of the default scroll-to-bottom, and
   apply a temporary highlight style (a CSS background-color transition
   using `var(--...)` tokens, fading out after ~2s) to the message's DOM
   node. Requires each rendered message row to carry a
   `data-event-id={msg.id}` attribute for the lookup (not currently
   present — added as part of this feature).
2. If not found: call the existing `client.scrollback(room, 30)` loop
   (same helper already used for scroll-triggered history pagination),
   checking `room.findEventById` after each page, capped at ~20 iterations
   (roughly 600 events) or whenever `getPaginationToken(BACKWARDS)`
   becomes null — whichever comes first. If found during this loop, same
   scroll+highlight as above. If the cap is hit without finding it, fall
   back silently to the normal bottom-of-timeline render (no error
   shown — this is an edge case around very deep history).
3. Once handled (found-and-highlighted, or fallen back), the
   `jumpToEventId` is considered consumed so re-renders don't repeat the
   scroll.

## Error handling

- Message search failures are caught and shown inline in the Сообщения
  section only, in Russian, following the existing
  `err.data?.error || err.message || '<russian fallback>'` convention.
- A jump-to-message that never finds its target degrades silently to the
  normal timeline view — not treated as an error, since the message may
  simply be extremely old.

## Testing

No automated test framework exists in `client/`. Verification is manual:
type a query matching an existing chat name and confirm it filters
correctly; type a query matching message text and confirm global results
appear across multiple rooms, newest first; click a message result for a
message already visible in the open room's loaded timeline and confirm it
scrolls/highlights immediately; click one for an older message not yet
paginated in and confirm it pages backward and then scrolls/highlights;
confirm clearing the query returns to the normal chat list; if feasible,
confirm the graceful-degradation error text by temporarily pointing at a
homeserver/config without search enabled (or simulate by cancelling within
the debounce) — otherwise confirm the code path by inspection.
