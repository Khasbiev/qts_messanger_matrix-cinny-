# Quick Wins — No Auto-Select, Real Presence, Per-Chat Drafts

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. This is
the first of several backlog items being worked through in sequence after
message actions, history pagination, and typing/read-receipts. These three
are grouped together because each is small, touches a different part of the
app, and none depends on the others.

## Goal

1. Opening the app with existing rooms no longer auto-jumps into the first
   one — it lands on the already-built (but currently unreachable) "Выберите
   канал" empty state, Telegram-desktop-style.
2. A DM's header subtitle shows the other person's real Matrix presence
   ("в сети" / "отошёл" / "не в сети") instead of the hardcoded "в сети".
3. Unsent composer text survives switching away from a chat and reloading
   the page, restored per-room, and clears once the message is actually
   sent.

## Scope for this iteration

In scope:
1. `App.jsx`: remove the two `setActiveRoom(rooms[0])` calls (session
   restore and fresh login) that currently force-select a room.
2. `Header.jsx`: for DM rooms only, replace the hardcoded `'в сети'` with
   real presence, fetched on open and kept live via `UserEvent.Presence`.
   Channel rooms keep the existing member-count subtitle unchanged. The
   typing-indicator override (already shipped) still takes priority over
   both.
3. `InputArea.jsx`: persist the plain compose-box text per room to
   `localStorage`, debounced, restored on room open, cleared on send.

Explicitly out of scope for this iteration:
- "Last seen N minutes ago" granularity — three coarse states only
  (`online` / `unavailable` / anything else including unknown → offline).
- Presence for channel rooms (member-count subtitle stays as-is there).
- Persisting drafts while in edit or reply mode — only the plain send-mode
  compose text is saved; starting an edit/reply always uses that message's
  own content, per existing behavior.
- Any "N unsaved drafts" indicator in the sidebar — the draft is invisible
  storage, not a new UI affordance.

## Design

### 1. No auto-select on login (`App.jsx`)

Both call sites:
```js
if (rooms.length > 0) setActiveRoom(rooms[0])
```
(one in the `restoreSession().then(...)` effect, one in `handleLogin`) are
deleted outright. `activeRoom` stays `null` until the user clicks a room in
the sidebar. The existing `showNoRoomPlaceholder` / `NoRoom` component
already handles this correctly — no changes needed there.

### 2. Real DM presence (`Header.jsx`)

For a DM room, resolve the other member's user ID (`room.getJoinedMembers().find(m => m.userId !== me)?.userId`,
mirroring the pattern already used in `Sidebar/index.jsx` for DM display
names). On mount/room-change: call `client.getPresence(otherUserId)` once
to seed the initial state (in case no live presence event has arrived yet
this session), then subscribe to `client.on(UserEvent.Presence, (event, user) => { if (user.userId !== otherUserId) return; ... })`
for live updates. Map `user.presence` (or the initial fetch's `presence`
field) to display text:
- `'online'` → `'в сети'`
- `'unavailable'` → `'отошёл'`
- anything else (`'offline'`, unknown, fetch failed) → `'не в сети'`

This presence text feeds into the existing `subtitle` computation
(currently: typing-names check, then `isDM ? 'в сети' : memberCountText`) —
the DM branch of that ternary becomes the live presence text instead of
the literal string, with typing still overriding it exactly as it does
today.

### 3. Per-chat drafts (`InputArea.jsx`)

Storage key: `` `qts_draft_${room.roomId}` ``. On room open (`room.roomId`
change), read `localStorage.getItem(key)`; if present and the composer
isn't in edit/reply mode, seed `value` with it. On every `handleInput`
call (plain typing, not edit/reply prefill), debounce-write the current
value to that key (~400ms), or remove the key entirely when the value is
empty. On successful send (`handleSend`, after `setValue('')`), remove the
key immediately so a sent message never reappears as a stale draft. Reading
localStorage never touches edit/reply mode — those already fully own the
composer's contents via the existing `wasEditingRef` effect.

## Error handling

`localStorage` access is wrapped in try/catch (private browsing / storage
quota edge cases) and silently no-ops on failure — a draft failing to save
is not worth surfacing to the user, matching the app's existing
error-handling posture for non-critical paths. `client.getPresence()`
failures are logged via `console.error` and just leave the subtitle on the
"не в сети" fallback, consistent with the rest of the codebase.

## Testing

No automated test framework exists in `client/`. Verification is manual:
confirm login lands on the empty state with multiple existing rooms
available; confirm a DM's subtitle reflects the other tester's real
online/offline state (log one out to see it flip); type in a chat, switch
away without sending, reload the page, switch back, and confirm the text
is restored; send a message and confirm the draft is gone afterward.
