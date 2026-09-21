# Chat Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-style folder tabs above the chat list, manual chat membership per folder, per-folder pinning (including the implicit "Все чаты" folder), and a right-click quick-toggle menu on chats — per `docs/superpowers/specs/2026-09-21-chat-folders-design.md`.

**Architecture:** Task 1 flattens the sidebar's existing Каналы/Личные split into one recency-sorted list (no folders yet) — pure groundwork, independently testable. Task 2 adds the folder data layer (`dev.qts.chatFolders` account data, mirroring the existing `m.direct` read-modify-write pattern in `lib/matrix.js`), a folder tab strip, and a management modal (create/rename/reorder/delete + initial chat checklist). Task 3 adds a right-click context menu on chat items for per-folder pin toggling and quick folder-membership toggling, reusing `MessageContextMenu.jsx`'s existing positioning/dismiss pattern.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- Folders are manual-membership only — no auto-filter rules (unread/groups/personal/bots).
- The `"all"` folder id is reserved: always present, always first, never renamed/reordered/deleted by the user, has no editable `roomIds` (its membership is every joined room), but does have its own `pinnedRoomIds`.
- Every write to the folders account data goes through `lib/matrix.js`'s helpers — no component calls `setAccountData('dev.qts.chatFolders', ...)` directly.
- Folder writes follow this codebase's existing account-data error convention: `try`/`catch` + `console.error`, no user-facing error for background writes; modal-driven actions (create/rename/delete folder) show an inline error string, matching `ContactsModal.jsx`'s `error` state pattern.

---

### Task 1: Flatten the chat list into one recency-sorted view

**Files:**
- Modify: `client/src/components/Sidebar/index.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces: `sortedRooms(rooms)` (local to `Sidebar/index.jsx`) — takes `client.getRooms()`'s raw array, returns joined rooms sorted by `room.getLastActiveTimestamp()` descending. Task 2 replaces this function entirely (folded into `roomsForFolder`), so nothing outside this file may depend on its name.

- [ ] **Step 1: Replace `categorize()` with `sortedRooms()` and update state**

In `client/src/components/Sidebar/index.jsx`, find:

```js
function categorize(client, rooms) {
  const channels = []
  const dms = []
  for (const room of rooms) {
    // getRooms() includes rooms we've left (matrix-js-sdk keeps them
    // around locally until forgotten) — left rooms aren't a chat anymore,
    // just leftover history, so they don't belong in the room list.
    if (room.getMyMembership() !== 'join') continue
    if (isDirectRoom(client, room.roomId)) {
      dms.push(room)
    } else {
      channels.push(room)
    }
  }
  return { channels, dms }
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
  const [rooms, setRooms] = useState(() => categorize(client, client.getRooms()))
  const [query, setQuery] = useState('')

  const refresh = useCallback(() => {
    setRooms(categorize(client, client.getRooms()))
  }, [client])

  const [showNewDm, setShowNewDm] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
```

Replace with:

```js
function sortedRooms(rooms) {
  // getRooms() includes rooms we've left (matrix-js-sdk keeps them
  // around locally until forgotten) — left rooms aren't a chat anymore,
  // just leftover history, so they don't belong in the room list.
  return rooms
    .filter(room => room.getMyMembership() === 'join')
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
  const [rooms, setRooms] = useState(() => sortedRooms(client.getRooms()))
  const [query, setQuery] = useState('')

  const refresh = useCallback(() => {
    setRooms(sortedRooms(client.getRooms()))
  }, [client])

  const [showNewDm, setShowNewDm] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewChatMenu, setShowNewChatMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
```

- [ ] **Step 2: Add the `useRef` import (needed by the new dropdown in Step 4)**

Find:

```js
import { useState, useEffect, useCallback } from 'react'
```

Replace with:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
```

- [ ] **Step 3: Replace the two-section room list with a single flat list**

Find:

```jsx
      {query.trim() ? (
        <SearchResults client={client} query={query} onRoomSelect={handleSearchSelect} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
          <SectionHeader label="КАНАЛЫ" onClick={() => setShowNewChannel(true)} />
          {rooms.channels.length > 0 && (
            <>
              {rooms.channels.map(room => {
                const preview = getPreview(room)
                return (
                  <ChatItem
                    key={room.roomId}
                    item={{ id: room.roomId, name: room.name, avatarMxcUrl: room.getMxcAvatarUrl(), unread: room.getUnreadNotificationCount(), preview: preview.text, time: preview.time }}
                    type="channel"
                    isActive={activeRoom?.roomId === room.roomId}
                    onSelect={() => onRoomSelect(room)}
                  />
                )
              })}
            </>
          )}

          <SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} onClick={() => setShowNewDm(true)} />
          {rooms.dms.length > 0 && (
            <>
              {rooms.dms.map(room => {
                const other = room.getJoinedMembers().find(m => m.userId !== client.getUserId())
                const name = other?.name || room.name
                const preview = getPreview(room)
                return (
                  <ChatItem
                    key={room.roomId}
                    item={{ id: room.roomId, name, avatar: name.slice(0, 2).toUpperCase(), avatarMxcUrl: other?.getMxcAvatarUrl(), online: false, unread: room.getUnreadNotificationCount(), preview: preview.text, time: preview.time }}
                    type="dm"
                    isActive={activeRoom?.roomId === room.roomId}
                    onSelect={() => onRoomSelect(room)}
                  />
                )
              })}
            </>
          )}

          {rooms.channels.length === 0 && rooms.dms.length === 0 && (
            <div style={{ padding: '24px 14px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
              Нет доступных комнат
            </div>
          )}
        </div>
      )}
```

Replace with:

```jsx
      {query.trim() ? (
        <SearchResults client={client} query={query} onRoomSelect={handleSearchSelect} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {rooms.map(room => {
            const isDm = isDirectRoom(client, room.roomId)
            const other = isDm ? room.getJoinedMembers().find(m => m.userId !== client.getUserId()) : null
            const name = isDm ? (other?.name || room.name) : room.name
            const preview = getPreview(room)
            return (
              <ChatItem
                key={room.roomId}
                item={{
                  id: room.roomId,
                  name,
                  avatar: isDm ? name.slice(0, 2).toUpperCase() : undefined,
                  avatarMxcUrl: isDm ? other?.getMxcAvatarUrl() : room.getMxcAvatarUrl(),
                  online: false,
                  unread: room.getUnreadNotificationCount(),
                  preview: preview.text,
                  time: preview.time,
                }}
                type={isDm ? 'dm' : 'channel'}
                isActive={activeRoom?.roomId === room.roomId}
                onSelect={() => onRoomSelect(room)}
              />
            )
          })}
          {rooms.length === 0 && (
            <div style={{ padding: '24px 14px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
              Нет доступных комнат
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Add a "+" dropdown for creating a chat/channel (replaces the per-section "+" buttons removed in Step 3), and drop the now-unused `SectionHeader`**

Find:

```jsx
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', minWidth: 0 }}>
          <IconSearch size={13} color="var(--text-muted)" strokeWidth={2} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск..."
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '13px' }}
          />
        </div>
      </div>
```

Replace with:

```jsx
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', minWidth: 0 }}>
          <IconSearch size={13} color="var(--text-muted)" strokeWidth={2} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск..."
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '13px' }}
          />
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowNewChatMenu(v => !v)}
            style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <IconPlus size={17} strokeWidth={2} />
          </button>
          {showNewChatMenu && (
            <NewChatMenu
              onClose={() => setShowNewChatMenu(false)}
              onNewDm={() => { setShowNewChatMenu(false); setShowNewDm(true) }}
              onNewChannel={() => { setShowNewChatMenu(false); setShowNewChannel(true) }}
            />
          )}
        </div>
      </div>
```

Find:

```jsx
function SectionHeader({ label, style, onClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 4px', ...style }}>
      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', userSelect: 'none' }}>{label}</span>
      <button
        onClick={onClick}
        style={{ color: 'var(--text-muted)', display: 'flex', padding: '2px', borderRadius: '3px' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <IconPlus size={13} />
      </button>
    </div>
  )
}
```

Replace with:

```jsx
function NewChatMenu({ onClose, onNewDm, onNewChannel }) {
  const ref = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '38px', right: 0, width: '180px', zIndex: 200,
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}
    >
      <button
        onClick={onNewDm}
        style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-subtle)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        Новый чат
      </button>
      <button
        onClick={onNewChannel}
        style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-subtle)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        Новый канал
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Manual verification**

Setup: `bash scripts/dev/local-test-synapse.sh start` (reuse if already running), `cd client && npm run dev`, log in as `tester1` with at least 2 channels and 2 DMs already existing (create them if needed).

1. Confirm the sidebar shows one flat list — no "КАНАЛЫ"/"ЛИЧНЫЕ СООБЩЕНИЯ" headers — mixing channels and DMs.
2. Confirm the list is sorted by most recent activity: send a message into whichever chat is currently at the bottom (from `tester2`, in another session) and confirm it jumps to the top.
3. Click the "+" button next to the search bar — confirm a small dropdown opens with "Новый чат" and "Новый канал".
4. Click "Новый чат" — confirm the existing `NewDmModal` opens and creating a DM still works and the new room appears in the list. Repeat for "Новый канал" / `NewChannelModal`.
5. Open the "+" dropdown, click elsewhere — confirm it closes. Open it again, press Escape — confirm it closes.
6. Confirm search (typing in the search box) still shows `SearchResults` and is unaffected.
7. Confirm unread badges, avatars, and last-message previews still render correctly for both DMs and channels.
8. Confirm no console errors throughout.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Sidebar/index.jsx
git commit -m "Flatten sidebar chat list into a single recency-sorted view"
```

---

### Task 2: Folder data layer, tab strip, and management modal

**Files:**
- Modify: `client/src/lib/matrix.js`
- Create: `client/src/components/Sidebar/FolderTabs.jsx`
- Create: `client/src/components/Modals/FoldersModal.jsx`
- Modify: `client/src/components/Sidebar/index.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`lib/matrix.js`): `getFolders(): Folder[]` (always `[allFolder, ...customFolders]`, `allFolder.id === 'all'`); `createFolder(name): Promise<string>` (returns new folder id); `renameFolder(folderId, name): Promise`; `deleteFolder(folderId): Promise`; `reorderFolders(orderedIds): Promise`; `setRoomInFolder(folderId, roomId, inFolder): Promise`; `setRoomPinned(folderId, roomId, pinned): Promise`; `roomsForFolder(client, folder): { room: Room, pinned: boolean }[]` (pinned rooms first, in pin order, then the rest by `getLastActiveTimestamp()` descending).
- Consumes (`Sidebar/index.jsx`): all of the above, plus `isDirectRoom` (already imported).
- Produces (`FolderTabs.jsx`): default export `FolderTabs({ folders, activeFolderId, onSelect, onCreateClick })`.
- Produces (`FoldersModal.jsx`): default export `FoldersModal({ client, folders, seedRoomId, onClose, onChanged })` — `onChanged` is called after every successful write so the caller can `refresh()`. Task 3 does not change this component's props.

- [ ] **Step 1: Add folder data helpers to `lib/matrix.js`**

Append at the end of `client/src/lib/matrix.js`:

```js

const FOLDERS_TYPE = 'dev.qts.chatFolders'

function defaultAllFolder() {
  return { id: 'all', name: 'Все чаты', order: -1, pinnedRoomIds: [] }
}

function getFoldersRaw() {
  if (!_client) throw new Error('Not connected')
  const stored = _client.getAccountData(FOLDERS_TYPE)?.getContent()?.folders || []
  const all = stored.find(f => f.id === 'all') || defaultAllFolder()
  const folders = stored.filter(f => f.id !== 'all').sort((a, b) => a.order - b.order)
  return { all, folders }
}

export function getFolders() {
  const { all, folders } = getFoldersRaw()
  return [all, ...folders]
}

async function saveFolders(all, folders) {
  await _client.setAccountData(FOLDERS_TYPE, { version: 1, folders: [all, ...folders] })
}

export async function createFolder(name) {
  const { all, folders } = getFoldersRaw()
  const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const order = folders.length ? Math.max(...folders.map(f => f.order)) + 1 : 0
  await saveFolders(all, [...folders, { id, name, order, roomIds: [], pinnedRoomIds: [] }])
  return id
}

export async function renameFolder(folderId, name) {
  const { all, folders } = getFoldersRaw()
  await saveFolders(all, folders.map(f => (f.id === folderId ? { ...f, name } : f)))
}

export async function deleteFolder(folderId) {
  const { all, folders } = getFoldersRaw()
  await saveFolders(all, folders.filter(f => f.id !== folderId))
}

export async function reorderFolders(orderedIds) {
  const { all, folders } = getFoldersRaw()
  const byId = new Map(folders.map(f => [f.id, f]))
  const reordered = orderedIds
    .filter(id => byId.has(id))
    .map((id, i) => ({ ...byId.get(id), order: i }))
  await saveFolders(all, reordered)
}

// folderId === 'all' is a no-op: membership in "Все чаты" is implicit
// (every joined room), not user-editable.
export async function setRoomInFolder(folderId, roomId, inFolder) {
  if (folderId === 'all') return
  const { all, folders } = getFoldersRaw()
  await saveFolders(all, folders.map(f => {
    if (f.id !== folderId) return f
    const roomIds = inFolder ? [...new Set([...f.roomIds, roomId])] : f.roomIds.filter(id => id !== roomId)
    const pinnedRoomIds = inFolder ? f.pinnedRoomIds : f.pinnedRoomIds.filter(id => id !== roomId)
    return { ...f, roomIds, pinnedRoomIds }
  }))
}

export async function setRoomPinned(folderId, roomId, pinned) {
  const { all, folders } = getFoldersRaw()
  const applyPin = (f) => ({
    ...f,
    pinnedRoomIds: pinned
      ? [roomId, ...f.pinnedRoomIds.filter(id => id !== roomId)]
      : f.pinnedRoomIds.filter(id => id !== roomId),
  })
  if (folderId === 'all') {
    await saveFolders(applyPin(all), folders)
  } else {
    await saveFolders(all, folders.map(f => (f.id === folderId ? applyPin(f) : f)))
  }
}

// A left/forgotten room is not proactively pruned from roomIds/pinnedRoomIds
// - it's simply filtered out here against the current joined set. Avoids an
// extra account-data write on every leave.
export function roomsForFolder(client, folder) {
  const joined = client.getRooms().filter(r => r.getMyMembership() === 'join')
  const members = folder.id === 'all' ? joined : joined.filter(r => folder.roomIds?.includes(r.roomId))
  const pinnedSet = new Set(folder.pinnedRoomIds || [])
  const pinned = (folder.pinnedRoomIds || [])
    .map(id => members.find(r => r.roomId === id))
    .filter(Boolean)
  const rest = members
    .filter(r => !pinnedSet.has(r.roomId))
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
  return [...pinned, ...rest].map(room => ({ room, pinned: pinnedSet.has(room.roomId) }))
}
```

- [ ] **Step 2: Create `Sidebar/FolderTabs.jsx`**

Create `client/src/components/Sidebar/FolderTabs.jsx`:

```jsx
import { IconPlus } from '@tabler/icons-react'

export default function FolderTabs({ folders, activeFolderId, onSelect, onCreateClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px 4px', overflowX: 'auto', flexShrink: 0 }}>
      {folders.map(folder => {
        const active = folder.id === activeFolderId
        return (
          <button
            key={folder.id}
            onClick={() => onSelect(folder.id)}
            style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: '14px', fontSize: '12px', fontWeight: 600,
              whiteSpace: 'nowrap',
              background: active ? 'var(--accent-teal)' : 'var(--bg-card)',
              color: active ? '#000' : 'var(--text-secondary)',
              border: `1px solid ${active ? 'var(--accent-teal)' : 'var(--border)'}`,
            }}
          >
            {folder.name}
          </button>
        )
      })}
      <button
        onClick={onCreateClick}
        style={{ flexShrink: 0, width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <IconPlus size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create `Modals/FoldersModal.jsx`**

Create `client/src/components/Modals/FoldersModal.jsx`:

```jsx
import { useState } from 'react'
import { IconTrash, IconChevronUp, IconChevronDown, IconCheck } from '@tabler/icons-react'
import Modal from './Modal'
import { createFolder, renameFolder, deleteFolder, reorderFolders, setRoomInFolder, isDirectRoom } from '../../lib/matrix'

export default function FoldersModal({ client, folders, seedRoomId, onClose, onChanged }) {
  const [view, setView] = useState(seedRoomId ? 'create' : 'list')
  const realFolders = folders.filter(f => f.id !== 'all')

  if (view === 'create') {
    return (
      <CreateFolderView
        client={client}
        seedRoomId={seedRoomId}
        onBack={seedRoomId ? undefined : () => setView('list')}
        onClose={onClose}
        onCreated={() => { onChanged(); onClose() }}
      />
    )
  }

  return (
    <FolderListView
      realFolders={realFolders}
      onClose={onClose}
      onChanged={onChanged}
      onCreateClick={() => setView('create')}
    />
  )
}

function FolderListView({ realFolders, onClose, onChanged, onCreateClick }) {
  const [error, setError] = useState('')

  const handleReorder = async (index, dir) => {
    const ids = realFolders.map(f => f.id)
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await reorderFolders(ids)
      onChanged()
    } catch (err) {
      setError(err.message || 'Не удалось изменить порядок')
    }
  }

  const handleRename = async (folderId, name) => {
    if (!name.trim()) return
    try {
      await renameFolder(folderId, name.trim())
      onChanged()
    } catch (err) {
      setError(err.message || 'Не удалось переименовать папку')
    }
  }

  const handleDelete = async (folderId) => {
    try {
      await deleteFolder(folderId)
      onChanged()
    } catch (err) {
      setError(err.message || 'Не удалось удалить папку')
    }
  }

  return (
    <Modal title="Папки" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {realFolders.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Папок пока нет</div>
        )}
        {realFolders.map((folder, i) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            canUp={i > 0}
            canDown={i < realFolders.length - 1}
            onUp={() => handleReorder(i, -1)}
            onDown={() => handleReorder(i, 1)}
            onRename={name => handleRename(folder.id, name)}
            onDelete={() => handleDelete(folder.id)}
          />
        ))}
      </div>
      <button
        onClick={onCreateClick}
        style={{ marginTop: '12px', width: '100%', padding: '9px', borderRadius: '7px', background: 'var(--accent-teal)', color: '#000', fontSize: '13px', fontWeight: 600, border: 'none' }}
      >
        Создать папку
      </button>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}

function FolderRow({ folder, canUp, canDown, onUp, onDown, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)

  const commit = () => { setEditing(false); onRename(name) }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px' }}>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setName(folder.name); setEditing(false) }
          }}
          style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
        />
      ) : (
        <span onClick={() => setEditing(true)} style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', cursor: 'text' }}>{folder.name}</span>
      )}
      <button disabled={!canUp} onClick={onUp} style={{ color: canUp ? 'var(--text-secondary)' : 'var(--border)', display: 'flex' }}>
        <IconChevronUp size={15} />
      </button>
      <button disabled={!canDown} onClick={onDown} style={{ color: canDown ? 'var(--text-secondary)' : 'var(--border)', display: 'flex' }}>
        <IconChevronDown size={15} />
      </button>
      <button
        onClick={onDelete}
        style={{ color: 'var(--text-muted)', display: 'flex' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <IconTrash size={15} />
      </button>
    </div>
  )
}

function CreateFolderView({ client, seedRoomId, onBack, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(seedRoomId ? [seedRoomId] : [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const rooms = client.getRooms().filter(r => r.getMyMembership() === 'join')

  const toggle = (roomId) => {
    setSelected(sel => (sel.includes(roomId) ? sel.filter(id => id !== roomId) : [...sel, roomId]))
  }

  const handleSubmit = async () => {
    if (!name.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const folderId = await createFolder(name.trim())
      await Promise.all(selected.map(roomId => setRoomInFolder(folderId, roomId, true)))
      onCreated()
    } catch (err) {
      setError(err.message || 'Не удалось создать папку')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Новая папка"
      onClose={onClose}
      footer={
        <>
          {onBack && <button onClick={onBack} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Назад</button>}
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            style={{ padding: '8px 14px', borderRadius: '7px', background: name.trim() ? 'var(--accent-teal)' : 'var(--bg-card)', color: name.trim() ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </>
      }
    >
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Название папки"
        style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ marginTop: '10px', maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {rooms.map(room => {
          const isDm = isDirectRoom(client, room.roomId)
          const other = isDm ? room.getJoinedMembers().find(m => m.userId !== client.getUserId()) : null
          const label = isDm ? (other?.name || room.name) : room.name
          const isSelected = selected.includes(room.roomId)
          return (
            <div
              key={room.roomId}
              onClick={() => toggle(room.roomId)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer', background: isSelected ? 'var(--bg-card)' : 'transparent' }}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              {isSelected && <IconCheck size={14} color="var(--accent-teal)" />}
            </div>
          )
        })}
      </div>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
```

- [ ] **Step 4: Wire folders into `Sidebar/index.jsx`**

Find:

```js
import { waitForRoom, isDirectRoom } from '../../lib/matrix'
import { formatChatTime } from '../../lib/formatTime'
```

Replace with:

```js
import { waitForRoom, isDirectRoom, getFolders, roomsForFolder } from '../../lib/matrix'
import { formatChatTime } from '../../lib/formatTime'
import FolderTabs from './FolderTabs'
import FoldersModal from '../Modals/FoldersModal'
```

Find:

```js
export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
  const [rooms, setRooms] = useState(() => sortedRooms(client.getRooms()))
  const [query, setQuery] = useState('')

  const refresh = useCallback(() => {
    setRooms(sortedRooms(client.getRooms()))
  }, [client])

  const [showNewDm, setShowNewDm] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewChatMenu, setShowNewChatMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
```

Replace with:

```js
export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
  const [folders, setFolders] = useState(() => getFolders())
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [query, setQuery] = useState('')

  // getFolders() always returns fresh array/object references, so storing
  // its result is enough to force a re-render on every relevant client
  // event below - no separate "tick" state needed.
  const refresh = useCallback(() => {
    setFolders(getFolders())
  }, [])

  // Falls back to folders[0] (always "all") if the active folder was just
  // deleted elsewhere (e.g. via FoldersModal) - see FoldersModal Step 1.
  const activeFolder = folders.find(f => f.id === activeFolderId) || folders[0]
  const rooms = roomsForFolder(client, activeFolder)

  const [showNewDm, setShowNewDm] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewChatMenu, setShowNewChatMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [foldersModal, setFoldersModal] = useState(null) // null | { seedRoomId?: string }
```

`sortedRooms` (Task 1) is no longer called anywhere; leave its declaration in place for now — Task 3 removes it once `roomsForFolder` fully replaces it. (It's dead code for one task's duration, not shipped as a loose end — Task 3 deletes it in the same file.)

Find:

```jsx
      {query.trim() ? (
        <SearchResults client={client} query={query} onRoomSelect={handleSearchSelect} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {rooms.map(room => {
```

Replace with:

```jsx
      {!query.trim() && (
        <FolderTabs
          folders={folders}
          activeFolderId={activeFolderId}
          onSelect={setActiveFolderId}
          onCreateClick={() => setFoldersModal({})}
        />
      )}

      {query.trim() ? (
        <SearchResults client={client} query={query} onRoomSelect={handleSearchSelect} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {rooms.map(({ room }) => {
```

Find:

```jsx
      {showContacts && (
        <ContactsModal onClose={() => setShowContacts(false)} onOpenChat={handleCreated} />
      )}
```

Replace with:

```jsx
      {showContacts && (
        <ContactsModal onClose={() => setShowContacts(false)} onOpenChat={handleCreated} />
      )}
      {foldersModal && (
        <FoldersModal
          client={client}
          folders={folders}
          seedRoomId={foldersModal.seedRoomId}
          onClose={() => setFoldersModal(null)}
          onChanged={refresh}
        />
      )}
```

- [ ] **Step 5: Manual verification**

Setup: `bash scripts/dev/local-test-synapse.sh start` (reuse if already running), `cd client && npm run dev`, log in as `tester1` with at least 3 chats.

1. Confirm a tab strip appears under the search bar with a single "Все чаты" tab (active) and a "+" button, and that it disappears while a search query is typed.
2. Click "+" — confirm the "Папки" modal opens, empty state ("Папок пока нет"), with a "Создать папку" button.
3. Click "Создать папку" — confirm a name field and a checklist of all joined chats appears; type a name, check 2 chats, click "Создать" — confirm the modal closes and a new tab with that name appears.
4. Click the new tab — confirm only the 2 chosen chats show, still sorted by recency (no pins exist yet, so plain recency order).
5. Click "Все чаты" — confirm all chats show again.
6. Reopen the folders modal via "+" — confirm the new folder is listed; click its name, confirm it becomes an editable text field; rename it, press Enter, confirm the tab strip label updates.
7. Create a second folder, use the up/down chevrons to reorder the two folders, confirm tab strip order updates to match.
8. Delete a folder while its tab is the active one — confirm its tab disappears and the view falls back to "Все чаты" without error.
9. Reload the page — confirm folders, names, order, and membership all survive (account data round-trip).
10. Confirm no console errors throughout.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Sidebar/FolderTabs.jsx client/src/components/Modals/FoldersModal.jsx client/src/components/Sidebar/index.jsx
git commit -m "Add chat folders: data layer, tab strip, and management modal"
```

---

### Task 3: Per-chat pin/folder toggle via right-click, and pin indicator

**Files:**
- Modify: `client/src/components/Sidebar/ChatItem.jsx`
- Create: `client/src/components/Sidebar/ChatItemContextMenu.jsx`
- Modify: `client/src/components/Sidebar/index.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: `setRoomInFolder`, `setRoomPinned` from `lib/matrix.js` (Task 2); `roomsForFolder`'s `{ room, pinned }` shape (Task 2).
- Produces (`ChatItem.jsx`): now accepts two new optional props, `pinned` (boolean) and `onContextMenu` (handler called with `{ preventDefault, clientX, clientY }` — either a real right-click event or a synthesized one from a long-press), alongside its existing `item`/`type`/`isActive`/`onSelect`.
- Produces (`ChatItemContextMenu.jsx`): default export `ChatItemContextMenu({ room, folders, pinnedInActive, position, onClose, onTogglePin, onToggleFolder, onCreateFolder })`.

- [ ] **Step 1: Add the pin indicator, right-click, and long-press (touch) support to `ChatItem.jsx`**

Right-click (desktop) and long-press (mobile, per spec) both need to open the same menu, so long-press is synthesized as a call to the same `onContextMenu` prop right-click already uses, with a flag to swallow the `click` that mobile browsers fire right after a long-press's `touchend`.

Find:

```jsx
import { colorFor } from '../../lib/avatarColor'
import Avatar from '../Avatar'

export default function ChatItem({ item, type, isActive, onSelect }) {
  const color = colorFor(item.id)
  const avatarLabel = type === 'channel' ? `#${item.name.slice(0, 1).toUpperCase()}` : item.avatar

  return (
    <div
      onClick={onSelect}
      style={{
```

Replace with:

```jsx
import { useRef } from 'react'
import { IconPinFilled } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import Avatar from '../Avatar'

const LONG_PRESS_MS = 500

export default function ChatItem({ item, type, isActive, pinned, onSelect, onContextMenu }) {
  const color = colorFor(item.id)
  const avatarLabel = type === 'channel' ? `#${item.name.slice(0, 1).toUpperCase()}` : item.avatar
  const longPressTimer = useRef(null)
  const longPressFired = useRef(false)

  const handleTouchStart = (e) => {
    if (!onContextMenu) return
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      onContextMenu({ preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY })
    }, LONG_PRESS_MS)
  }
  const cancelLongPress = () => clearTimeout(longPressTimer.current)
  const handleClick = (e) => {
    // Swallow the click mobile browsers fire right after the touchend that
    // follows a long-press - otherwise the just-opened context menu's
    // target chat would also get selected/navigated to underneath it.
    if (longPressFired.current) { longPressFired.current = false; return }
    onSelect(e)
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      style={{
```

Find:

```jsx
      {/* Time + badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>
        {item.time && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</span>
        )}
        {item.unread > 0 && <Badge count={item.unread} />}
      </div>
```

Replace with:

```jsx
      {/* Time + badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>
        {pinned ? (
          <IconPinFilled size={13} color="var(--text-muted)" />
        ) : item.time && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</span>
        )}
        {item.unread > 0 && <Badge count={item.unread} />}
      </div>
```

- [ ] **Step 2: Create `Sidebar/ChatItemContextMenu.jsx`**

Create `client/src/components/Sidebar/ChatItemContextMenu.jsx`:

```jsx
import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { IconCheck } from '@tabler/icons-react'

function MenuItem({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%',
        padding: '9px 14px', textAlign: 'left', fontSize: '13px', color: 'var(--text-primary)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {children}
    </button>
  )
}

export default function ChatItemContextMenu({ room, folders, pinnedInActive, position, onClose, onTogglePin, onToggleFolder, onCreateFolder }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ top: position.y, left: position.x, visibility: 'hidden' })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    setStyle({ top, left, visibility: 'visible' })
  }, [position])

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const run = (fn) => { fn(); onClose() }
  const realFolders = folders.filter(f => f.id !== 'all')

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', zIndex: 200, ...style,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: '200px', padding: '4px', overflow: 'hidden',
      }}
    >
      <MenuItem onClick={() => run(onTogglePin)}>
        <span>{pinnedInActive ? 'Открепить' : 'Закрепить'}</span>
      </MenuItem>
      {realFolders.length > 0 && <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />}
      {realFolders.map(folder => {
        const inFolder = folder.roomIds?.includes(room.roomId)
        return (
          <MenuItem key={folder.id} onClick={() => run(() => onToggleFolder(folder.id, !inFolder))}>
            <span>{folder.name}</span>
            {inFolder && <IconCheck size={14} color="var(--accent-teal)" />}
          </MenuItem>
        )
      })}
      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
      <MenuItem onClick={() => run(onCreateFolder)}>
        <span>Создать папку...</span>
      </MenuItem>
    </div>
  )
}
```

- [ ] **Step 3: Wire the context menu into `Sidebar/index.jsx`, and remove the now-dead `sortedRooms`**

Find:

```js
import { waitForRoom, isDirectRoom, getFolders, roomsForFolder } from '../../lib/matrix'
```

Replace with:

```js
import { waitForRoom, isDirectRoom, getFolders, roomsForFolder, setRoomInFolder, setRoomPinned } from '../../lib/matrix'
import ChatItemContextMenu from './ChatItemContextMenu'
```

(Note: `import FolderTabs from './FolderTabs'` and `import FoldersModal from '../Modals/FoldersModal'` from Task 2 stay as-is, just add the line above alongside them.)

Find:

```js
function sortedRooms(rooms) {
  // getRooms() includes rooms we've left (matrix-js-sdk keeps them
  // around locally until forgotten) — left rooms aren't a chat anymore,
  // just leftover history, so they don't belong in the room list.
  return rooms
    .filter(room => room.getMyMembership() === 'join')
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
```

Replace with:

```js
export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
```

Find:

```js
  const [foldersModal, setFoldersModal] = useState(null) // null | { seedRoomId?: string }
```

Replace with:

```js
  const [foldersModal, setFoldersModal] = useState(null) // null | { seedRoomId?: string }
  const [contextMenu, setContextMenu] = useState(null) // null | { room, x, y }

  const handleTogglePin = () => {
    if (!contextMenu) return
    const { room } = contextMenu
    const alreadyPinned = activeFolder.pinnedRoomIds?.includes(room.roomId)
    setRoomPinned(activeFolderId, room.roomId, !alreadyPinned).then(refresh).catch(err => console.error('Pin toggle failed:', err))
  }

  const handleToggleFolder = (folderId, inFolder) => {
    if (!contextMenu) return
    setRoomInFolder(folderId, contextMenu.room.roomId, inFolder).then(refresh).catch(err => console.error('Folder toggle failed:', err))
  }
```

Find:

```jsx
          {rooms.map(({ room }) => {
            const isDm = isDirectRoom(client, room.roomId)
            const other = isDm ? room.getJoinedMembers().find(m => m.userId !== client.getUserId()) : null
            const name = isDm ? (other?.name || room.name) : room.name
            const preview = getPreview(room)
            return (
              <ChatItem
                key={room.roomId}
                item={{
                  id: room.roomId,
                  name,
                  avatar: isDm ? name.slice(0, 2).toUpperCase() : undefined,
                  avatarMxcUrl: isDm ? other?.getMxcAvatarUrl() : room.getMxcAvatarUrl(),
                  online: false,
                  unread: room.getUnreadNotificationCount(),
                  preview: preview.text,
                  time: preview.time,
                }}
                type={isDm ? 'dm' : 'channel'}
                isActive={activeRoom?.roomId === room.roomId}
                onSelect={() => onRoomSelect(room)}
              />
            )
          })}
```

Replace with:

```jsx
          {rooms.map(({ room, pinned }) => {
            const isDm = isDirectRoom(client, room.roomId)
            const other = isDm ? room.getJoinedMembers().find(m => m.userId !== client.getUserId()) : null
            const name = isDm ? (other?.name || room.name) : room.name
            const preview = getPreview(room)
            return (
              <ChatItem
                key={room.roomId}
                item={{
                  id: room.roomId,
                  name,
                  avatar: isDm ? name.slice(0, 2).toUpperCase() : undefined,
                  avatarMxcUrl: isDm ? other?.getMxcAvatarUrl() : room.getMxcAvatarUrl(),
                  online: false,
                  unread: room.getUnreadNotificationCount(),
                  preview: preview.text,
                  time: preview.time,
                }}
                type={isDm ? 'dm' : 'channel'}
                isActive={activeRoom?.roomId === room.roomId}
                pinned={pinned}
                onSelect={() => onRoomSelect(room)}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ room, x: e.clientX, y: e.clientY }) }}
              />
            )
          })}
```

Find:

```jsx
      {foldersModal && (
        <FoldersModal
          client={client}
          folders={folders}
          seedRoomId={foldersModal.seedRoomId}
          onClose={() => setFoldersModal(null)}
          onChanged={refresh}
        />
      )}
```

Replace with:

```jsx
      {foldersModal && (
        <FoldersModal
          client={client}
          folders={folders}
          seedRoomId={foldersModal.seedRoomId}
          onClose={() => setFoldersModal(null)}
          onChanged={refresh}
        />
      )}
      {contextMenu && (
        <ChatItemContextMenu
          room={contextMenu.room}
          folders={folders}
          pinnedInActive={activeFolder.pinnedRoomIds?.includes(contextMenu.room.roomId)}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onTogglePin={handleTogglePin}
          onToggleFolder={handleToggleFolder}
          onCreateFolder={() => setFoldersModal({ seedRoomId: contextMenu.room.roomId })}
        />
      )}
```

- [ ] **Step 4: Manual verification**

Setup: `bash scripts/dev/local-test-synapse.sh start` (reuse if already running), `cd client && npm run dev`, log in as `tester1` with at least 3 chats and one custom folder already created (from Task 2's verification) containing 2 of them.

1. Right-click a chat in "Все чаты" — confirm a menu opens with "Закрепить" at the top, a divider, one row per custom folder (checkmarked if the chat is already a member), a divider, and "Создать папку...".
2. Click "Закрепить" — confirm the menu closes and the chat now shows a pin icon instead of its timestamp, and floats to the top of "Все чаты" (above unpinned chats, even ones with more recent activity).
3. Switch to the custom folder that also contains this chat — confirm it is NOT shown as pinned there (per-folder pin independence) — no pin icon, ordered by recency.
4. Right-click it in that folder and pin it there too — confirm it's now pinned in both places independently.
5. Right-click a chat and toggle a folder membership row off — confirm the chat disappears from that folder's tab (and, if it was pinned there, its pin is silently dropped too — reopen the context menu on it from "Все чаты" while on that folder's tab is not required, just confirm no crash and it doesn't reappear).
6. Right-click a chat not in any custom folder yet, click a folder row to add it — confirm it now appears in that folder's tab.
7. Right-click a chat, click "Создать папку..." — confirm the "Новая папка" view opens directly (no folder list screen) with this chat pre-checked in the checklist; create it and confirm the chat is a member.
8. Reload the page — confirm both folders' pins and membership survived.
9. Confirm right-click on a chat still lets the browser's native menu stay suppressed only for chats (not for other UI), matches existing message-context-menu UX conventions (click-outside and Escape close it).
10. Using Chrome DevTools' device toolbar (touch emulation) or a real touch device, press and hold a chat for about half a second — confirm the same context menu opens at the touch point, and that releasing afterwards does NOT also select/open that chat underneath the menu. Confirm a normal quick tap still opens the chat as before.
11. Confirm no console errors throughout.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Sidebar/ChatItem.jsx client/src/components/Sidebar/ChatItemContextMenu.jsx client/src/components/Sidebar/index.jsx
git commit -m "Add per-folder chat pinning and a right-click quick-toggle menu"
```
