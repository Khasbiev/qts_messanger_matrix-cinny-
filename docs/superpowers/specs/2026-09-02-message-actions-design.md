# Message Actions — Reply, Edit/Delete, Reactions

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk` (see
`2026-09-01-custom-messenger-frontend-mvp-design.md`). It sends/receives plain
text and media messages, but has no support for message-level actions:

- `MessageBubble.jsx` already renders `reactions`/`readBy` markup, but
  `MessageList.jsx`'s `extractMessages()` never populates them from real room
  data — reactions never appear because they're never read off the timeline.
- `lib/matrix.js` has no reply, edit, delete, or reaction sending functions —
  only `sendMessage`, `uploadFile`, and the voice/video-note senders.
- There is no hover/action UI on a message bubble at all.

This was identified as the highest-priority gap in a broader review of missing
functionality (reactions, reply/forward, edit/delete, typing/read-receipts,
history pagination, channel member management, search, mentions, link
previews, multi-file/drag-drop upload, PWA icon, presence, drafts). This spec
covers the first slice: **reply, edit/delete, and reactions**. Everything else
stays out of scope and will get its own spec later.

## Goal

A user can, from a hover action bar on any message bubble:
- React to a message with an emoji (one reaction per user per message).
- Reply to a message (quoted preview shown inline in the composer and in the
  sent bubble).
- Edit or delete their own text messages.

All three round-trip through real Matrix events so any standard Matrix client
in the same room sees the same reply/edit/reaction/redaction semantics.

## Scope for this iteration

In scope:
1. Reactions: add/toggle, one emoji per user per message, aggregated counts,
   rendered via the existing (currently dead) `reactions` markup in
   `MessageBubble`.
2. Reply: quote a message into the composer, send with `m.relates_to.m.in_reply_to`,
   render a static (non-clickable) quoted preview in the resulting bubble.
3. Edit: own `m.text` messages only, via `m.replace` relation; edited bubbles
   show an "(edited)" marker.
4. Delete: own messages (any type), via redaction; deleted messages render as
   an in-place "Сообщение удалено" tombstone, not removed from the list.

Explicitly out of scope for this iteration:
- Forwarding messages.
- Editing media/voice/video/file captions (no caption field exists yet).
- Click-to-scroll from a reply quote to the original message (needs history
  pagination, which doesn't exist yet — separate spec).
- Moderator delete of others' messages (power-level UI).
- Retry/undo UI for failed send/edit/delete/react — relies on
  matrix-js-sdk's built-in local-echo `not_sent` status; failures are logged
  to console, consistent with the existing file-upload error handling.
- Typing indicators, read receipts, history pagination, member management —
  each already earmarked as its own later spec.

## Design

### 1. `lib/matrix.js` additions

```
sendReply(roomId, text, replyToEvent)
```
Sends `m.room.message` with `msgtype: 'm.text'`, `body` prefixed with a
plain-text fallback quote (`> <@sender> original\n\nreply text`) and
`format: 'org.matrix.custom.html'` / `formatted_body` containing an
`<mx-reply>` fallback block, per the Matrix rich-reply spec — so clients
without native reply support still show a quote. `m.relates_to` carries
`{ 'm.in_reply_to': { event_id: replyToEvent.id } }`.

```
editMessage(roomId, eventId, newText)
```
Sends a new `m.room.message` with `body: '* ' + newText` (back-compat prefix),
`m.new_content: { msgtype: 'm.text', body: newText }`, and
`m.relates_to: { rel_type: 'm.replace', event_id: eventId }`.

```
deleteMessage(roomId, eventId)
```
`client.redactEvent(roomId, eventId)`.

```
sendReaction(roomId, eventId, emoji)
removeReaction(roomId, reactionEventId)
```
`sendReaction` calls `client.sendEvent(roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: emoji } })`.
`removeReaction` is `client.redactEvent(roomId, reactionEventId)`.

### 2. `MessageList.jsx` — `extractMessages()` rework

Currently a single pass over `room.getLiveTimeline().getEvents()` that only
handles `m.room.message`. Reworked to:

1. First pass: collect `m.room.message` events into `byId`, skipping ones
   whose content carries `m.relates_to.rel_type === 'm.replace'` (edits) and
   `m.reaction` events (handled separately).
2. Second pass over the same events: apply `m.replace` events as a content
   override onto their target in `byId` (`edited: true`, body from
   `m.new_content`), and fold `m.reaction` events into a
   `Map<targetEventId, Map<emoji, {count, reactedByMe}>>`, converting each
   inner map to the `reactions` array shape `MessageBubble` already expects.
3. Redactions: listen separately (see below) since a redacted event's own
   content is stripped, not marked — matrix-js-sdk exposes this via the
   `RoomEvent.Redaction` event, whose target event id is looked up in `byId`
   and flagged `deleted: true` (content cleared, tombstone rendered instead).
4. Reply resolution: if a message's content has `m.relates_to.m.in_reply_to`,
   look up that event id via `room.findEventById()` (already-loaded timeline
   only, no fetch). Found → `replyTo: { sender, snippet }`. Not found →
   `replyTo: { sender: null, snippet: 'Исходное сообщение недоступно' }`.

New listener: `client.on(RoomEvent.Redaction, ...)` alongside the existing
`RoomEvent.Timeline` listener, both triggering the same `extractMessages`
recompute (mirrors the existing pattern).

### 3. Interaction state — lifted to `Chat/index.jsx`

`Chat/index.jsx` (parent of `MessageList` and `InputArea`) owns:
```
const [replyingTo, setReplyingTo] = useState(null)   // message object or null
const [editingMessage, setEditingMessage] = useState(null)
```
Passed down to `MessageList` (to wire bubble callbacks) and `InputArea` (to
render the preview strip and switch send behavior). Only one of the two can
be active at a time — starting one clears the other.

### 4. `MessageBubble.jsx` — hover action bar

On mouse-enter, an absolutely-positioned icon row appears at the bubble's
outer corner (mirrors existing `DownloadButton` hover-affordance style):
- 😊 reaction — click opens a 7-emoji quick strip (frequently-used subset of
  the existing `EMOJI` list in `EmojiPicker.jsx`) plus a "…" button that opens
  the full `EmojiPicker` grid.
- ↩ reply — calls `onReply(message)`.
- ✎ edit, 🗑 delete — rendered only when `message.isOwn && message.text`
  (edit) / `message.isOwn` (delete).

Clicking an emoji (quick strip or full picker) calls `onReact(message, emoji)`,
which implements the one-reaction-per-user toggle client-side: if the message's
aggregated `reactions` show the current user already reacted with a different
emoji, `removeReaction` the old one first, then `sendReaction` the new one; if
they clicked their own existing emoji, just `removeReaction` (toggle off).

Deleted messages (`message.deleted`) render the tombstone directly in
`MessageBubble`, skipping the normal bubble content and hover actions.

### 5. `InputArea.jsx` — reply/edit modes

A preview strip renders above the textarea when `replyingTo` or
`editingMessage` is set, with sender+snippet (reply) or "Редактирование
сообщения" (edit) and a ✕ to cancel. `handleSend`:
- edit mode → `editMessage(roomId, editingMessage.id, text)`, then clear
  `editingMessage`.
- reply mode → `sendReply(roomId, text, replyingTo)`, then clear `replyingTo`.
- neither → existing `sendMessage` behavior, unchanged.

Entering edit mode also pre-fills the textarea with the message's current
text (mirrors how `insertEmoji` already manipulates `value`).

### 6. Delete confirmation

Reuses the existing `Modal` component (`components/Modals/Modal.jsx`) for a
simple confirm/cancel dialog before calling `deleteMessage`.

## Error handling

Send/edit/delete/react network failures are not specially handled beyond
matrix-js-sdk's built-in local-echo `not_sent` event status; failures are
logged via `console.error`, matching the existing pattern in
`InputArea.handleSend`/`handleFileChange`. No retry/undo UI in this
iteration.

## Testing

No test framework exists in `client/` (`package.json` has only
`dev`/`build`/`preview` scripts). Verification is manual: run the dev server,
log in as two different users in the same room (two browser
sessions/profiles), and confirm reply/edit/delete/react round-trip correctly
in both directions (sender sees their own action reflected; the other user
sees it arrive live via the existing `RoomEvent.Timeline`/new
`RoomEvent.Redaction` listeners).
