# Forward Messages

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. Message
actions (reply/edit/delete/reactions) already exist — see
`2026-09-02-message-actions-design.md` — with an established hover action
bar (`MessageActions.jsx`) on every bubble, and an established pattern for
Matrix-relation-less "extra" content (`sendReply`'s plain-text fallback +
`stripReplyFallback` on display) that this feature reuses. Forwarding was
next on the priority list the user set after the "quick wins" batch.

Matrix has no native "forward" relation — clients conventionally just
re-send a copy of the message's content into another room, optionally with
a "Forwarded from X" marker. This spec defines this app's version of that
convention.

## Goal

From the hover action bar on any message (own or not), a user can forward
it to one or more of their existing chats. The recipients see the message
content with a "↪ Переслано от X" label identifying the original author.

## Scope for this iteration

In scope:
1. A "Переслать" (forward) button on `MessageActions`, available on every
   message type (text, image, voice, video, file) — own or not — except
   deleted (tombstone) messages, which already render with no hover bar at
   all.
2. A forward-target picker modal listing the user's existing joined
   rooms/DMs (not a "start a new chat" flow), multi-select, confirming
   sends the message into every selected chat.
3. `dev.qts.forwarded_from` custom content field carrying the original
   sender's Matrix ID and display name, read by `extractMessages` and
   rendered as a small label above the forwarded bubble's content.
4. For text messages, a plain-text fallback ("Переслано от X:\n<text>")
   in `body` for clients that don't understand the custom field, stripped
   back out for display in this app the same way `sendReply`'s fallback
   is.
5. For media messages (image/voice/video/file), the original `url`/`info`
   are copied as-is — no re-upload, since `mxc://` references are valid
   Matrix-wide, not per-room.

Explicitly out of scope for this iteration:
- Forwarding to a brand-new chat (create-DM-and-forward in one step) —
  target must be an existing chat, matching this app's other pickers
  (`NewDmModal`/`NewChannelModal` are separate, existing flows).
- Adding a comment alongside the forward (Telegram's "add a message"
  option) — the forward is sent as-is, a separate message can be typed
  and sent normally afterward if wanted.
- Preserving a forwarded message's own reply-to context (if you forward a
  reply, only that message's own text/media forwards — not the quoted
  original it was replying to). Matches the existing precedent: `sendReply`
  already strips a forwarded-through reply's fallback text via
  `message.text` being pre-cleaned by `extractMessages`.
- Re-forwarding a message that is itself a forward (no chained "Forwarded
  from X, forwarded from Y" — only ever shows the original author, since
  `dev.qts.forwarded_from` on the source message, if present, is not
  itself carried forward; the newly-created forward always points at
  whoever the CURRENT message's rendered author is).
- Search/filtering within the forward-target picker beyond the plain list
  (no text search box) — the picker shows the same room list the sidebar
  already has, which for a 30-user deployment is short enough to scroll.

## Design

### 1. Sending (`lib/matrix.js`)

```js
export async function forwardMessage(sourceRoomId, message, targetRoomIds) {
  if (!_client) throw new Error('Not connected')
  const forwardedFrom = { sender: message.senderId, displayName: message.sender }

  let content
  if (message.text != null) {
    content = {
      msgtype: 'm.text',
      body: `Переслано от ${message.sender}:\n${message.text}`,
    }
  } else {
    const sourceRoom = _client.getRoom(sourceRoomId)
    const event = sourceRoom?.findEventById(message.id)
    if (!event) throw new Error('Исходное сообщение недоступно')
    content = { ...event.getContent() }
    delete content['m.relates_to']
  }
  content['dev.qts.forwarded_from'] = forwardedFrom

  return Promise.all(targetRoomIds.map(roomId => _client.sendMessage(roomId, { ...content })))
}
```

For text, `message.text` is the value `extractMessages` already produces —
edit-folded and reply-fallback-stripped — so a forwarded edited message
carries its current text, not its original pre-edit text, and forwarding a
reply carries only that message's own words. For media, the original
event's raw content is read directly (needed for `url`/`info`, which
`extractMessages`'s derived `message.image`/`message.voice`/etc. fields
don't carry in re-uploadable form) and any `m.relates_to` is stripped so a
forwarded reply-with-media doesn't drag the reply relation into the new
room.

### 2. Receiving (`extractMessages`, `MessageList.jsx`)

In the per-message post-processing loop, if `content['dev.qts.forwarded_from']`
is present, attach `msg.forwardedFrom = { sender, displayName }`. For text
messages carrying the fallback prefix, strip it the same way
`stripReplyFallback` works: if `body` starts with `"Переслано от "`, slice
from just after the first `":\n"`.

### 3. Display (`MessageBubble.jsx`)

When `message.forwardedFrom` is set, render a small line
("↪ Переслано от {displayName}") above the bubble's content, in the same
position/style family as the existing reply-quote block but without the
border-left quote treatment — just a muted/accent label line, matching
Telegram's forwarded-message convention.

### 4. Trigger (`MessageActions.jsx`)

New unconditional icon (available for both own and others' messages,
alongside the existing reply icon) that calls `onForward(message)`.
`MessageBubble` owns a `forwardOpen` boolean, same pattern as the existing
`confirmOpen` delete-confirmation state, and renders the picker modal when
true.

### 5. Target picker (`Modals/ForwardModal.jsx`, new file)

Lists the current user's joined rooms (`client.getRooms()`, same
DM/channel display-name resolution Sidebar already uses), multi-select
checkboxes (mirroring `UserPicker`'s `mode="multi"` interaction, adapted
from users to rooms), a "Переслать" confirm button disabled until at least
one room is selected. On confirm, calls `forwardMessage(sourceRoomId, message, selectedRoomIds)`
and closes; a failure is caught and shown inline (matching
`NewChannelModal`'s error-display pattern), not silently swallowed, since
this is a direct user-initiated action with a visible modal still open —
unlike the fire-and-forget `console.error` convention used for background
sends.

## Error handling

`forwardMessage`'s promise rejection is surfaced in the modal (per above)
since the user is actively waiting on this action. Everything else follows
the established codebase convention.

## Testing

No automated test framework exists in `client/`. Verification is manual:
forward a text message to a single chat and confirm the label + content
appear correctly on the receiving side; forward an image/voice message and
confirm it plays/displays without re-upload; forward to multiple chats at
once and confirm it lands in all of them; forward someone else's message
and an edited message of your own, confirming the label shows the
*original* author and the edited text (not stale pre-edit text).
