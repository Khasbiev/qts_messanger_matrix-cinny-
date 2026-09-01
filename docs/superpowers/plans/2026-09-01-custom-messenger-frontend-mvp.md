# Custom Messenger Frontend MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing (uncommitted) `client/` React + `matrix-js-sdk` frontend into a usable test stand by adding chat creation, file upload, and a fix for DM/channel misclassification.

**Architecture:** All changes are additive on top of the existing `client/` scaffold (Vite + React 18 + `matrix-js-sdk` + `@tabler/icons-react`, no state library, no router). New UI is two modal dialogs sharing one `UserPicker` component; new backend calls are added as plain functions in the existing `lib/matrix.js` singleton-client module. No new dependencies are introduced.

**Tech Stack:** React 18, Vite, matrix-js-sdk 34.13.0, @tabler/icons-react. No test framework (see Global Constraints).

## Global Constraints

- Visual style must reuse the existing CSS variables in `client/src/styles/variables.css` (`--bg-primary #0C0C0E`, `--bg-surface #111113`, `--bg-card #1A1A1C`, `--accent-teal #00E5B0`, `--accent-orange #FF6B35`, `--text-primary #FFFFFF`, `--text-secondary #AAAAAA`, `--text-muted #555555`, `--border #1E1E20`) — do not hardcode different colors.
- No test framework is configured and none is to be added — verification is manual, via a disposable local Synapse instance driven through a real browser. See "Verification approach" in the design spec (`docs/superpowers/specs/2026-09-01-custom-messenger-frontend-mvp-design.md`).
- Channels are always created private (`visibility: 'private'`, `preset: 'private_chat'`) — never public/discoverable.
- Do not touch the production Matrix server (`matrix.messanger.qts.dev`) at any point in Tasks 1–5. Task 6 (production config change) requires explicit user go-ahead before it is executed — it is written up here but must not be run automatically.
- All new UI text is in Russian, matching the existing app.

---

## Task 1: Local test Synapse harness + first commit of `client/`

Sets up a reusable, disposable local Matrix server for manually verifying every subsequent task in a real browser, without ever touching production. Also produces the first-ever commit of `client/` (currently entirely untracked), since there's no prior commit to build on top of.

**Files:**
- Create: `scripts/dev/local-test-synapse.sh`
- Modify: `.gitignore` (add `.local-test-synapse/`)

**Interfaces:**
- Produces: `scripts/dev/local-test-synapse.sh {start|stop|reset|seed}` — a CLI used by every later task's verification steps. `start` brings up Synapse on `http://localhost:8008` with open registration and a full user directory (local-only settings, never applied to prod config). `seed` registers `tester1` / `tester2` (password `TestPass123!`) and prints their `user_id`/`access_token`/`device_id` as JSON. `stop` removes the container. `reset` wipes all local test data.

- [ ] **Step 1: Write the harness script**

Create `scripts/dev/local-test-synapse.sh`:

```bash
#!/bin/bash
# Disposable local Matrix Synapse for manual UI verification during development.
# Never touches production. Data lives in .local-test-synapse/ (gitignored).
set -e
export MSYS_NO_PATHCONV=1   # avoids Git-Bash-on-Windows mangling of -v /data paths

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$SCRIPT_DIR/.local-test-synapse"
DATA_DIR="$TEST_DIR/data"
CONTAINER=qts-test-synapse
IMAGE=matrixdotorg/synapse:latest
PORT=8008

cmd="${1:-start}"

case "$cmd" in
  start)
    mkdir -p "$DATA_DIR"
    if [ ! -f "$DATA_DIR/homeserver.yaml" ]; then
      echo "Generating local Synapse config..."
      docker run --rm -v "$DATA_DIR:/data" \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        "$IMAGE" generate
      cat >> "$DATA_DIR/homeserver.yaml" <<'YAML'
enable_registration: true
enable_registration_without_verification: true
user_directory:
  search_all_users: true
YAML
    fi
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER" -p "$PORT:8008" -v "$DATA_DIR:/data" "$IMAGE" >/dev/null
    echo "Waiting for Synapse to be ready..."
    for i in $(seq 1 30); do
      if curl -s -o /dev/null "http://localhost:$PORT/_matrix/client/versions"; then
        echo "Synapse ready at http://localhost:$PORT"
        exit 0
      fi
      sleep 1
    done
    echo "Synapse did not become ready in time" >&2
    exit 1
    ;;
  stop)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    echo "Stopped."
    ;;
  reset)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
    echo "Data wiped. Run 'start' again for a fresh server."
    ;;
  seed)
    for u in tester1 tester2; do
      curl -s -X POST "http://localhost:$PORT/_matrix/client/v3/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$u\",\"password\":\"TestPass123!\",\"auth\":{\"type\":\"m.login.dummy\"}}"
      echo
    done
    ;;
  *)
    echo "Usage: $0 {start|stop|reset|seed}" >&2
    exit 1
    ;;
esac
```

Make it executable: `chmod +x scripts/dev/local-test-synapse.sh`

- [ ] **Step 2: Add the test data directory to `.gitignore`**

Append to `.gitignore`:

```
.local-test-synapse/
```

- [ ] **Step 3: Run it and verify manually**

```bash
bash scripts/dev/local-test-synapse.sh start
bash scripts/dev/local-test-synapse.sh seed
```

Expected: `start` prints `Synapse ready at http://localhost:8008`. `seed` prints two JSON blobs, each with a `user_id` like `@tester1:localhost` and an `access_token`. Then:

```bash
bash scripts/dev/local-test-synapse.sh stop
bash scripts/dev/local-test-synapse.sh start
```

Expected: second `start` skips config generation ("Generating..." line does not print again) and still becomes ready — confirms the harness is idempotent/reusable across the rest of this plan.

- [ ] **Step 4: Commit**

This is the first commit that includes `client/` at all — it has been untracked since it was created. Stage everything currently untracked/modified under `client/` plus the new harness script and gitignore change:

```bash
git add client/ scripts/dev/local-test-synapse.sh .gitignore
git commit -m "Add client/ frontend scaffold and local Synapse test harness

client/ is a React + matrix-js-sdk frontend (login, room list, real-time
send/receive) that was already working but never committed. Adds a
reusable disposable-Synapse script for manually verifying the chat
creation, file upload, and categorization work that follows."
```

---

## Task 2: Fix DM/channel categorization

`Sidebar/index.jsx`'s `categorize()` currently treats any room with exactly 2 joined members as a DM. This misclassifies a 2-person private channel. Replace it with the Matrix-native signal: a room is a DM if and only if its ID appears in the user's `m.direct` account data.

**Files:**
- Modify: `client/src/components/Sidebar/index.jsx`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: nothing consumed by other tasks directly, but Task 3 relies on this categorization being account-data-driven to prove the new DM flow works correctly.

- [ ] **Step 1: Replace the categorization logic and listen for account data changes**

Replace the full contents of `client/src/components/Sidebar/index.jsx` with:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { IconSearch, IconPlus } from '@tabler/icons-react'
import { ClientEvent, RoomEvent } from 'matrix-js-sdk'
import ChatItem from './ChatItem'
import UserFooter from './UserFooter'

function categorize(client, rooms) {
  const directRoomIds = new Set(
    Object.values(client.getAccountData('m.direct')?.getContent() || {}).flat()
  )
  const channels = []
  const dms = []
  for (const room of rooms) {
    if (directRoomIds.has(room.roomId)) {
      dms.push(room)
    } else {
      channels.push(room)
    }
  }
  return { channels, dms }
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout }) {
  const [rooms, setRooms] = useState(() => categorize(client, client.getRooms()))

  const refresh = useCallback(() => {
    setRooms(categorize(client, client.getRooms()))
  }, [client])

  useEffect(() => {
    client.on(ClientEvent.Sync, refresh)
    client.on(RoomEvent.MyMembership, refresh)
    client.on(ClientEvent.AccountData, refresh)
    return () => {
      client.off(ClientEvent.Sync, refresh)
      client.off(RoomEvent.MyMembership, refresh)
      client.off(ClientEvent.AccountData, refresh)
    }
  }, [client, refresh])

  return (
    <div style={{
      width: '240px',
      flexShrink: 0,
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      borderRight: '1px solid var(--border)',
    }}>
      {/* Logo */}
      <div style={{ height: '52px', padding: '0 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '17px', fontWeight: 700, color: 'var(--accent-teal)', marginRight: '1px' }}>{'>'}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>qts.dev</span>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 10px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px' }}>
          <IconSearch size={13} color="var(--text-muted)" strokeWidth={2} />
          <input placeholder="Поиск..." style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '13px' }} />
        </div>
      </div>

      {/* Room list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        {rooms.channels.length > 0 && (
          <>
            <SectionHeader label="КАНАЛЫ" />
            {rooms.channels.map(room => (
              <ChatItem
                key={room.roomId}
                item={{ id: room.roomId, name: room.name, unread: room.getUnreadNotificationCount() }}
                type="channel"
                isActive={activeRoom?.roomId === room.roomId}
                onSelect={() => onRoomSelect(room)}
              />
            ))}
          </>
        )}

        {rooms.dms.length > 0 && (
          <>
            <SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} />
            {rooms.dms.map(room => {
              const other = room.getJoinedMembers().find(m => m.userId !== client.getUserId())
              const name = other?.name || room.name
              return (
                <ChatItem
                  key={room.roomId}
                  item={{ id: room.roomId, name, avatar: name.slice(0, 2).toUpperCase(), online: false, unread: room.getUnreadNotificationCount() }}
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

      <UserFooter client={client} onLogout={onLogout} />
    </div>
  )
}

function SectionHeader({ label, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 4px', ...style }}>
      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', userSelect: 'none' }}>{label}</span>
      <button
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

(This step only changes `categorize()` and the `useEffect` listener list — the `+` buttons stay inert for now, they're wired in Tasks 3 and 4.)

- [ ] **Step 2: Verify manually**

```bash
bash scripts/dev/local-test-synapse.sh reset
bash scripts/dev/local-test-synapse.sh start
bash scripts/dev/local-test-synapse.sh seed
```

Copy `tester1`'s `access_token` from the seed output, then create a 2-person **named channel** without `is_direct` (reproduces the old bug):

```bash
TOKEN1="<tester1 access_token from seed output>"
curl -s -X POST http://localhost:8008/_matrix/client/v3/createRoom \
  -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" \
  -d '{"name":"тест-канал","preset":"private_chat","invite":["@tester2:localhost"]}'
```

Start the frontend dev server (`cd client && npm run dev`, serves on `http://localhost:3000`), open it in a browser, log in as `tester1` (server `http://localhost:8008`, password `TestPass123!`).

Expected: "тест-канал" appears under **КАНАЛЫ** with a `#` icon — not under ЛИЧНЫЕ СООБЩЕНИЯ. This is the bug fix confirmed.

Now set `m.direct` for that same room via the API to confirm the DM path still works:

```bash
curl -s -X PUT "http://localhost:8008/_matrix/client/v3/user/%40tester1%3Alocalhost/account_data/m.direct" \
  -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" \
  -d '{"@tester2:localhost":["<room_id from createRoom response>"]}'
```

Refresh the browser tab. Expected: the room now moves to ЛИЧНЫЕ СООБЩЕНИЯ.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Sidebar/index.jsx
git commit -m "Fix DM/channel categorization to use m.direct account data

Previously any room with exactly 2 joined members was shown as a DM,
which misclassified 2-person private channels. Now classification is
driven by m.direct account data, the Matrix-native signal."
```

---

## Task 3: New direct message flow

Adds a "New DM" modal reachable from the ЛИЧНЫЕ СООБЩЕНИЯ section's `+` button: search the user directory, pick one person, and either open the existing DM with them or create a new one (setting `m.direct` correctly, which Task 2's categorization then picks up).

**Files:**
- Create: `client/src/components/Modals/Modal.jsx`
- Create: `client/src/components/Modals/UserPicker.jsx`
- Create: `client/src/components/Modals/NewDmModal.jsx`
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/components/Sidebar/index.jsx`

**Interfaces:**
- Consumes: `categorize()` behavior from Task 2 (DM shows up correctly once `m.direct` is set).
- Produces:
  - `lib/matrix.js`: `searchUsers(term: string): Promise<Array<{user_id, display_name, avatar_url}>>`, `createOrGetDirectMessage(userId: string): Promise<string>` (returns roomId), `waitForRoom(roomId: string, timeoutMs?: number): Promise<Room>`.
  - `Modal.jsx`: `<Modal title={string} onClose={fn} footer={node}>{children}</Modal>` — used by both this task's `NewDmModal` and Task 4's `NewChannelModal`.
  - `UserPicker.jsx`: `<UserPicker mode={'single'|'multi'} selectedIds={string[]} onChange={fn(string[])} />` — reused as-is (multi mode) by Task 4.

- [ ] **Step 1: Add `searchUsers`, `createOrGetDirectMessage`, `waitForRoom` to `lib/matrix.js`**

Append to `client/src/lib/matrix.js` (after the existing `sendMessage` function):

```js
export async function searchUsers(term) {
  if (!_client) throw new Error('Not connected')
  if (!term.trim()) return []
  const { results } = await _client.searchUserDirectory({ term, limit: 50 })
  return results.filter(u => u.user_id !== _client.getUserId())
}

export async function createOrGetDirectMessage(userId) {
  if (!_client) throw new Error('Not connected')
  const directContent = _client.getAccountData('m.direct')?.getContent() || {}
  const existing = directContent[userId]?.[0]
  if (existing && _client.getRoom(existing)) {
    return existing
  }

  const { room_id } = await _client.createRoom({
    is_direct: true,
    visibility: 'private',
    preset: 'private_chat',
    invite: [userId],
  })

  const updated = { ...directContent, [userId]: [...(directContent[userId] || []), room_id] }
  await _client.setAccountData('m.direct', updated)

  return room_id
}

export function waitForRoom(roomId, timeoutMs = 5000) {
  if (!_client) throw new Error('Not connected')
  return new Promise((resolve, reject) => {
    const existing = _client.getRoom(roomId)
    if (existing) { resolve(existing); return }
    const start = Date.now()
    const interval = setInterval(() => {
      const room = _client.getRoom(roomId)
      if (room) {
        clearInterval(interval)
        resolve(room)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval)
        reject(new Error('Room did not appear in time'))
      }
    }, 200)
  })
}
```

- [ ] **Step 2: Create `Modal.jsx`**

Create `client/src/components/Modals/Modal.jsx`:

```jsx
import { useEffect } from 'react'
import { IconX } from '@tabler/icons-react'

export default function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '380px', maxWidth: '90vw', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', display: 'flex' }}>
            <IconX size={16} />
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>{footer}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `UserPicker.jsx`**

Create `client/src/components/Modals/UserPicker.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { searchUsers } from '../../lib/matrix'

export default function UserPicker({ mode = 'single', selectedIds, onChange }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!term.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const users = await searchUsers(term)
        setResults(users)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [term])

  const toggle = (userId) => {
    if (mode === 'single') {
      onChange([userId])
      return
    }
    const isSelected = selectedIds.includes(userId)
    onChange(isSelected ? selectedIds.filter(id => id !== userId) : [...selectedIds, userId])
  }

  return (
    <div>
      <input
        value={term}
        onChange={e => setTerm(e.target.value)}
        placeholder="Поиск пользователя..."
        style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ marginTop: '10px', maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {loading && <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Поиск...</div>}
        {!loading && term.trim() && results.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Никого не найдено</div>
        )}
        {results.map(u => {
          const isSelected = selectedIds.includes(u.user_id)
          const label = u.display_name || u.user_id
          return (
            <div
              key={u.user_id}
              onClick={() => toggle(u.user_id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer', background: isSelected ? 'var(--bg-card)' : 'transparent' }}
            >
              <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: isSelected ? 'var(--accent-teal)' : 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: isSelected ? '#000' : 'var(--text-secondary)', flexShrink: 0 }}>
                {label.replace('@', '').slice(0, 2).toUpperCase()}
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              {isSelected && <span style={{ color: 'var(--accent-teal)', fontSize: '13px' }}>✓</span>}
            </div>
          )
        })}
      </div>
      {mode === 'multi' && selectedIds.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Выбрано: {selectedIds.length}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `NewDmModal.jsx`**

Create `client/src/components/Modals/NewDmModal.jsx`:

```jsx
import { useState } from 'react'
import Modal from './Modal'
import UserPicker from './UserPicker'
import { createOrGetDirectMessage } from '../../lib/matrix'

export default function NewDmModal({ onClose, onCreated }) {
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (selected.length === 0) return
    setLoading(true)
    setError('')
    try {
      const roomId = await createOrGetDirectMessage(selected[0])
      onCreated(roomId)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось создать чат')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Новое личное сообщение"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
          <button
            onClick={handleSubmit}
            disabled={selected.length === 0 || loading}
            style={{ padding: '8px 14px', borderRadius: '7px', background: selected.length ? 'var(--accent-teal)' : 'var(--bg-card)', color: selected.length ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {loading ? 'Создание...' : 'Начать чат'}
          </button>
        </>
      }
    >
      <UserPicker mode="single" selectedIds={selected} onChange={setSelected} />
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
```

- [ ] **Step 5: Wire the ЛИЧНЫЕ СООБЩЕНИЯ `+` button in `Sidebar/index.jsx`**

Apply these changes to `client/src/components/Sidebar/index.jsx` (from the version left by Task 2):

Add imports at the top, after the `UserFooter` import:

```jsx
import NewDmModal from '../Modals/NewDmModal'
import { waitForRoom } from '../../lib/matrix'
```

Inside `Sidebar(...)`, add state right after the `refresh` callback:

```jsx
  const [showNewDm, setShowNewDm] = useState(false)

  const handleCreated = async (roomId) => {
    setShowNewDm(false)
    try {
      const room = await waitForRoom(roomId)
      refresh()
      onRoomSelect(room)
    } catch {
      refresh()
    }
  }
```

Change the DM section header call from:

```jsx
<SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} />
```

to:

```jsx
<SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} onClick={() => setShowNewDm(true)} />
```

Also add an unconditional DM entry point even when the list is empty — replace the block:

```jsx
        {rooms.dms.length > 0 && (
          <>
            <SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} onClick={() => setShowNewDm(true)} />
```

with:

```jsx
        <SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} onClick={() => setShowNewDm(true)} />
        {rooms.dms.length > 0 && (
          <>
```

(i.e. move the header outside the `rooms.dms.length > 0` guard so the `+` button is always reachable; leave the `.map(...)` and the closing `</>` exactly where they are.)

Right before the final closing `</div>` of the component's returned JSX (after `<UserFooter .../>`), add:

```jsx
      {showNewDm && (
        <NewDmModal onClose={() => setShowNewDm(false)} onCreated={handleCreated} />
      )}
```

Update `SectionHeader` to accept and use `onClick`:

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

- [ ] **Step 6: Verify manually**

```bash
bash scripts/dev/local-test-synapse.sh reset
bash scripts/dev/local-test-synapse.sh start
bash scripts/dev/local-test-synapse.sh seed
```

In the browser (`client` dev server running), log in as `tester1`. Click the `+` next to ЛИЧНЫЕ СООБЩЕНИЯ. Type "tester2" in the search box.

Expected: `tester2` appears in the results within ~1s of typing. Click it, click "Начать чат".

Expected: modal closes, a new DM with `tester2` appears selected in the sidebar under ЛИЧНЫЕ СООБЩЕНИЯ (not КАНАЛЫ). Send a message to confirm the room is live (reuses the already-verified send path).

Log out, log in as `tester2` (same server/password). Expected: the same DM appears in `tester2`'s ЛИЧНЫЕ СООБЩЕНИЯ list with the message from `tester1` visible.

Back as `tester1`: open the "New DM" modal again, pick `tester2` again, submit.

Expected: no duplicate room is created — the existing DM opens directly (this exercises the `createOrGetDirectMessage` reuse path).

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Modals client/src/components/Sidebar/index.jsx
git commit -m "Add New DM flow: user directory search + m.direct-aware room creation

Adds a shared Modal/UserPicker foundation, searchUsers/createOrGetDirectMessage/
waitForRoom in lib/matrix.js, and wires the sidebar's + button for
ЛИЧНЫЕ СООБЩЕНИЯ to open it."
```

---

## Task 4: New channel flow

Adds a "New channel" modal reachable from the КАНАЛЫ section's `+` button, reusing `Modal` and `UserPicker` (multi-select mode) from Task 3.

**Files:**
- Create: `client/src/components/Modals/NewChannelModal.jsx`
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/components/Sidebar/index.jsx`

**Interfaces:**
- Consumes: `Modal` and `UserPicker` (`mode="multi"`) from Task 3, `waitForRoom` from Task 3.
- Produces: `lib/matrix.js`: `createChannel({ name: string, topic?: string, inviteUserIds: string[] }): Promise<string>` (returns roomId).

- [ ] **Step 1: Add `createChannel` to `lib/matrix.js`**

Append to `client/src/lib/matrix.js`:

```js
export async function createChannel({ name, topic, inviteUserIds }) {
  if (!_client) throw new Error('Not connected')
  const { room_id } = await _client.createRoom({
    name,
    topic: topic || undefined,
    visibility: 'private',
    preset: 'private_chat',
    invite: inviteUserIds,
  })
  return room_id
}
```

- [ ] **Step 2: Create `NewChannelModal.jsx`**

Create `client/src/components/Modals/NewChannelModal.jsx`:

```jsx
import { useState } from 'react'
import Modal from './Modal'
import UserPicker from './UserPicker'
import { createChannel } from '../../lib/matrix'

export default function NewChannelModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = name.trim().length > 0 && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      const roomId = await createChannel({ name: name.trim(), topic: topic.trim(), inviteUserIds: selected })
      onCreated(roomId)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось создать канал')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Новый канал"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ padding: '8px 14px', borderRadius: '7px', background: canSubmit ? 'var(--accent-teal)' : 'var(--bg-card)', color: canSubmit ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Название канала"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
        />
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Тема (необязательно)"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
        />
        <UserPicker mode="multi" selectedIds={selected} onChange={setSelected} />
      </div>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
```

- [ ] **Step 3: Wire the КАНАЛЫ `+` button in `Sidebar/index.jsx`**

Add import:

```jsx
import NewChannelModal from '../Modals/NewChannelModal'
```

Add state next to `showNewDm`:

```jsx
  const [showNewChannel, setShowNewChannel] = useState(false)
```

Generalize `handleCreated` (it's identical for both modals — no change needed to its body, just call it from both). Update the КАНАЛЫ section header:

```jsx
<SectionHeader label="КАНАЛЫ" onClick={() => setShowNewChannel(true)} />
```

Make the КАНАЛЫ header always render too (same pattern as Task 3 did for DMs) — replace:

```jsx
        {rooms.channels.length > 0 && (
          <>
            <SectionHeader label="КАНАЛЫ" onClick={() => setShowNewChannel(true)} />
```

with:

```jsx
        <SectionHeader label="КАНАЛЫ" onClick={() => setShowNewChannel(true)} />
        {rooms.channels.length > 0 && (
          <>
```

Add the modal render next to `NewDmModal`'s:

```jsx
      {showNewChannel && (
        <NewChannelModal onClose={() => setShowNewChannel(false)} onCreated={handleCreated} />
      )}
```

- [ ] **Step 4: Verify manually**

Reuse the running local Synapse from Task 3 (or `reset`/`start`/`seed` again). Log in as `tester1`. Click `+` next to КАНАЛЫ, type a channel name (e.g. "проект-икс"), search and select `tester2`, click "Создать".

Expected: modal closes, "проект-икс" appears under КАНАЛЫ (not ЛИЧНЫЕ СООБЩЕНИЯ) with a `#` icon, and is auto-selected as the active room. Send a message.

Log in as `tester2` in a second browser tab/profile. Expected: "проект-икс" appears under `tester2`'s КАНАЛЫ too, with the message visible.

Also verify empty-invite creation still works: create a second channel with no one selected in `UserPicker`. Expected: channel is created successfully (only the creator is a member), no error.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Modals/NewChannelModal.jsx client/src/components/Sidebar/index.jsx
git commit -m "Add New channel flow, reusing the Modal/UserPicker foundation

Channels are always created private (invite-only) — no public/discoverable
option, per the test-stand privacy requirement."
```

---

## Task 5: File upload with inline image preview

Wires the paperclip button to actually upload files via the Matrix media repo, and renders received images inline instead of as a generic file card.

**Files:**
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/components/Chat/InputArea.jsx`
- Modify: `client/src/components/Chat/MessageList.jsx`
- Modify: `client/src/components/Chat/MessageBubble.jsx`

**Interfaces:**
- Consumes: nothing from Tasks 2–4.
- Produces: `lib/matrix.js`: `uploadFile(roomId: string, file: File): Promise<void>`.

- [ ] **Step 1: Add `uploadFile` to `lib/matrix.js`**

Append to `client/src/lib/matrix.js`:

```js
export async function uploadFile(roomId, file) {
  if (!_client) throw new Error('Not connected')
  const { content_uri: mxcUrl } = await _client.uploadContent(file, { type: file.type })

  const isImage = file.type.startsWith('image/')
  const content = {
    msgtype: isImage ? 'm.image' : 'm.file',
    body: file.name,
    url: mxcUrl,
    info: {
      mimetype: file.type,
      size: file.size,
    },
  }

  if (isImage) {
    const { width, height } = await readImageDimensions(file)
    content.info.w = width
    content.info.h = height
  }

  return _client.sendMessage(roomId, content)
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(objectUrl)
    }
    img.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl
  })
}
```

- [ ] **Step 2: Wire the paperclip button in `InputArea.jsx`**

Replace the full contents of `client/src/components/Chat/InputArea.jsx` with:

```jsx
import { useState, useRef } from 'react'
import {
  IconBold, IconItalic, IconList,
  IconPaperclip, IconMoodSmile, IconAt, IconSend,
} from '@tabler/icons-react'
import { sendMessage, uploadFile } from '../../lib/matrix'

export default function InputArea({ room }) {
  const [value, setValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  const placeholder = `Написать в ${room.name}...`

  const TOOLBAR = [
    { Icon: IconBold,      title: 'Жирный (Ctrl+B)' },
    { Icon: IconItalic,    title: 'Курсив (Ctrl+I)'  },
    { Icon: IconList,      title: 'Список'            },
    null,
    { Icon: IconPaperclip, title: 'Прикрепить файл', onClick: () => fileInputRef.current?.click() },
    { Icon: IconMoodSmile, title: 'Эмодзи'            },
    { Icon: IconAt,        title: 'Упомянуть'         },
  ]

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
      await sendMessage(room.roomId, text)
    } catch (err) {
      console.error('Send failed:', err)
    }
  }

  const handleInput = (e) => {
    setValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      await uploadFile(room.roomId, file)
    } catch (err) {
      setUploadError(err.data?.error || err.message || 'Не удалось загрузить файл')
    } finally {
      setUploading(false)
    }
  }

  const canSend = value.trim().length > 0

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
      <div
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.15s' }}
        onFocusCapture={e => e.currentTarget.style.borderColor = '#2a2a2c'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', gap: '2px', borderBottom: '1px solid var(--border)' }}>
          {TOOLBAR.map((btn, i) =>
            btn === null ? (
              <div key={i} style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
            ) : (
              <button
                key={i}
                title={btn.title}
                onClick={btn.onClick}
                style={{ width: '28px', height: '26px', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'all 0.1s', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <btn.Icon size={15} strokeWidth={2} />
              </button>
            )
          )}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '8px 10px', gap: '8px' }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5', overflowY: 'hidden', minHeight: '22px', maxHeight: '120px', paddingTop: '1px' }}
          />
          <button
            onClick={handleSend}
            style={{
              width: '34px', height: '34px', borderRadius: '8px',
              background: canSend ? 'var(--accent-teal)' : 'rgba(255,255,255,0.05)',
              border: '1px solid ' + (canSend ? 'transparent' : 'var(--border)'),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: canSend ? '#000' : 'var(--text-muted)',
              flexShrink: 0, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (canSend) e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            <IconSend size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: uploadError ? '#ff4d4d' : 'var(--text-muted)', padding: '4px 2px 0', textAlign: 'right' }}>
        {uploadError || (uploading ? 'Загрузка файла...' : 'Enter — отправить · Shift+Enter — новая строка')}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Extend `extractMessages()` in `MessageList.jsx` to recognize files/images**

Replace the full contents of `client/src/components/Chat/MessageList.jsx` with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { RoomEvent } from 'matrix-js-sdk'
import MessageBubble from './MessageBubble'

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const result = []

  for (const ev of events) {
    if (ev.getType() !== 'm.room.message') continue
    const content = ev.getContent()
    if (!content?.body) continue

    const senderId = ev.getSender()
    const member = room.getMember(senderId)
    const name = member?.name || senderId.replace('@', '').split(':')[0]

    const base = {
      id: ev.getId(),
      type: 'message',
      sender: name,
      avatar: name.slice(0, 2).toUpperCase(),
      time: new Date(ev.getTs()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      isOwn: senderId === me,
    }

    if (content.msgtype === 'm.image' && content.url) {
      base.image = {
        url: client.mxcUrlToHttp(content.url),
        name: content.body,
      }
    } else if (content.msgtype === 'm.file' && content.url) {
      base.file = {
        url: client.mxcUrlToHttp(content.url),
        name: content.body,
        ext: (content.body.split('.').pop() || '').toLowerCase(),
        size: formatFileSize(content.info?.size),
      }
    } else {
      base.text = content.body
    }

    result.push(base)
  }

  return result
}

export default function MessageList({ client, room }) {
  const [messages, setMessages] = useState(() => extractMessages(client, room))
  const bottomRef = useRef(null)

  useEffect(() => {
    setMessages(extractMessages(client, room))
  }, [client, room])

  useEffect(() => {
    const onTimeline = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      if (event.getType() !== 'm.room.message') return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => client.off(RoomEvent.Timeline, onTimeline)
  }, [client, room])

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages])

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Сообщений пока нет</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
```

- [ ] **Step 4: Render inline images and wire the download link in `MessageBubble.jsx`**

In `client/src/components/Chat/MessageBubble.jsx`, change the destructuring line:

```jsx
  const { isOwn, sender, avatar, time, text, file, reactions, readBy } = message
```

to:

```jsx
  const { isOwn, sender, avatar, time, text, file, image, reactions, readBy } = message
```

Add an image block right before the existing `{file && ( ... )}` block (inside the bubble `<div>`, after the `{text && (...)}` block):

```jsx
          {image && (
            <div style={{ paddingTop: text ? '8px' : '0' }}>
              <img
                src={image.url}
                alt={image.name}
                style={{ maxWidth: '280px', maxHeight: '280px', borderRadius: '8px', display: 'block', cursor: 'pointer' }}
                onClick={() => window.open(image.url, '_blank')}
              />
            </div>
          )}
```

Replace the inert download `<button>` inside the `{file && ( ... )}` block:

```jsx
              <button
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <IconDownload size={15} strokeWidth={2} />
              </button>
```

with an anchor tag that actually links to the file:

```jsx
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <IconDownload size={15} strokeWidth={2} />
              </a>
```

- [ ] **Step 5: Verify manually**

Reuse or restart the local Synapse (`bash scripts/dev/local-test-synapse.sh reset && start && seed`). Log in as `tester1` in the browser, open (or create, via Task 3's flow) a DM or channel with `tester2`.

Upload an image: click the paperclip icon, pick any small `.png`/`.jpg` file.

Expected: composer shows "Загрузка файла..." briefly, then the image appears inline in the message list (not as a generic file card), clicking it opens the full image in a new tab.

Upload a non-image file (e.g. a `.pdf` or `.txt`): click the paperclip icon again, pick it.

Expected: it appears as a file card with the correct name/size/extension badge, and clicking the download icon opens/downloads the real file (not a dead button).

Log in as `tester2` in a second tab: confirm both the image and the file appear correctly on the receiving side too (this exercises `mxcUrlToHttp` working for a user who didn't upload the content).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Chat/InputArea.jsx client/src/components/Chat/MessageList.jsx client/src/components/Chat/MessageBubble.jsx
git commit -m "Wire file upload: paperclip button, inline image preview, real download links

Uploads go through client.uploadContent() to the Matrix media repo.
Images render inline via mxcUrlToHttp(); other files keep the existing
file-card layout with a working download link instead of a dead button."
```

---

## Task 6: Production backend config for the user directory (requires explicit go-ahead — do not run automatically)

Synapse's `user_directory` only returns users who already share a room with the searcher, unless `search_all_users: true` is set. Without this, `UserPicker` (Tasks 3–4) will work in local testing (where it was set by the harness script) but return empty results against the real production server, since testers won't share any rooms with each other yet when starting their first chat.

**This task must not be executed as part of "implement the plan" — stop here and ask the user explicitly before touching the production VPS, per the spec's Rollout section.**

**Files:**
- Modify: `synapse/homeserver.yaml.template`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (terminal infra task).

- [ ] **Step 1: Add the setting to the template**

In `synapse/homeserver.yaml.template`, after the existing `enable_registration: false` / `registration_shared_secret` block, add:

```yaml
# ─────────────────────────────────────────────
# USER DIRECTORY
# Show all registered users in directory search, not just users who
# already share a room with the searcher — needed so the client's
# "new chat" user picker works before any room exists between two users.
# ─────────────────────────────────────────────
user_directory:
  search_all_users: true
```

- [ ] **Step 2: STOP — ask the user for explicit confirmation**

Do not proceed past this point automatically. Ask the user: "Готов накатить это изменение на прод-Synapse (VPS) и передеплоить контейнер — подтверждаете?" Only continue to Step 3 if they explicitly say yes, in this session, at this point in time.

- [ ] **Step 3 (only after explicit go-ahead): Regenerate and redeploy on the VPS**

This step's exact commands depend on how `scripts/setup.sh` regenerates `synapse/homeserver.yaml` from the template (it does `sed` substitution of `%%VAR%%` placeholders using `.env`, per the existing script) — re-run the relevant part of that script on the VPS, or manually add the same `user_directory: { search_all_users: true }` block to the deployed `synapse/homeserver.yaml`, then:

```bash
docker compose restart synapse
```

- [ ] **Step 4: Verify**

From the deployed frontend (`https://messanger.qts.dev`), log in as two real accounts that don't share a room, open "New DM" or "New channel", search for the other account's username.

Expected: the user appears in the picker.

- [ ] **Step 5: Commit**

```bash
git add synapse/homeserver.yaml.template
git commit -m "Enable full user directory search on Synapse

Needed for the frontend's new-chat user picker to find people before
any room exists between them. search_all_users only affects directory
search results, not room membership or message visibility."
```

---

## Self-review notes

- **Spec coverage:** all three in-scope items (chat creation, file upload, categorization fix) have tasks. The spec's backend dependency (user directory) and rollout ordering (verify locally first, prod change gated on explicit go-ahead, then commit) are both covered by Task 6 and Task 1's commit step.
- **Refinement vs. spec text:** the spec's categorization section mentioned a "fallback to the current member-count heuristic" for rooms without `m.direct` data. Task 2 instead defaults such rooms to **channel**, dropping the member-count heuristic entirely — the heuristic is exactly what caused the bug, and keeping it as a fallback would still misclassify a 2-person channel invited without `is_direct`. Defaulting to channel is strictly more correct and is what Task 2's own verification steps check.
- **Type/name consistency checked:** `waitForRoom`, `createOrGetDirectMessage`, `searchUsers`, `createChannel`, `uploadFile` are each defined once (Tasks 3–5) and referenced with the same names/signatures wherever consumed (`Sidebar/index.jsx`, `NewDmModal.jsx`, `NewChannelModal.jsx`, `InputArea.jsx`).
