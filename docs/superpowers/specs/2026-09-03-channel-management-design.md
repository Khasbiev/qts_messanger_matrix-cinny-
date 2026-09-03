# Channel Member Management

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. Channel
member management (add/remove members, topic, avatar, leave) is next on
the priority list after message actions, history pagination,
typing/read-receipts, quick wins, and forwarding.

`Header.jsx` currently shows the chat name + a subtitle (presence for DMs,
member count for channels) with no way to act on it — clicking does
nothing. `matrix-js-sdk` already exposes everything needed:
`setRoomTopic`/`invite`/`kick`/`leave` convenience methods,
`sendStateEvent` for the room avatar, and permission checks via
`room.currentState.maySendStateEvent(eventType, userId)` (topic/avatar/name)
and `room.currentState.hasSufficientPowerLevelFor(action, powerLevel)`
(invite/kick), fed by `room.getMember(userId)?.powerLevel`.

## Goal

Clicking the chat name/avatar in the header opens an info panel:
- **DM:** avatar, name, presence, a "Выйти из чата" button.
- **Channel:** avatar (editable if permitted), topic (editable if
  permitted), the member list, an "Добавить участника" control (if
  permitted), a "Убрать" control per non-self member (if permitted), and
  a "Выйти из чата" button.

Actions the current user doesn't have permission for are hidden, not shown
disabled or left to fail with a server error.

## Scope for this iteration

In scope:
1. A new `ChatInfoModal.jsx`, triggered by clicking the name/avatar area in
   `Header.jsx`.
2. Viewing: channel topic (or "Нет темы"), member list (names, a "вы"
   marker on the current user's own row), DM presence — all read-only
   groundwork for the edit actions in the second task.
3. "Выйти из чата" — works identically for DMs and channels
   (`client.leave(roomId)`), clears the app's active room afterward so the
   UI doesn't keep pointing at a room the user is no longer in.
4. Editing the channel topic and avatar, gated on
   `room.currentState.maySendStateEvent('m.room.topic' / 'm.room.avatar', myUserId)`.
5. Inviting a member (reusing the existing `UserPicker` in single-select
   mode, inline within the modal — matching `NewChannelModal`'s existing
   inline-picker convention rather than stacking a second modal), gated on
   `hasSufficientPowerLevelFor('invite', myPowerLevel)`.
6. Removing (kicking) a non-self member, with a lightweight confirm
   dialog (matching the existing delete-message confirm pattern), gated on
   `hasSufficientPowerLevelFor('kick', myPowerLevel)`.

Explicitly out of scope for this iteration:
- Editing the channel's display name (`m.room.name`) — not asked for,
  only topic/avatar were.
- Banning, muting, or any power-level *management* UI (promoting another
  member to admin/moderator) — only add/remove membership itself.
- A dedicated "pending invites" view (who's been invited but hasn't
  joined) — the member list shows joined members only, matching
  `Sidebar`'s existing `getMyMembership() === 'join'` convention.
- Any change to the DM info view beyond avatar/name/presence/leave — no
  topic or member-list concept for DMs.

## Design

### 1. `lib/matrix.js` additions

```js
export async function updateRoomTopic(roomId, topic) {
  if (!_client) throw new Error('Not connected')
  await _client.setRoomTopic(roomId, topic)
}

export async function updateRoomAvatar(roomId, file) {
  if (!_client) throw new Error('Not connected')
  const { content_uri: mxcUrl } = await _client.uploadContent(file, { type: file.type })
  await _client.sendStateEvent(roomId, 'm.room.avatar', { url: mxcUrl }, '')
  return mxcUrl
}

export async function inviteToRoom(roomId, userId) {
  if (!_client) throw new Error('Not connected')
  await _client.invite(roomId, userId)
}

export async function kickFromRoom(roomId, userId) {
  if (!_client) throw new Error('Not connected')
  await _client.kick(roomId, userId)
}

export async function leaveRoom(roomId) {
  if (!_client) throw new Error('Not connected')
  await _client.leave(roomId)
}
```

### 2. Triggering (`Header.jsx`)

The name+avatar block becomes clickable (`cursor: pointer`, a hover
affordance matching the existing hover-highlight convention used
elsewhere in the app), opening `ChatInfoModal`. `Header` gains an
`onLeave` prop (threaded `App.jsx` → `Chat/index.jsx` → `Header.jsx`,
mirroring how `onNav` is already threaded) that `App.jsx` wires to
`() => setActiveRoom(null)` — called after a successful leave, so the
chat pane stops pointing at a room the user has left. `ChatInfoModal`
itself calls `leaveRoom` and, on success, calls both `onLeave()` and
`onClose()`.

### 3. `ChatInfoModal.jsx` — DM branch

Avatar (reusing the existing avatar-color/initials convention), name,
current presence text (recomputed the same way `Header.jsx` already
does, passed in as a prop rather than duplicating the subscription), and
a single "Выйти из чата" button.

### 4. `ChatInfoModal.jsx` — channel branch

- **Topic:** shown as plain text ("Нет темы" if empty) with an edit
  (pencil) affordance next to it when `maySendStateEvent('m.room.topic', ...)`
  is true. Clicking it swaps to an inline text input + save button
  (matching `SettingsModal`'s name-edit interaction).
- **Avatar:** same click-to-upload interaction as `SettingsModal`'s own
  avatar editor, present only when `maySendStateEvent('m.room.avatar', ...)`
  is true; otherwise a plain non-interactive avatar.
- **Members:** each joined member's name, with "(вы)" appended on the
  current user's own row, and a "Убрать" button on every OTHER row when
  `hasSufficientPowerLevelFor('kick', myPowerLevel)` is true. Clicking
  "Убрать" opens a confirm dialog (same `Modal`-based pattern as message
  deletion) before actually calling `kickFromRoom`.
- **Add member:** an "Добавить участника" row/button, present only when
  `hasSufficientPowerLevelFor('invite', myPowerLevel)` is true. Clicking
  it swaps that row for an inline `UserPicker` (single-select) + a
  "Пригласить" confirm button, mirroring `NewChannelModal`'s existing
  inline-picker convention rather than opening a second stacked modal.
- **Leave:** "Выйти из чата" button at the bottom, same behavior as the
  DM branch.

## Error handling

Every write action (topic/avatar/invite/kick/leave) surfaces its failure
inline in the modal (matching `NewChannelModal`/`ForwardModal`'s
convention) since the user is actively waiting on a result — not the
fire-and-forget `console.error`-only convention used for background sends
elsewhere.

## Testing

No automated test framework exists in `client/`. Verification is manual:
open the info panel for a DM and a channel; as the channel's creator,
edit the topic and avatar and confirm both update live for other members;
invite a new member and confirm they can see/join the channel; kick a
member and confirm they lose access; as a non-creator member with no
elevated power level, confirm the edit/invite/kick controls are absent
entirely (not just disabled); leave a DM and a channel and confirm the
app returns to the "no chat selected" state and the room disappears from
the sidebar.
