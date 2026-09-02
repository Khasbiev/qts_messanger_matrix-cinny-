# Typing Indicator + Real Read Receipts

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk` (see prior
specs in this directory). Two UI elements have been visual stubs since the
MVP: `Header.jsx` hardcodes the subtitle line to `'в сети'` for DMs (online
status — separate future item, not touched here) or a member count for
channels, and `MessageBubble.jsx` renders a `✓✓` checkmark for own messages
gated on `message.readBy`, but nothing in `MessageList.jsx`'s
`extractMessages()` ever sets that field, so the checkmark never lights up
in practice — it's dead code today.

This is the next item in the priority list the user set after message
actions and history pagination.

## Goal

- While the other person (DM) or any other room member (channel) is
  typing, the chat header's subtitle line shows "печатает…" instead of the
  normal online-status/member-count text, and reverts automatically.
- Own sent messages show a real `✓✓` (colored) once at least one other
  joined member has read up to that message, and stay showing the plain
  (gray) `✓✓` otherwise — using the exact same visual treatment already
  built into `MessageBubble.jsx`, just fed real data. (`MessageBubble.jsx`
  already renders `color: readBy > 0 ? accent : muted` — `readBy` was
  designed as a **count**, not a boolean; this iteration honors that
  existing contract rather than changing it.)

## Scope for this iteration

In scope:
1. Sending typing notifications (`client.sendTyping`) from `InputArea.jsx`
   while the user has text in the composer, with local throttling (not on
   every keystroke) and an explicit stop on clearing/sending.
2. Displaying "печатает…" (and, for channels with multiple typists, a
   reasonable combined string) in `Header.jsx`, subscribed to
   `RoomMemberEvent.Typing`.
3. Computing `readBy` per own message in `extractMessages()` as a count —
   the number of other currently-joined members who have read up to that
   message, via `room.hasUserReadEvent(userId, eventId)` — matching the
   existing `readBy > 0` → colored-checkmark contract already in
   `MessageBubble.jsx` (for a DM this is just 0 or 1; for a channel it's
   "how many of the other members have seen it," coloring on the first).
4. Recomputing on `RoomEvent.Receipt` so the checkmark updates live.

Explicitly out of scope for this iteration:
- Real online/presence status (the `'в сети'` stub stays as-is when nobody
  is typing) — separate, already-tracked future item.
- Per-user "seen by" lists/avatars for channels (Telegram-style) — the
  existing UI only has room for a single boolean-driven checkmark, and
  that's what this ships; a richer per-user view is a different feature.
- Any change to how receipts are *sent* — that's already wired (a prior
  bug fix added `client.sendReadReceipt` for the unread badge); this
  iteration only adds *reading* others' receipts to render `readBy`.

## Design

### 1. Sending typing notifications (`InputArea.jsx`)

Two refs: `isTypingRef` (whether we've currently told the server we're
typing) and `typingTimeoutRef` (a pending "auto-stop" timer). On every
`handleInput` call where the new value is non-empty: if not already marked
typing, call `client.sendTyping(room.roomId, true, 10000)` and set
`isTypingRef.current = true`; regardless, reset a 4-second timer that, if
it fires without further input, sends `sendTyping(room.roomId, false, 10000)`
and clears `isTypingRef`. When the input becomes empty (either by the user
clearing it or by `handleSend` clearing it after sending), immediately
cancel the timer and send `isTyping: false` if we were marked typing. Also
send the stop signal in a cleanup effect keyed on `room` (covers switching
rooms mid-type and unmounting). All `sendTyping` calls are fire-and-forget
with `.catch(console.error)`, matching the rest of the codebase's
error-handling convention.

### 2. Displaying the indicator (`Header.jsx`)

New local state `typingNames: string[]`, recomputed from
`room.getJoinedMembers().filter(m => m.userId !== me && m.typing).map(m => m.name)`
on mount/room-change and on every `RoomMemberEvent.Typing` event for a
member in this room (`client.on(RoomMemberEvent.Typing, (event, member) => { if (member.roomId !== room.roomId) return; recompute() })`).
Subtitle line: when `typingNames.length > 0`, render "печатает…" for one
typist or "N человек печатают…" for multiple (channels only — a DM only
ever has one other person); otherwise render the existing
`isDM ? 'в сети' : memberCountText` unchanged.

### 3. Computing `readBy` (`MessageList.jsx`)

In the existing per-message post-processing loop in `extractMessages()`
(the one that already attaches `reactions` and applies edits), add: for
each `msg` where `msg.isOwn` is true, compute
`const others = room.getJoinedMembers().filter(m => m.userId !== me)` and
set `msg.readBy = others.filter(m => room.hasUserReadEvent(m.userId, msg.id)).length`.
`MessageBubble.jsx` needs no changes — its existing render
(`isOwn && readBy != null && (...)`, colored when `readBy > 0`) already
does the right thing once this field is real.

### 4. Recomputing on new receipts

Add a `RoomEvent.Receipt` listener to the existing listener effect in
`MessageList.jsx` (alongside `Timeline`/`LocalEchoUpdated`/`Redaction`/`TimelineReset`),
scoped to this room, that recomputes `messages` the same way the others do.

## Error handling

`sendTyping` failures are logged via `console.error` only, matching the
established convention — a failed typing notification just means the
other side doesn't see "печатает…" this time, not worth retry/UI noise.

## Testing

No automated test framework exists in `client/`. Verification is manual:
two accounts in the same room, one types (without sending) while the other
watches the header subtitle switch to "печатает…" and back after a pause;
one sends a message and the other opens/reads it while the sender watches
the checkmark for that message change from plain to colored.
