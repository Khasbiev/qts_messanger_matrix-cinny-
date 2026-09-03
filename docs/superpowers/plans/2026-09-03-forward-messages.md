# Forward Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward any message (own or not, text or media) to one or more existing chats from the hover action bar, with a "↪ Переслано от X" label on the receiving end — per `docs/superpowers/specs/2026-09-03-forward-messages-design.md`.

**Architecture:** One vertical slice across the existing message-actions plumbing: `forwardMessage()` in `lib/matrix.js` (sending), `extractMessages()` in `MessageList.jsx` (reading the `dev.qts.forwarded_from` field + stripping its plain-text fallback, mirroring the existing `stripReplyFallback` pattern), a new unconditional button in `MessageActions.jsx`, a new `Modals/ForwardModal.jsx` (multi-select room picker, modeled on `UserPicker.jsx`'s multi-select interaction), and rendering in `MessageBubble.jsx`. This is one cohesive feature, not split by layer, because none of the pieces are independently testable without the others (sending needs somewhere to send to and receive from; receiving needs something to have sent).

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — the test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- Forward target must be an existing chat — no create-and-forward flow.
- No comment field alongside the forward, no chained "forwarded from a forward" labels, no reply-context preservation through a forward.
- `forwardMessage`'s rejection is surfaced in the modal (the user is actively waiting on this action) — unlike the fire-and-forget `console.error`-only convention used elsewhere for background sends.

---

### Task 1: Forward messages end-to-end

**Files:**
- Modify: `client/src/lib/matrix.js`
- Modify: `client/src/components/Chat/MessageList.jsx`
- Modify: `client/src/components/Chat/MessageActions.jsx`
- Modify: `client/src/components/Chat/MessageBubble.jsx`
- Create: `client/src/components/Modals/ForwardModal.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`lib/matrix.js`): `forwardMessage(sourceRoomId, message, targetRoomIds): Promise` where `message` is a message object as built by `extractMessages` (needs `.id`, `.senderId`, `.sender`, `.text`).
- Produces (`MessageList.jsx`): message objects may now carry `forwardedFrom: { sender: string, displayName: string }`.
- Produces (`MessageActions.jsx`): now accepts an optional `onForward` prop, rendered as an unconditional button (always passed by `MessageBubble`, unlike `onEdit`/`onDeleteClick` which stay conditional on `isOwn`).
- Consumes: `getClient()` and `isDirectRoom()` (both already exported from `lib/matrix.js`) — `ForwardModal` uses these directly rather than having `client` prop-drilled through `MessageBubble` (which doesn't currently receive it).

- [ ] **Step 1: Add `forwardMessage` to `lib/matrix.js`**

Open `client/src/lib/matrix.js` and find the end of the `sendReply` function (the last function in the file):

```js
export async function sendReply(roomId, text, replyTo) {
  if (!_client) throw new Error('Not connected')
  const snippet = (replyTo.text || '').slice(0, 200)
  const quoted = snippet
    .split('\n')
    .map((line, i) => (i === 0 ? `> <${replyTo.senderId}> ${line}` : `> ${line}`))
    .join('\n')
  const plainFallback = `${quoted}\n\n${text}`
  const htmlFallback = `<mx-reply><blockquote><a href="https://matrix.to/#/${roomId}/${replyTo.id}">In reply to</a> <a href="https://matrix.to/#/${replyTo.senderId}">${escapeHtml(replyTo.sender)}</a><br />${escapeHtml(snippet)}</blockquote></mx-reply>${escapeHtml(text)}`

  return _client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: plainFallback,
    format: 'org.matrix.custom.html',
    formatted_body: htmlFallback,
    'm.relates_to': { 'm.in_reply_to': { event_id: replyTo.id } },
  })
}
```

Append immediately after it:

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

- [ ] **Step 2: Read `dev.qts.forwarded_from` and strip its fallback prefix in `extractMessages` (`MessageList.jsx`)**

Find the `stripReplyFallback` function near the top of `client/src/components/Chat/MessageList.jsx`:

```js
function stripReplyFallback(body) {
  const separatorIndex = body.indexOf('\n\n')
  return separatorIndex === -1 ? body : body.slice(separatorIndex + 2)
}
```

Insert immediately after it:

```js

// forwardMessage's plain-text body carries a "Переслано от X:\n<text>"
// fallback for clients that don't understand dev.qts.forwarded_from. Strip
// it so the bubble shows only the actual text — the forwarded-from label
// itself is rendered separately, from message.forwardedFrom.
function stripForwardFallback(body) {
  if (!body.startsWith('Переслано от ')) return body
  const separatorIndex = body.indexOf(':\n')
  return separatorIndex === -1 ? body : body.slice(separatorIndex + 2)
}
```

In the same file's `extractMessages`, find:

```js
    const content = ev.getContent()
    if (!content?.body) continue

    if (ev.replyEventId) {
```

Replace with:

```js
    const content = ev.getContent()
    if (!content?.body) continue

    const forwardedFrom = content['dev.qts.forwarded_from']
    if (forwardedFrom?.sender && forwardedFrom?.displayName) {
      base.forwardedFrom = { sender: forwardedFrom.sender, displayName: forwardedFrom.displayName }
    }

    if (ev.replyEventId) {
```

Then find the text-assignment branch:

```js
    } else {
      base.text = base.replyTo ? stripReplyFallback(content.body) : content.body
    }
```

Replace with:

```js
    } else {
      let bodyText = content.body
      if (base.replyTo) bodyText = stripReplyFallback(bodyText)
      if (base.forwardedFrom) bodyText = stripForwardFallback(bodyText)
      base.text = bodyText
    }
```

- [ ] **Step 3: Add the forward button to `MessageActions.jsx`**

In `client/src/components/Chat/MessageActions.jsx`, find:

```jsx
export default function MessageActions({ message, onReact, onReply, onEdit, onDeleteClick }) {
```

Replace with:

```jsx
export default function MessageActions({ message, onReact, onReply, onEdit, onDeleteClick, onForward }) {
```

Find:

```jsx
        {onReply && (
          <ActionButton onClick={onReply} title="Ответить">↩</ActionButton>
        )}
        {onEdit && (
```

Replace with:

```jsx
        {onReply && (
          <ActionButton onClick={onReply} title="Ответить">↩</ActionButton>
        )}
        {onForward && (
          <ActionButton onClick={onForward} title="Переслать">➦</ActionButton>
        )}
        {onEdit && (
```

- [ ] **Step 4: Create `ForwardModal.jsx`**

Create `client/src/components/Modals/ForwardModal.jsx`:

```jsx
import { useState } from 'react'
import Modal from './Modal'
import { getClient, isDirectRoom, forwardMessage } from '../../lib/matrix'

function buildRoomList(client) {
  const me = client.getUserId()
  return client.getRooms()
    .filter(room => room.getMyMembership() === 'join')
    .map(room => {
      const isDM = isDirectRoom(client, room.roomId)
      const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
      const name = isDM ? (other?.name || room.name) : room.name
      return { id: room.roomId, name, isDM }
    })
}

export default function ForwardModal({ message, roomId, onClose }) {
  const client = getClient()
  const [rooms] = useState(() => buildRoomList(client))
  const [selectedIds, setSelectedIds] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const toggle = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const canSend = selectedIds.length > 0 && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setError('')
    try {
      await forwardMessage(roomId, message, selectedIds)
      onClose()
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось переслать сообщение')
      setSending(false)
    }
  }

  return (
    <Modal
      title="Переслать сообщение"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{ padding: '8px 14px', borderRadius: '7px', background: canSend ? 'var(--accent-teal)' : 'var(--bg-card)', color: canSend ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {sending ? 'Отправка...' : 'Переслать'}
          </button>
        </>
      }
    >
      <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {rooms.map(room => {
          const isSelected = selectedIds.includes(room.id)
          return (
            <div
              key={room.id}
              onClick={() => toggle(room.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', borderRadius: '6px', cursor: 'pointer', background: isSelected ? 'var(--bg-card)' : 'transparent' }}
            >
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isSelected ? 'var(--accent-teal)' : 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: isSelected ? '#000' : 'var(--text-secondary)', flexShrink: 0 }}>
                {room.isDM ? room.name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`}
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</span>
              {isSelected && <span style={{ color: 'var(--accent-teal)', fontSize: '13px' }}>✓</span>}
            </div>
          )
        })}
        {rooms.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Нет доступных чатов</div>
        )}
      </div>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
```

- [ ] **Step 5: Wire it all up in `MessageBubble.jsx`**

Change the top imports. Find:

```js
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
```

Replace with:

```js
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

Find:

```jsx
export default function MessageBubble({ message, roomId, onEdit, onReply }) {
  const [hovered, setHovered] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
```

Replace with:

```jsx
export default function MessageBubble({ message, roomId, onEdit, onReply }) {
  const [hovered, setHovered] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
```

Find the `MessageActions` render call:

```jsx
      {hovered && (
        <MessageActions
          message={message}
          onReact={handleReact}
          onReply={() => onReply(message)}
          onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
          onDeleteClick={isOwn ? () => setConfirmOpen(true) : undefined}
        />
      )}
```

Replace with:

```jsx
      {hovered && (
        <MessageActions
          message={message}
          onReact={handleReact}
          onReply={() => onReply(message)}
          onForward={() => setForwardOpen(true)}
          onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
          onDeleteClick={isOwn ? () => setConfirmOpen(true) : undefined}
        />
      )}
```

Find the start of the "Bubble" div's content, where the reply-quote block is rendered:

```jsx
        <div style={{
          background: isOwn ? '#0d3326' : 'var(--bg-card)',
          border: '1px solid ' + (isOwn ? '#1c4535' : 'var(--border)'),
          borderRadius: isOwn ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
          padding: '8px 12px',
        }}>
          {message.replyTo && (
```

Replace with:

```jsx
        <div style={{
          background: isOwn ? '#0d3326' : 'var(--bg-card)',
          border: '1px solid ' + (isOwn ? '#1c4535' : 'var(--border)'),
          borderRadius: isOwn ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
          padding: '8px 12px',
        }}>
          {message.forwardedFrom && (
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: 'var(--accent-teal)' }}>↪</span>
              Переслано от {message.forwardedFrom.displayName}
            </div>
          )}

          {message.replyTo && (
```

Finally, find the delete-confirm `Modal` block near the end of the component:

```jsx
    {confirmOpen && (
      <Modal
        title="Удалить сообщение?"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button onClick={() => setConfirmOpen(false)} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
            <button onClick={handleDelete} style={{ padding: '8px 14px', borderRadius: '7px', background: '#ff4d4d', color: '#fff', fontSize: '13px', fontWeight: 600, border: 'none' }}>Удалить</button>
          </>
        }
      >
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Это действие нельзя отменить.</div>
      </Modal>
    )}
    </>
  )
}
```

Replace with:

```jsx
    {confirmOpen && (
      <Modal
        title="Удалить сообщение?"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button onClick={() => setConfirmOpen(false)} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
            <button onClick={handleDelete} style={{ padding: '8px 14px', borderRadius: '7px', background: '#ff4d4d', color: '#fff', fontSize: '13px', fontWeight: 600, border: 'none' }}>Удалить</button>
          </>
        }
      >
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Это действие нельзя отменить.</div>
      </Modal>
    )}
    {forwardOpen && (
      <ForwardModal message={message} roomId={roomId} onClose={() => setForwardOpen(false)} />
    )}
    </>
  )
}
```

- [ ] **Step 6: Manual verification**

Setup: `scripts/dev/local-test-synapse.sh start` + `seed` (skip if the container from prior work is already running — `docker ps`; `tester1`/`tester2` already exist), `cd client && npm run dev`, log in as `tester1` and `tester2` in two separate browser sessions/profiles.

1. As `tester1`, send a text message in a shared DM with `tester2`. Hover it → click the forward icon (➦) → confirm the "Переслать сообщение" modal opens listing your existing chats (including at least one other than the current DM — a channel, if you have one).
2. Select one chat, confirm the "Переслать" button is enabled only once something is selected, click it → confirm the modal closes and the message appears in the target chat with a "↪ Переслано от <tester1's name>" label above the text, and the text itself matches (no raw "Переслано от X:\n" prefix visible — that's the fallback body, which should be stripped for display).
3. Forward an image or voice message → confirm it plays/displays correctly in the target chat without errors (proves the raw `url`/`info` copy worked, no re-upload needed).
4. Select multiple chats in one forward → confirm the message lands in all of them.
5. As `tester2`, forward one of `tester1`'s messages (not your own) → confirm this works too (forward is available on any message, not just your own) and the label still correctly shows the *original* author (`tester1`), not `tester2` (who did the forwarding).
6. Edit one of your own messages, then forward it → confirm the forwarded copy shows the current (edited) text, not the original pre-edit text.
7. Confirm no console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Chat/MessageList.jsx client/src/components/Chat/MessageActions.jsx client/src/components/Chat/MessageBubble.jsx client/src/components/Modals/ForwardModal.jsx
git commit -m "Add forwarding messages to other chats"
```
