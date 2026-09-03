# Channel Member Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the chat name/avatar in the header opens an info panel — DM: avatar/name/presence/leave; channel: topic, member list, add/remove members, avatar/topic editing when permitted, leave — per `docs/superpowers/specs/2026-09-03-channel-management-design.md`.

**Architecture:** Task 1 builds the read-mostly info panel (`Modals/ChatInfoModal.jsx`, new) and the leave-chat flow, wired from `Header.jsx` through `Chat/index.jsx` to `App.jsx` (mirroring the existing `onNav` prop-threading pattern). Task 2 extends the same modal file with the permission-gated edit actions (topic, avatar, invite, kick), reusing the existing `UserPicker` (inline, single-select) and `Modal` (nested confirm dialog) components exactly as `NewChannelModal.jsx` and `MessageBubble.jsx`'s delete-confirm already do.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- Every write action (topic/avatar/invite/kick/leave) surfaces its failure inline in the modal, matching `NewChannelModal.jsx`'s error-display convention — not the fire-and-forget `console.error`-only convention used elsewhere for background sends.
- Actions the current user lacks permission for are hidden entirely, never shown disabled or left to fail with a server error.
- No editing of `m.room.name`, no ban/power-level-management UI, no pending-invites view — only what's explicitly in scope.

---

### Task 1: Chat info panel — view + leave

**Files:**
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Chat/index.jsx`
- Modify: `client/src/components/Chat/Header.jsx`
- Create: `client/src/components/Modals/ChatInfoModal.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`lib/matrix.js`): `leaveRoom(roomId): Promise`.
- Produces (`Header.jsx`): now requires an `onLeave` callback prop, threaded from `App.jsx` through `Chat/index.jsx`.
- Produces (`ChatInfoModal.jsx`): `ChatInfoModal({ client, room, onClose, onLeave })` — Task 2 extends this same component in place, so its prop signature stays stable across both tasks.

- [ ] **Step 1: Add `leaveRoom` to `lib/matrix.js`**

Append at the end of the file:

```js

export async function leaveRoom(roomId) {
  if (!_client) throw new Error('Not connected')
  await _client.leave(roomId)
}
```

- [ ] **Step 2: Thread an `onLeave` callback from `App.jsx` down to `Header.jsx`**

In `client/src/App.jsx`, find:

```js
  const handleRoomSelect = (room) => {
    setActiveRoom(room)
    if (isNarrow) setListVisible(false)
  }
```

Insert immediately after it:

```js

  const handleLeaveRoom = () => {
    setActiveRoom(null)
  }
```

Find:

```jsx
      {showChatPane && (
        <Chat key={activeRoom.roomId} client={client} room={activeRoom} navMode={navMode} onNav={handleNav} />
      )}
```

Replace with:

```jsx
      {showChatPane && (
        <Chat key={activeRoom.roomId} client={client} room={activeRoom} navMode={navMode} onNav={handleNav} onLeave={handleLeaveRoom} />
      )}
```

In `client/src/components/Chat/index.jsx`, find:

```jsx
export default function Chat({ client, room, navMode, onNav }) {
```

Replace with:

```jsx
export default function Chat({ client, room, navMode, onNav, onLeave }) {
```

Find:

```jsx
      <Header client={client} room={room} navMode={navMode} onNav={onNav} />
```

Replace with:

```jsx
      <Header client={client} room={room} navMode={navMode} onNav={onNav} onLeave={onLeave} />
```

- [ ] **Step 3: Create `ChatInfoModal.jsx` (view + leave)**

Create `client/src/components/Modals/ChatInfoModal.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { UserEvent } from 'matrix-js-sdk'
import Modal from './Modal'
import { isDirectRoom, leaveRoom } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'

export default function ChatInfoModal({ client, room, onClose, onLeave }) {
  const isDM = isDirectRoom(client, room.roomId)
  const me = client.getUserId()
  const color = colorFor(room.roomId)

  const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
  const name = isDM ? (other?.name || room.name) : room.name
  const avatarLabel = isDM ? name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const members = isDM ? [] : room.getJoinedMembers()

  const [presence, setPresence] = useState(null)
  useEffect(() => {
    if (!isDM || !other) return
    let cancelled = false
    client.getPresence(other.userId)
      .then(status => { if (!cancelled) setPresence(status.presence) })
      .catch(err => console.error('Presence fetch failed:', err))
    const onPresence = (event, user) => {
      if (user.userId !== other.userId) return
      setPresence(user.presence)
    }
    client.on(UserEvent.Presence, onPresence)
    return () => { cancelled = true; client.off(UserEvent.Presence, onPresence) }
  }, [client, isDM, other?.userId])

  const presenceText = presence === 'online' ? 'в сети' : presence === 'unavailable' ? 'отошёл' : 'не в сети'

  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  const handleLeave = async () => {
    setLeaving(true)
    setError('')
    try {
      await leaveRoom(room.roomId)
      onLeave()
      onClose()
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось выйти из чата')
      setLeaving(false)
    }
  }

  return (
    <Modal title={isDM ? 'Информация' : 'О канале'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: color.bg, color: color.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', fontWeight: 700,
          }}>
            {avatarLabel}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
          {isDM && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{presenceText}</div>}
        </div>

        {!isDM && (
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Тема
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px' }}>
              {room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || 'Нет темы'}
            </div>
          </div>
        )}

        {!isDM && (
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Участники ({members.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
              {members.map(m => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                    {m.name}{m.userId === me ? ' (вы)' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleLeave}
          disabled={leaving}
          style={{ padding: '10px 14px', borderRadius: '7px', background: 'rgba(255,77,77,0.1)', color: '#ff4d4d', fontSize: '13px', fontWeight: 600, border: '1px solid rgba(255,77,77,0.3)' }}
        >
          {leaving ? 'Выход...' : 'Выйти из чата'}
        </button>

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Wire the trigger into `Header.jsx`**

Change the top imports. Find:

```jsx
import { useState, useEffect } from 'react'
import { RoomMemberEvent, UserEvent } from 'matrix-js-sdk'
import { IconArrowLeft, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import { isDirectRoom } from '../../lib/matrix'
```

Replace with:

```jsx
import { useState, useEffect } from 'react'
import { RoomMemberEvent, UserEvent } from 'matrix-js-sdk'
import { IconArrowLeft, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import { isDirectRoom } from '../../lib/matrix'
import ChatInfoModal from '../Modals/ChatInfoModal'
```

Find:

```jsx
export default function Header({ client, room, navMode, onNav }) {
```

Replace with:

```jsx
export default function Header({ client, room, navMode, onNav, onLeave }) {
```

Find:

```jsx
  const [presence, setPresence] = useState(null)
```

Insert immediately before it:

```jsx
  const [infoOpen, setInfoOpen] = useState(false)

```

Find the avatar + name block near the end of the render, through the final closing of the header's outer `<div>`:

```jsx
      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: color.bg,
        color: color.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 600,
        flexShrink: 0,
      }}>
        {avatarLabel}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {room.name}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--accent-teal)', marginTop: '1px' }}>
          {subtitle}
        </div>
      </div>

    </div>
  )
}
```

Replace with:

```jsx
      <div
        onClick={() => setInfoOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1, cursor: 'pointer' }}
      >
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: color.bg,
          color: color.fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 600,
          flexShrink: 0,
        }}>
          {avatarLabel}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {room.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--accent-teal)', marginTop: '1px' }}>
            {subtitle}
          </div>
        </div>
      </div>

      {infoOpen && (
        <ChatInfoModal client={client} room={room} onClose={() => setInfoOpen(false)} onLeave={onLeave} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Manual verification**

Setup: `scripts/dev/local-test-synapse.sh start` + `seed` (skip if the container from prior work is already running — `docker ps`; `tester1`/`tester2` already exist), `cd client && npm run dev`, log in as `tester1` and `tester2` in two separate browser sessions/profiles.

1. Click the header name/avatar in a DM — confirm the info modal opens showing the other person's avatar, name, and presence.
2. Click "Выйти из чата" in that DM — confirm it closes, the app returns to the "Выберите канал" empty state, and the DM disappears from the sidebar. Confirm from the other account's side that the room is unaffected (the other user is still in it, just this account left).
3. Open a channel's info modal — confirm it shows the topic ("Нет темы" if unset) and the member list including a "(вы)" marker on your own row.
4. Leave the channel from the info modal — confirm the same empty-state/sidebar-removal behavior.
5. Confirm no console errors throughout.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/matrix.js client/src/App.jsx client/src/components/Chat/index.jsx client/src/components/Chat/Header.jsx client/src/components/Modals/ChatInfoModal.jsx
git commit -m "Add chat info panel with view and leave-chat"
```

---

### Task 2: Editing — topic, avatar, invite, kick

**Files:**
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/components/Modals/ChatInfoModal.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: `ChatInfoModal`'s prop signature from Task 1, unchanged (`{ client, room, onClose, onLeave }`).
- Produces (`lib/matrix.js`): `updateRoomTopic(roomId, topic)`, `updateRoomAvatar(roomId, file)`, `inviteToRoom(roomId, userId)`, `kickFromRoom(roomId, userId)`.

- [ ] **Step 1: Add the four write functions to `lib/matrix.js`**

Append at the end of the file (after `leaveRoom`, added in Task 1):

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
```

- [ ] **Step 2: Replace `ChatInfoModal.jsx` with the full edit-capable version**

Replace the entire contents of `client/src/components/Modals/ChatInfoModal.jsx` (as it stands after Task 1) with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { UserEvent } from 'matrix-js-sdk'
import { IconCamera, IconLoader2, IconPencil, IconPlus } from '@tabler/icons-react'
import Modal from './Modal'
import UserPicker from './UserPicker'
import {
  isDirectRoom, leaveRoom, resolveMediaUrl,
  updateRoomTopic, updateRoomAvatar, inviteToRoom, kickFromRoom,
} from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'

export default function ChatInfoModal({ client, room, onClose, onLeave }) {
  const isDM = isDirectRoom(client, room.roomId)
  const me = client.getUserId()
  const color = colorFor(room.roomId)

  const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
  const name = isDM ? (other?.name || room.name) : room.name
  const avatarLabel = isDM ? name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const members = isDM ? [] : room.getJoinedMembers()

  const myPowerLevel = room.getMember(me)?.powerLevel || 0
  const canEditTopic = !isDM && room.currentState.maySendStateEvent('m.room.topic', me)
  const canEditAvatar = !isDM && room.currentState.maySendStateEvent('m.room.avatar', me)
  const canInvite = !isDM && room.currentState.hasSufficientPowerLevelFor('invite', myPowerLevel)
  const canKick = !isDM && room.currentState.hasSufficientPowerLevelFor('kick', myPowerLevel)

  const [presence, setPresence] = useState(null)
  useEffect(() => {
    if (!isDM || !other) return
    let cancelled = false
    client.getPresence(other.userId)
      .then(status => { if (!cancelled) setPresence(status.presence) })
      .catch(err => console.error('Presence fetch failed:', err))
    const onPresence = (event, user) => {
      if (user.userId !== other.userId) return
      setPresence(user.presence)
    }
    client.on(UserEvent.Presence, onPresence)
    return () => { cancelled = true; client.off(UserEvent.Presence, onPresence) }
  }, [client, isDM, other?.userId])

  const presenceText = presence === 'online' ? 'в сети' : presence === 'unavailable' ? 'отошёл' : 'не в сети'

  const [error, setError] = useState('')

  const [leaving, setLeaving] = useState(false)
  const handleLeave = async () => {
    setLeaving(true)
    setError('')
    try {
      await leaveRoom(room.roomId)
      onLeave()
      onClose()
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось выйти из чата')
      setLeaving(false)
    }
  }

  const [avatarBlobUrl, setAvatarBlobUrl] = useState(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const mxcUrl = room.getMxcAvatarUrl()
    if (!mxcUrl) { setAvatarBlobUrl(null); return }
    let cancelled = false
    let url = null
    resolveMediaUrl(mxcUrl).then(resolved => {
      if (cancelled) { URL.revokeObjectURL(resolved); return }
      url = resolved
      setAvatarBlobUrl(resolved)
    }).catch(() => {})
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [room])

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingAvatar(true)
    setError('')
    try {
      await updateRoomAvatar(room.roomId, file)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось обновить аватар')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const [editingTopic, setEditingTopic] = useState(false)
  const [topicValue, setTopicValue] = useState(() => room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '')
  const [savingTopic, setSavingTopic] = useState(false)

  const handleSaveTopic = async () => {
    setSavingTopic(true)
    setError('')
    try {
      await updateRoomTopic(room.roomId, topicValue.trim())
      setEditingTopic(false)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось обновить тему')
    } finally {
      setSavingTopic(false)
    }
  }

  const [addingMember, setAddingMember] = useState(false)
  const [inviteIds, setInviteIds] = useState([])
  const [inviting, setInviting] = useState(false)

  const handleInvite = async () => {
    if (inviteIds.length === 0) return
    setInviting(true)
    setError('')
    try {
      await Promise.all(inviteIds.map(userId => inviteToRoom(room.roomId, userId)))
      setAddingMember(false)
      setInviteIds([])
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось пригласить участника')
    } finally {
      setInviting(false)
    }
  }

  const [kickTarget, setKickTarget] = useState(null)
  const [kicking, setKicking] = useState(false)

  const handleKick = async () => {
    if (!kickTarget) return
    setKicking(true)
    setError('')
    try {
      await kickFromRoom(room.roomId, kickTarget.userId)
      setKickTarget(null)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось убрать участника')
    } finally {
      setKicking(false)
    }
  }

  return (
    <>
    <Modal title={isDM ? 'Информация' : 'О канале'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <div
              onClick={canEditAvatar ? () => fileInputRef.current?.click() : undefined}
              style={{
                width: '64px', height: '64px', borderRadius: '50%', cursor: canEditAvatar ? 'pointer' : 'default',
                background: avatarBlobUrl ? `center/cover url(${avatarBlobUrl})` : color.bg,
                color: color.fg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', fontWeight: 700, overflow: 'hidden',
              }}
            >
              {!avatarBlobUrl && avatarLabel}
            </div>
            {canEditAvatar && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ position: 'absolute', bottom: 0, right: 0, width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent-teal)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-surface)' }}
                >
                  {uploadingAvatar ? <IconLoader2 size={12} className="spin" /> : <IconCamera size={12} strokeWidth={2.2} />}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
              </>
            )}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
          {isDM && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{presenceText}</div>}
        </div>

        {!isDM && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Тема</span>
              {canEditTopic && !editingTopic && (
                <button onClick={() => setEditingTopic(true)} style={{ color: 'var(--text-muted)', display: 'flex' }}>
                  <IconPencil size={13} />
                </button>
              )}
            </div>
            {editingTopic ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={topicValue}
                  onChange={e => setTopicValue(e.target.value)}
                  style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', outline: 'none' }}
                />
                <button
                  onClick={handleSaveTopic}
                  disabled={savingTopic}
                  style={{ padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, background: 'var(--accent-teal)', color: '#000' }}
                >
                  {savingTopic ? '...' : 'Сохранить'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: topicValue ? 'var(--text-primary)' : 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px' }}>
                {topicValue || 'Нет темы'}
              </div>
            )}
          </div>
        )}

        {!isDM && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Участники ({members.length})</span>
              {canInvite && !addingMember && (
                <button onClick={() => setAddingMember(true)} style={{ color: 'var(--text-muted)', display: 'flex' }}>
                  <IconPlus size={14} />
                </button>
              )}
            </div>

            {addingMember && (
              <div style={{ marginBottom: '10px' }}>
                <UserPicker mode="single" selectedIds={inviteIds} onChange={setInviteIds} />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    onClick={() => { setAddingMember(false); setInviteIds([]) }}
                    style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={inviteIds.length === 0 || inviting}
                    style={{ padding: '8px 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, background: inviteIds.length > 0 ? 'var(--accent-teal)' : 'var(--bg-card)', color: inviteIds.length > 0 ? '#000' : 'var(--text-muted)' }}
                  >
                    {inviting ? 'Отправка...' : 'Пригласить'}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
              {members.map(m => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                    {m.name}{m.userId === me ? ' (вы)' : ''}
                  </span>
                  {canKick && m.userId !== me && (
                    <button onClick={() => setKickTarget(m)} style={{ fontSize: '11px', color: '#ff4d4d' }}>Убрать</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleLeave}
          disabled={leaving}
          style={{ padding: '10px 14px', borderRadius: '7px', background: 'rgba(255,77,77,0.1)', color: '#ff4d4d', fontSize: '13px', fontWeight: 600, border: '1px solid rgba(255,77,77,0.3)' }}
        >
          {leaving ? 'Выход...' : 'Выйти из чата'}
        </button>

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
    {kickTarget && (
      <Modal
        title="Убрать участника?"
        onClose={() => setKickTarget(null)}
        footer={
          <>
            <button onClick={() => setKickTarget(null)} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
            <button onClick={handleKick} disabled={kicking} style={{ padding: '8px 14px', borderRadius: '7px', background: '#ff4d4d', color: '#fff', fontSize: '13px', fontWeight: 600, border: 'none' }}>
              {kicking ? '...' : 'Убрать'}
            </button>
          </>
        }
      >
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Убрать {kickTarget.name} из канала?
        </div>
      </Modal>
    )}
    </>
  )
}
```

- [ ] **Step 3: Manual verification**

Setup as in Task 1 (reuse running Synapse/dev server if still up). Use a channel where `tester1` is the creator (so `tester1` has power level 100) and `tester2` has been invited/joined as a regular member (power level 0).

1. As `tester1` (the creator), open the channel's info modal. Confirm the pencil icon appears next to "Тема", the avatar shows a camera-upload affordance, and a "+" appears next to "Участники".
2. Edit the topic, save, confirm it updates in the modal and (reopen or check as `tester2`) that it's visible to other members too.
3. Upload a channel avatar image, confirm it updates (check `tester2`'s view of the channel header/sidebar icon too, once they reopen or on next sync).
4. Click "+" next to participants, pick a user via the inline picker, click "Пригласить" — confirm the invite goes through (the invited user's auto-join logic, already shipped, should pick it up and add them to the member list on next sync).
5. Click "Убрать" next to `tester2`'s row — confirm the confirm dialog appears, cancel it (nothing happens), then confirm it for real — confirm `tester2` loses access to the channel (their sidebar no longer shows it).
6. As `tester2` (a regular member with no elevated power level), open the same channel's info modal — confirm the topic-edit pencil, avatar camera icon, and "+"/"Убрать" controls are **absent entirely**, not just disabled.
7. Confirm no console errors throughout.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Modals/ChatInfoModal.jsx
git commit -m "Add topic/avatar editing and member invite/kick to chat info panel"
```
