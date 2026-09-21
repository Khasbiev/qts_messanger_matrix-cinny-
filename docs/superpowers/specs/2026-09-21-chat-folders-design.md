# Chat Folders (Telegram-style)

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk` (see
[[project_custom_messenger_client]]). The chat list lives in
`Sidebar/index.jsx`: `categorize()` splits `client.getRooms()` into two
fixed sections — "КАНАЛЫ" and "ЛИЧНЫЕ СООБЩЕНИЯ" — each rendered as its
own `<ChatItem>` list, refreshed on `Sync`/`MyMembership`/`AccountData`/
`Timeline` events. There is no chat-level context menu today —
`ChatItem.jsx` only handles `onClick`.

The app already has one working precedent for small pieces of
cross-device user state that aren't part of the Matrix room graph itself:
`m.direct` account data, read/written in `lib/matrix.js` as a plain
read-modify-write on `client.getAccountData(type)?.getContent()` +
`client.setAccountData(type, content)`. Folders will follow the same
pattern with a new custom account data type, rather than Matrix's native
per-room `m.tag`/`m.favourite` mechanism — a single blob is simpler to
reorder, rename, and keep folders+pins consistent as one atomic write,
and cross-client interop with other Matrix apps (Element etc.) was
explicitly not a goal (this is the only client this project ships).

The existing right-click precedent is `MessageContextMenu.jsx` (see
`docs/superpowers/specs/2026-09-06-message-context-menu-design.md`) —
cursor-anchored `position: fixed` panel, click-outside + Escape to close,
clamped to viewport via `useLayoutEffect`. `ChatItemContextMenu.jsx`
reuses that exact pattern.

## Goal

Telegram-style folders: user-created tabs above the chat list that show a
manually-curated subset of chats, plus per-folder pinning (a chat can be
pinned in one folder and not another). The chat list itself (in every
folder, including the default "Все чаты") becomes a single
recency-sorted list — the current Каналы/Личные split is removed.

## Scope for this iteration

In scope:
1. Folder CRUD (create/rename/reorder/delete) via a management modal.
2. Manual chat membership per folder (no auto-filters like "unread" /
   "groups only").
3. Per-folder pinning, including the implicit "Все чаты" folder.
4. A horizontal tab strip in the sidebar to switch folders.
5. Right-click (desktop) / long-press (mobile) on a `ChatItem` to
   toggle pin and folder membership without opening the management modal.
6. Flattening every list view (including "Все чаты") to a single
   recency-sorted list, dropping the Каналы/Личные section split.

Explicitly out of scope:
- Auto-filter rules (unread/groups/personal/bots) — manual membership
  only, per user decision.
- Cross-folder drag-and-drop of chats.
- A hard cap on folder count or pinned-chat count.
- Syncing folder edits made concurrently on two devices/tabs beyond
  last-write-wins (same accepted risk as the existing `m.direct` code).
- Any change to how DMs vs. channels are created, named, or avatared —
  only how they're *listed* changes.

## Data model

New account data type `dev.qts.chatFolders`:

```json
{
  "version": 1,
  "folders": [
    {
      "id": "all",
      "name": "Все чаты",
      "order": -1,
      "pinnedRoomIds": ["!abc:messenger.qts.dev"]
    },
    {
      "id": "folder_3f9a...",
      "name": "Работа",
      "order": 0,
      "roomIds": ["!abc:messenger.qts.dev", "!def:messenger.qts.dev"],
      "pinnedRoomIds": ["!def:messenger.qts.dev"]
    }
  ]
}
```

- `id: "all"` is reserved and implicit: always present, always first,
  never renamed/reordered/deleted by the user, has no `roomIds` (its
  membership is "every joined room", computed, not stored) but *does*
  have its own `pinnedRoomIds` like any other folder.
- Every other folder has `roomIds` (manual membership) and
  `pinnedRoomIds` (a subset of `roomIds`, order = pin order, most
  recently pinned first).
- `order` sorts folder tabs left-to-right; `"all"` is exempt (always
  leftmost) so it never needs renumbering.
- A left/forgotten room is not proactively pruned from `roomIds` or
  `pinnedRoomIds` — it's simply filtered out at render time against
  `client.getRooms()`'s current joined set. This avoids extra writes on
  every leave and matches how `categorize()` already discards left rooms
  today.

## `lib/matrix.js` additions

All read-modify-write on the single account data blob, mirroring the
existing `m.direct` helpers:

```js
const FOLDERS_TYPE = 'dev.qts.chatFolders'

function getFoldersRaw(client) {
  const content = client.getAccountData(FOLDERS_TYPE)?.getContent()
  const folders = content?.folders?.filter(f => f.id !== 'all') || []
  const all = content?.folders?.find(f => f.id === 'all')
    || { id: 'all', name: 'Все чаты', order: -1, pinnedRoomIds: [] }
  return { all, folders: folders.sort((a, b) => a.order - b.order) }
}

export function getFolders(client) {
  const { all, folders } = getFoldersRaw(client)
  return [all, ...folders]
}

async function saveFolders(client, all, folders) {
  await client.setAccountData(FOLDERS_TYPE, { version: 1, folders: [all, ...folders] })
}

export async function createFolder(client, name) {
  const { all, folders } = getFoldersRaw(client)
  const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const order = folders.length ? Math.max(...folders.map(f => f.order)) + 1 : 0
  await saveFolders(client, all, [...folders, { id, name, order, roomIds: [], pinnedRoomIds: [] }])
  return id
}

export async function renameFolder(client, folderId, name) { /* map + save */ }
export async function deleteFolder(client, folderId) { /* filter out + save */ }
export async function reorderFolders(client, orderedIds) { /* re-assign order 0..n + save */ }

export async function setRoomInFolder(client, folderId, roomId, inFolder) {
  // adds/removes roomId from that folder's roomIds; if removing and the
  // room was pinned there, also drops it from pinnedRoomIds
}

export async function setRoomPinned(client, folderId, roomId, pinned) {
  // adds/removes roomId from that folder's (or "all"'s) pinnedRoomIds
  // unshift on pin (most-recent-first), matching Telegram's own order
}
```

`folderId === 'all'` is handled the same way as any other id in
`setRoomPinned` (writes to the `all` entry) but is rejected early in
`setRoomInFolder`/`renameFolder`/`deleteFolder` (membership in "all" is
implicit, not editable).

## Sidebar changes

### List flattening

`categorize()` is replaced by a single function that, given the active
folder, returns one recency-sorted array:

```js
function roomsForFolder(client, allRooms, folder) {
  const joined = allRooms.filter(r => r.getMyMembership() === 'join')
  const members = folder.id === 'all'
    ? joined
    : joined.filter(r => folder.roomIds?.includes(r.roomId))
  const pinnedSet = new Set(folder.pinnedRoomIds || [])
  const pinned = members.filter(r => pinnedSet.has(r.roomId))
    .sort((a, b) => folder.pinnedRoomIds.indexOf(a.roomId) - folder.pinnedRoomIds.indexOf(b.roomId))
  const rest = members.filter(r => !pinnedSet.has(r.roomId))
    .sort((a, b) => lastActivity(b) - lastActivity(a))
  return [...pinned, ...rest]
}
```

`lastActivity(room)` reuses the same "last real message" scan
`getPreview()` already does (falls back to room creation time if empty).
Each `ChatItem` gets a `type` derived per-room (`isDirectRoom()`, as
today) since the list is no longer pre-split by type, and a new `pinned`
flag to render a pin glyph.

### Folder tab strip

New `Sidebar/FolderTabs.jsx`: horizontal, scrollable, pill-per-folder
(`getFolders(client)` order), active tab highlighted, trailing `+`
button. Selecting a tab sets `activeFolderId` state in `Sidebar`
(defaults to `"all"`). `+` opens the management modal.

### Management modal — `Modals/FoldersModal.jsx`

Lists existing folders (drag-reorder via simple pointer-based reorder,
same weight as the existing pattern used nowhere else yet in this
codebase — plain up/down buttons are an acceptable fallback if drag adds
too much risk) with rename (inline edit) and delete (with confirm, same
`Modal`-based confirm pattern `MessageBubble`'s delete already uses).
"Создать папку" → name input, then a searchable checklist of all joined
rooms (reusing `SearchResults`-style filtering, not that component
directly) to seed initial `roomIds`.

### Chat item context menu — `Sidebar/ChatItemContextMenu.jsx`

Same positioning/dismiss code as `MessageContextMenu.jsx`. Props:
`{ room, activeFolderId, folders, position, onClose }`. Contents:
- "Закрепить" / "Открепить" (toggles pin in `activeFolderId`) — first
  row, always present.
- Divider.
- One row per non-"all" folder: label + checkmark if `room.roomId` is in
  that folder's `roomIds`, click toggles via `setRoomInFolder`.
- "Создать папку..." — opens `FoldersModal` pre-seeded with this room.

`ChatItem.jsx` gains `onContextMenu`, wired in `Sidebar` the same way
`MessageBubble` wires its own context menu (local `contextMenu` state
holding `{ room, x, y }`).

## Error handling

`setAccountData` calls follow the same convention as every existing
account-data write in this file (`joinAndRegisterDirect`,
`createOrGetDirectMessage`): wrapped in `try`/`catch`, logged via
`console.error`, no user-facing error surfaced for what's a low-stakes,
rare failure (a folder edit not persisting is annoying, not
data-destructive — the user just retries). `FoldersModal`'s create/
rename/delete actions show a lightweight inline error string on failure,
matching `ContactsModal`'s existing `error` state pattern.

## Testing

No automated test framework in `client/` (project convention). Manual,
via two accounts on `scripts/dev/local-test-synapse.sh`:
- Create a folder, add 2-3 chats via the management modal's checklist,
  confirm the tab appears and shows only those chats, sorted by recency.
- Right-click a chat in "Все чаты", add it to a folder via the context
  menu, switch to that folder's tab, confirm it appears.
- Right-click a chat inside a custom folder, remove it, confirm it
  disappears from that folder's tab but stays in "Все чаты".
- Pin a chat in "Все чаты", confirm it floats to the top there; switch to
  a folder that also contains that chat, confirm it's *not* pinned there
  (per-folder pin independence); pin it there too, confirm both pins
  persist independently after a page reload (account data round-trip).
- Rename a folder, reorder two folders (tab order updates), delete a
  folder (its tab disappears, member chats remain untouched in "Все
  чаты" and any other folder they belonged to).
- Leave/archive a chat that was in a folder, confirm it silently drops
  out of that folder's view without needing a folder edit.
- Reload the page after all the above, confirm folders/membership/pins
  all survive (account data persisted correctly).
- Confirm no console errors throughout.
