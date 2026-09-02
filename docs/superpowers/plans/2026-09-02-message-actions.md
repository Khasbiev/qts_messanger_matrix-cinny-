# Message Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reply, edit/delete, and reactions to the custom Matrix messenger frontend in `client/`, per `docs/superpowers/specs/2026-09-02-message-actions-design.md`.

**Architecture:** `lib/matrix.js` gains thin senders for each Matrix relation type (`m.annotation` for reactions, `m.replace` for edits, redaction for delete, `m.in_reply_to` for replies). `MessageList.jsx`'s `extractMessages()` folds those relation events onto their target message instead of listing them separately. `MessageBubble.jsx` gets a hover action bar (new `MessageActions.jsx`) and renders the resulting `reactions`/`edited`/`deleted`/`replyTo` fields. Reply/edit composer state is lifted to `Chat/index.jsx` since both `MessageList` and `InputArea` need it; reactions and delete are self-contained (bubble calls `lib/matrix.js` directly via a `roomId` prop).

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, no CSS framework (inline styles + CSS custom properties from `styles/variables.css`), no test framework.

## Global Constraints

- No automated test framework exists in `client/` (`package.json` has only `dev`/`build`/`preview`). Every task's "test" step is manual verification against the disposable local Synapse harness — see "Manual verification setup" below.
- UI copy is Russian, matching all existing strings in the codebase.
- Styling follows the existing convention exactly: inline `style={{...}}` objects using `var(--...)` CSS custom properties from `styles/variables.css`. No new CSS files, no class-name-based styling.
- One reaction per user per message (spec decision) — enforced client-side in `toggleReaction`.
- Edit is restricted to the sender's own `m.text` messages. Delete is restricted to the sender's own messages (any type).
- Deleted messages render as an in-place tombstone ("Сообщение удалено"), never removed from the list.
- Reply quote previews are static (no click-to-scroll) and resolve only against the already-loaded timeline (`room.findEventById`, no network fetch) — falls back to "Исходное сообщение недоступно" if the original isn't loaded.
- Every new/modified exported function in `lib/matrix.js` follows the existing pattern: `if (!_client) throw new Error('Not connected')` as the first line.

## Manual verification setup (do this once, before Task 1)

1. `bash scripts/dev/local-test-synapse.sh start` — brings up a disposable Synapse on `http://localhost:8008` (never touches production).
2. `bash scripts/dev/local-test-synapse.sh seed` — registers `tester1` / `tester2`, password `TestPass123!`.
3. `cd client && npm run dev` — note the URL Vite prints (typically `http://localhost:5173`).
4. Open that URL in two separate browser profiles/windows (e.g. a normal window + an incognito window, so sessions don't share `localStorage`). Log in as `tester1` in one and `tester2` in the other, homeserver field = `http://localhost:8008`.
5. As `tester1`, use the existing "New DM" flow (sidebar → new chat icon) to start a DM with `tester2`, and send one message so both sides have a shared room open before starting Task 1.

Keep both windows open across all four tasks — each task's verification reuses this same DM.

---

### Task 1: Reactions

**Files:**
- Modify: `client/src/lib/matrix.js` (append `sendReaction`, `removeReaction`, `toggleReaction`)
- Modify: `client/src/components/Chat/EmojiPicker.jsx` (accept a `style` override prop)
- Create: `client/src/components/Chat/MessageActions.jsx`
- Modify: `client/src/components/Chat/MessageBubble.jsx` (hover state, mount `MessageActions`, wire reaction pill clicks)
- Modify: `client/src/components/Chat/MessageList.jsx` (`extractMessages` reaction folding, timeline listener filter, pass `roomId`)
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`lib/matrix.js`): `sendReaction(roomId, eventId, emoji): Promise`, `removeReaction(roomId, reactionEventId): Promise`, `toggleReaction(roomId, message, emoji): Promise` where `message` is a message object as built by `extractMessages` (must have `.id` and `.reactions`).
- Produces (`MessageList.jsx`): each message object may now carry `reactions: [{ emoji: string, count: number, reactedByMe: boolean, myEventId: string|null }]`.
- Produces (`MessageActions.jsx`): `MessageActions({ message, onReact, onReply?, onEdit?, onDeleteClick? })` — a hover action bar; `onReply`/`onEdit`/`onDeleteClick` are optional and only render their icon when passed (later tasks pass them).
- Consumes: `EmojiPicker({ onPick, onClose, style? })` (existing, extended with `style`).

- [ ] **Step 1: Add reaction-sending functions to `lib/matrix.js`**

Open `client/src/lib/matrix.js` and find the end of the `waitForRoom` function (the last function in the file). Append immediately after its closing `}`:

```js

export async function sendReaction(roomId, eventId, emoji) {
  if (!_client) throw new Error('Not connected')
  return _client.sendEvent(roomId, 'm.reaction', {
    'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: emoji },
  })
}

export async function removeReaction(roomId, reactionEventId) {
  if (!_client) throw new Error('Not connected')
  return _client.redactEvent(roomId, reactionEventId)
}

export async function toggleReaction(roomId, message, emoji) {
  if (!_client) throw new Error('Not connected')
  const existing = message.reactions?.find(r => r.reactedByMe)
  if (existing && existing.emoji === emoji) {
    return removeReaction(roomId, existing.myEventId)
  }
  if (existing) {
    await removeReaction(roomId, existing.myEventId)
  }
  return sendReaction(roomId, message.id, emoji)
}
```

- [ ] **Step 2: Let `EmojiPicker` accept a position override**

In `client/src/components/Chat/EmojiPicker.jsx`, change the function signature:

```js
export default function EmojiPicker({ onPick, onClose, style }) {
```

And change the outer `<div>`'s `style` prop (currently hardcoded `position/bottom/right/...`) to spread the override last:

```jsx
      style={{
        position: 'absolute',
        bottom: '54px',
        right: '0',
        width: '236px',
        zIndex: 200,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        padding: '8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '2px',
        ...style,
      }}
```

This keeps `InputArea`'s existing usage (no `style` passed) identical, while letting `MessageActions` reposition it.

- [ ] **Step 3: Create `MessageActions.jsx`**

Create `client/src/components/Chat/MessageActions.jsx`:

```jsx
import { useState } from 'react'
import { IconMoodSmile } from '@tabler/icons-react'
import EmojiPicker from './EmojiPicker'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']

function ActionButton({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: '26px', height: '26px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </button>
  )
}

export default function MessageActions({ message, onReact, onReply, onEdit, onDeleteClick }) {
  const [quickOpen, setQuickOpen] = useState(false)
  const [fullPickerOpen, setFullPickerOpen] = useState(false)

  const pick = (emoji) => {
    onReact(emoji)
    setQuickOpen(false)
    setFullPickerOpen(false)
  }

  return (
    <div style={{ position: 'absolute', top: '-16px', right: '8px', zIndex: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '3px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <ActionButton onClick={() => setQuickOpen(v => !v)} title="Реакция">
          <IconMoodSmile size={15} strokeWidth={1.8} />
        </ActionButton>
        {onReply && (
          <ActionButton onClick={onReply} title="Ответить">↩</ActionButton>
        )}
        {onEdit && (
          <ActionButton onClick={onEdit} title="Редактировать">✎</ActionButton>
        )}
        {onDeleteClick && (
          <ActionButton onClick={onDeleteClick} title="Удалить">🗑</ActionButton>
        )}
      </div>

      {quickOpen && (
        <div style={{
          position: 'absolute', top: '32px', right: '0', zIndex: 11,
          display: 'flex', alignItems: 'center', gap: '2px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {QUICK_REACTIONS.map(e => (
            <button
              key={e}
              onClick={() => pick(e)}
              style={{ width: '28px', height: '28px', borderRadius: '6px', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              onMouseLeave={ev => ev.currentTarget.style.background = 'none'}
            >
              {e}
            </button>
          ))}
          <button
            onClick={() => { setQuickOpen(false); setFullPickerOpen(true) }}
            title="Больше эмодзи"
            style={{ width: '28px', height: '28px', borderRadius: '6px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            …
          </button>
        </div>
      )}

      {fullPickerOpen && (
        <EmojiPicker
          onPick={pick}
          onClose={() => setFullPickerOpen(false)}
          style={{ top: '32px', bottom: 'auto', right: '0' }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rework `extractMessages` in `MessageList.jsx` to fold reactions**

In `client/src/components/Chat/MessageList.jsx`, replace the entire `extractMessages` function (currently lines 12-65) with:

```js
function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const byId = new Map()
  const order = []
  const reactionsByTarget = new Map()

  for (const ev of events) {
    const type = ev.getType()

    if (type === 'm.reaction') {
      const rel = ev.getRelation()
      if (!rel || rel.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) continue
      let emojiMap = reactionsByTarget.get(rel.event_id)
      if (!emojiMap) { emojiMap = new Map(); reactionsByTarget.set(rel.event_id, emojiMap) }
      const entry = emojiMap.get(rel.key) || { count: 0, reactedByMe: false, myEventId: null }
      entry.count += 1
      if (ev.getSender() === me) { entry.reactedByMe = true; entry.myEventId = ev.getId() }
      emojiMap.set(rel.key, entry)
      continue
    }

    if (type !== 'm.room.message') continue

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
      base.image = { mxcUrl: content.url, name: content.body }
    } else if (content.msgtype === 'm.audio' && content.url && content['org.matrix.msc3245.voice']) {
      base.voice = { mxcUrl: content.url, durationMs: content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0 }
    } else if (content.msgtype === 'm.video' && content.url && content['dev.qts.round_video']) {
      base.roundVideo = { mxcUrl: content.url, durationMs: content.info?.duration || 0 }
    } else if (content.msgtype === 'm.file' && content.url) {
      base.file = { mxcUrl: content.url, name: content.body, ext: (content.body.split('.').pop() || '').toLowerCase(), size: formatFileSize(content.info?.size) }
    } else {
      base.text = content.body
    }

    byId.set(base.id, base)
    order.push(base.id)
  }

  const result = order.map(id => byId.get(id))

  for (const msg of result) {
    const emojiMap = reactionsByTarget.get(msg.id)
    if (emojiMap) {
      msg.reactions = Array.from(emojiMap.entries()).map(([emoji, entry]) => ({
        emoji, count: entry.count, reactedByMe: entry.reactedByMe, myEventId: entry.myEventId,
      }))
    }
  }

  return result
}
```

- [ ] **Step 5: Let reaction events trigger a re-render**

In the same file, find the `useEffect` that registers `onTimeline` (currently around lines 75-83):

```js
  useEffect(() => {
    const onTimeline = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      if (event.getType() !== 'm.room.message') return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => client.off(RoomEvent.Timeline, onTimeline)
  }, [client, room])
```

Replace the body condition so reaction events also trigger a recompute:

```js
  useEffect(() => {
    const onTimeline = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      const type = event.getType()
      if (type !== 'm.room.message' && type !== 'm.reaction') return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => client.off(RoomEvent.Timeline, onTimeline)
  }, [client, room])
```

- [ ] **Step 6: Pass `roomId` down to `MessageBubble`**

In the same file's render, change:

```jsx
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
```

to:

```jsx
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} />
      ))}
```

- [ ] **Step 7: Wire hover actions and reaction toggling into `MessageBubble.jsx`**

In `client/src/components/Chat/MessageBubble.jsx`, change the top imports from:

```js
import { useState, useEffect, useRef } from 'react'
import { IconDownload, IconLoader2, IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react'
import { resolveMediaUrl } from '../../lib/matrix'
```

to:

```js
import { useState, useEffect, useRef } from 'react'
import { IconDownload, IconLoader2, IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react'
import { resolveMediaUrl, toggleReaction } from '../../lib/matrix'
import MessageActions from './MessageActions'
```

Change the function signature and the start of the message-rendering branch from:

```jsx
export default function MessageBubble({ message }) {
  if (message.type === 'date') {
```

to:

```jsx
export default function MessageBubble({ message, roomId }) {
  const [hovered, setHovered] = useState(false)

  if (message.type === 'date') {
```

Then find:

```jsx
  const { isOwn, sender, avatar, time, text, file, image, voice, roundVideo, reactions, readBy } = message

  return (
    <div style={{
      display: 'flex',
      flexDirection: isOwn ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: '8px',
      padding: '2px 16px',
    }}>
```

and replace with:

```jsx
  const { isOwn, sender, avatar, time, text, file, image, voice, roundVideo, reactions, readBy } = message

  const handleReact = async (emoji) => {
    try {
      await toggleReaction(roomId, message, emoji)
    } catch (err) {
      console.error('React failed:', err)
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: '8px',
        padding: '2px 16px',
      }}>
      {hovered && <MessageActions message={message} onReact={handleReact} />}
```

(Leave the rest of the JSX inside that `<div>` — avatar, content, footer — untouched for this step; note the closing `</div>` right before the component's final `)` stays as-is too.)

- [ ] **Step 8: Wire clicking an existing reaction pill to toggle it**

In the same file, find the reaction-pill rendering in the footer:

```jsx
          {reactions?.map((r, i) => (
            <span
              key={i}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '2px 7px',
                fontSize: '12px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              {r.emoji}{' '}
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{r.count}</span>
            </span>
          ))}
```

Replace with:

```jsx
          {reactions?.map((r, i) => (
            <span
              key={i}
              onClick={() => handleReact(r.emoji)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid ' + (r.reactedByMe ? 'var(--accent-teal)' : 'var(--border)'),
                borderRadius: '10px',
                padding: '2px 7px',
                fontSize: '12px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = (r.reactedByMe ? 'var(--accent-teal)' : 'var(--border)')}
            >
              {r.emoji}{' '}
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{r.count}</span>
            </span>
          ))}
```

- [ ] **Step 9: Manual verification**

With the dev server running and both `tester1`/`tester2` windows open on the shared DM (see setup above):

1. As `tester1`, send a text message.
2. As `tester2`, hover the message bubble → a small action bar appears at its top-right corner with a smiley icon. Click it.
3. A strip of 7 emoji + "…" appears. Click 👍.
4. Confirm a "👍 1" pill appears under the message, and it appears live on `tester1`'s screen too (no reload).
5. Click "…" in the quick strip → the full 30-emoji grid opens. Pick a different emoji (e.g. ❤️).
6. Confirm the 👍 pill disappears and a ❤️ pill appears instead (one-reaction-per-user swap).
7. Click the ❤️ pill directly → confirms it disappears (toggle-off).
8. Open the browser devtools console on both windows and confirm no errors were logged during the above.

- [ ] **Step 10: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Chat/EmojiPicker.jsx client/src/components/Chat/MessageActions.jsx client/src/components/Chat/MessageBubble.jsx client/src/components/Chat/MessageList.jsx
git commit -m "Add message reactions (react/toggle via hover action bar)"
```

---

### Task 2: Edit own messages

**Files:**
- Modify: `client/src/lib/matrix.js` (append `editMessage`)
- Modify: `client/src/components/Chat/MessageList.jsx` (`extractMessages` edit folding, forward `onEdit`)
- Modify: `client/src/components/Chat/InputArea.jsx` (edit mode: prefill, preview strip, send branching)
- Modify: `client/src/components/Chat/MessageBubble.jsx` ("edited" marker, wire `onEdit` into `MessageActions`)
- Modify: `client/src/components/Chat/index.jsx` (lift `editingMessage` state)
- Test: manual browser verification

**Interfaces:**
- Consumes: `toggleReaction`, `MessageActions` from Task 1 (unchanged signatures, `onEdit` now actually passed).
- Produces (`lib/matrix.js`): `editMessage(roomId, eventId, newText): Promise`.
- Produces (`MessageList.jsx`): message objects may now carry `edited: true` (only ever set alongside an existing `text` field).
- Produces (`Chat/index.jsx`): passes `onEdit: (message) => void` into `MessageList`, and `editingMessage`/`onCancelEdit` into `InputArea`.

- [ ] **Step 1: Add `editMessage` to `lib/matrix.js`**

Append after the `toggleReaction` function added in Task 1:

```js

export async function editMessage(roomId, eventId, newText) {
  if (!_client) throw new Error('Not connected')
  return _client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `* ${newText}`,
    'm.new_content': { msgtype: 'm.text', body: newText },
    'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
  })
}
```

- [ ] **Step 2: Fold edits onto their target in `extractMessages`**

In `client/src/components/Chat/MessageList.jsx`, replace the whole `extractMessages` function (as it stands after Task 1) with:

```js
function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const byId = new Map()
  const order = []
  const reactionsByTarget = new Map()
  const editsByTarget = new Map()

  for (const ev of events) {
    const type = ev.getType()

    if (type === 'm.reaction') {
      const rel = ev.getRelation()
      if (!rel || rel.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) continue
      let emojiMap = reactionsByTarget.get(rel.event_id)
      if (!emojiMap) { emojiMap = new Map(); reactionsByTarget.set(rel.event_id, emojiMap) }
      const entry = emojiMap.get(rel.key) || { count: 0, reactedByMe: false, myEventId: null }
      entry.count += 1
      if (ev.getSender() === me) { entry.reactedByMe = true; entry.myEventId = ev.getId() }
      emojiMap.set(rel.key, entry)
      continue
    }

    if (type !== 'm.room.message') continue

    const rel = ev.getRelation()
    if (rel?.rel_type === 'm.replace') {
      const newContent = ev.getContent()['m.new_content']
      if (newContent?.body != null) editsByTarget.set(rel.event_id, newContent.body)
      continue
    }

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
      base.image = { mxcUrl: content.url, name: content.body }
    } else if (content.msgtype === 'm.audio' && content.url && content['org.matrix.msc3245.voice']) {
      base.voice = { mxcUrl: content.url, durationMs: content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0 }
    } else if (content.msgtype === 'm.video' && content.url && content['dev.qts.round_video']) {
      base.roundVideo = { mxcUrl: content.url, durationMs: content.info?.duration || 0 }
    } else if (content.msgtype === 'm.file' && content.url) {
      base.file = { mxcUrl: content.url, name: content.body, ext: (content.body.split('.').pop() || '').toLowerCase(), size: formatFileSize(content.info?.size) }
    } else {
      base.text = content.body
    }

    byId.set(base.id, base)
    order.push(base.id)
  }

  const result = order.map(id => byId.get(id))

  for (const msg of result) {
    const emojiMap = reactionsByTarget.get(msg.id)
    if (emojiMap) {
      msg.reactions = Array.from(emojiMap.entries()).map(([emoji, entry]) => ({
        emoji, count: entry.count, reactedByMe: entry.reactedByMe, myEventId: entry.myEventId,
      }))
    }
    const editedBody = editsByTarget.get(msg.id)
    if (editedBody != null && msg.text != null) {
      msg.text = editedBody
      msg.edited = true
    }
  }

  return result
}
```

(The `onTimeline` filter from Task 1 already lets `m.room.message` events through, and edit events are `m.room.message` with a `m.replace` relation, so no listener change is needed here.)

- [ ] **Step 3: Forward `onEdit` through `MessageList`**

In the same file, change the component signature:

```js
export default function MessageList({ client, room, onEdit }) {
```

and the render call:

```jsx
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} />
      ))}
```

- [ ] **Step 4: Add edit mode to `InputArea.jsx`**

In `client/src/components/Chat/InputArea.jsx`, change the icon import:

```js
import {
  IconPaperclip, IconMoodSmile, IconSend,
  IconMicrophone, IconVideo, IconTrash,
} from '@tabler/icons-react'
```

to:

```js
import {
  IconPaperclip, IconMoodSmile, IconSend,
  IconMicrophone, IconVideo, IconTrash, IconX,
} from '@tabler/icons-react'
```

Change the matrix.js import:

```js
import { sendMessage, uploadFile, uploadVoiceMessage, uploadVideoNote } from '../../lib/matrix'
```

to:

```js
import { sendMessage, uploadFile, uploadVoiceMessage, uploadVideoNote, editMessage } from '../../lib/matrix'
```

Change the component signature:

```js
export default function InputArea({ room }) {
```

to:

```js
export default function InputArea({ room, editingMessage, onCancelEdit }) {
```

Add a prefill effect. Insert it right after the existing `videoPreviewRef`-related `useEffect` (the one that sets `videoPreviewRef.current.srcObject`) and before `handleKeyDown`:

```js
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.text || '')
      textareaRef.current?.focus()
    }
  }, [editingMessage])
```

Replace `handleSend`:

```js
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
```

with:

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
      if (editingMessage) {
        await editMessage(room.roomId, editingMessage.id, text)
        onCancelEdit()
      } else {
        await sendMessage(room.roomId, text)
      }
    } catch (err) {
      console.error('Send failed:', err)
    }
  }
```

Add the preview strip. Find:

```jsx
      {showEmoji && <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />}
```

and insert immediately after it:

```jsx
      {editingMessage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', marginBottom: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', borderLeft: '3px solid var(--accent-teal)' }}>
          <div style={{ flex: 1, fontSize: '12px', color: 'var(--text-secondary)' }}>Редактирование сообщения</div>
          <button onClick={onCancelEdit} style={{ color: 'var(--text-muted)', display: 'flex' }}>
            <IconX size={14} />
          </button>
        </div>
      )}
```

- [ ] **Step 5: Show an "edited" marker and wire the edit button in `MessageBubble.jsx`**

Change the component signature:

```jsx
export default function MessageBubble({ message, roomId }) {
```

to:

```jsx
export default function MessageBubble({ message, roomId, onEdit }) {
```

Change the `MessageActions` render call added in Task 1:

```jsx
      {hovered && <MessageActions message={message} onReact={handleReact} />}
```

to:

```jsx
      {hovered && (
        <MessageActions
          message={message}
          onReact={handleReact}
          onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
        />
      )}
```

In the footer, find:

```jsx
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{time}</span>
```

and replace with:

```jsx
          {message.edited && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>изменено</span>
          )}

          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{time}</span>
```

- [ ] **Step 6: Lift `editingMessage` state into `Chat/index.jsx`**

Replace the entire contents of `client/src/components/Chat/index.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'

export default function Chat({ client, room, navMode, onNav }) {
  const [editingMessage, setEditingMessage] = useState(null)

  useEffect(() => {
    setEditingMessage(null)
  }, [room.roomId])

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-primary)',
      minWidth: 0,
    }}>
      <Header client={client} room={room} navMode={navMode} onNav={onNav} />
      <MessageList client={client} room={room} onEdit={setEditingMessage} />
      <InputArea room={room} editingMessage={editingMessage} onCancelEdit={() => setEditingMessage(null)} />
    </div>
  )
}
```

- [ ] **Step 7: Manual verification**

1. As `tester1`, send "Тест редактирования".
2. Hover the sent bubble → click ✎ in the action bar.
3. Confirm the composer prefills with "Тест редактирования" and a "Редактирование сообщения" strip appears above it.
4. Change the text to "Тест редактирования (изменено)" and press Enter.
5. Confirm the bubble updates in place with the new text and an "изменено" marker next to the timestamp, on both `tester1` and `tester2` windows without reload.
6. Hover a message from `tester2` (not your own) on the `tester1` window and confirm no ✎ icon appears (only own messages are editable).
7. Click ✎ again, then click the ✕ on the preview strip, and confirm the composer clears and returns to normal send mode.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Chat/MessageList.jsx client/src/components/Chat/InputArea.jsx client/src/components/Chat/MessageBubble.jsx client/src/components/Chat/index.jsx
git commit -m "Add editing of own text messages"
```

---

### Task 3: Delete own messages

**Files:**
- Modify: `client/src/lib/matrix.js` (append `deleteMessage`)
- Modify: `client/src/components/Chat/MessageList.jsx` (`extractMessages` redaction handling, `RoomEvent.Redaction` listener)
- Modify: `client/src/components/Chat/MessageBubble.jsx` (tombstone render, delete confirm modal, wire `onDeleteClick`)
- Test: manual browser verification

**Interfaces:**
- Produces (`lib/matrix.js`): `deleteMessage(roomId, eventId): Promise`.
- Produces (`MessageList.jsx`): message objects may now carry `deleted: true` (in which case no other content fields are set).
- Consumes: `Modal` from `client/src/components/Modals/Modal.jsx` — `Modal({ title, onClose, children, footer })` (existing, unchanged).

- [ ] **Step 1: Add `deleteMessage` to `lib/matrix.js`**

Append after `editMessage`:

```js

export async function deleteMessage(roomId, eventId) {
  if (!_client) throw new Error('Not connected')
  return _client.redactEvent(roomId, eventId)
}
```

- [ ] **Step 2: Turn redacted events into tombstones in `extractMessages`**

In `client/src/components/Chat/MessageList.jsx`, replace the whole `extractMessages` function (as it stands after Task 2) with:

```js
function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const byId = new Map()
  const order = []
  const reactionsByTarget = new Map()
  const editsByTarget = new Map()

  for (const ev of events) {
    const type = ev.getType()

    if (type === 'm.reaction') {
      const rel = ev.getRelation()
      if (!rel || rel.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) continue
      let emojiMap = reactionsByTarget.get(rel.event_id)
      if (!emojiMap) { emojiMap = new Map(); reactionsByTarget.set(rel.event_id, emojiMap) }
      const entry = emojiMap.get(rel.key) || { count: 0, reactedByMe: false, myEventId: null }
      entry.count += 1
      if (ev.getSender() === me) { entry.reactedByMe = true; entry.myEventId = ev.getId() }
      emojiMap.set(rel.key, entry)
      continue
    }

    if (type !== 'm.room.message') continue

    const rel = ev.getRelation()
    if (rel?.rel_type === 'm.replace') {
      const newContent = ev.getContent()['m.new_content']
      if (newContent?.body != null) editsByTarget.set(rel.event_id, newContent.body)
      continue
    }

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

    if (ev.isRedacted()) {
      base.deleted = true
      byId.set(base.id, base)
      order.push(base.id)
      continue
    }

    const content = ev.getContent()
    if (!content?.body) continue

    if (content.msgtype === 'm.image' && content.url) {
      base.image = { mxcUrl: content.url, name: content.body }
    } else if (content.msgtype === 'm.audio' && content.url && content['org.matrix.msc3245.voice']) {
      base.voice = { mxcUrl: content.url, durationMs: content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0 }
    } else if (content.msgtype === 'm.video' && content.url && content['dev.qts.round_video']) {
      base.roundVideo = { mxcUrl: content.url, durationMs: content.info?.duration || 0 }
    } else if (content.msgtype === 'm.file' && content.url) {
      base.file = { mxcUrl: content.url, name: content.body, ext: (content.body.split('.').pop() || '').toLowerCase(), size: formatFileSize(content.info?.size) }
    } else {
      base.text = content.body
    }

    byId.set(base.id, base)
    order.push(base.id)
  }

  const result = order.map(id => byId.get(id))

  for (const msg of result) {
    const emojiMap = reactionsByTarget.get(msg.id)
    if (emojiMap) {
      msg.reactions = Array.from(emojiMap.entries()).map(([emoji, entry]) => ({
        emoji, count: entry.count, reactedByMe: entry.reactedByMe, myEventId: entry.myEventId,
      }))
    }
    const editedBody = editsByTarget.get(msg.id)
    if (editedBody != null && msg.text != null) {
      msg.text = editedBody
      msg.edited = true
    }
  }

  return result
}
```

- [ ] **Step 3: Listen for redactions**

In the same file, replace the `useEffect` that registers `onTimeline` (as it stands after Task 1) with:

```js
  useEffect(() => {
    const onTimeline = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      const type = event.getType()
      if (type !== 'm.room.message' && type !== 'm.reaction') return
      setMessages(extractMessages(client, room))
    }
    const onRedaction = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    client.on(RoomEvent.Redaction, onRedaction)
    return () => {
      client.off(RoomEvent.Timeline, onTimeline)
      client.off(RoomEvent.Redaction, onRedaction)
    }
  }, [client, room])
```

- [ ] **Step 4: Render a tombstone and delete confirmation in `MessageBubble.jsx`**

Add imports. Change:

```js
import { resolveMediaUrl, toggleReaction } from '../../lib/matrix'
import MessageActions from './MessageActions'
```

to:

```js
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
```

Insert a tombstone branch. Find the `system`-type early return:

```jsx
  if (message.type === 'system') {
    return (
      <div style={{ textAlign: 'center', padding: '3px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
        {message.text}
      </div>
    )
  }
```

and insert immediately after it (before the `const { isOwn, ... } = message` line):

```jsx
  if (message.deleted) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: message.isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: '8px',
        padding: '2px 16px',
      }}>
        {!message.isOwn && (
          <div style={{ width: '32px', height: '32px', flexShrink: 0 }} />
        )}
        <div style={{
          maxWidth: '65%',
          background: 'var(--bg-card)',
          border: '1px dashed var(--border)',
          borderRadius: '12px',
          padding: '8px 12px',
          fontSize: '13px',
          fontStyle: 'italic',
          color: 'var(--text-muted)',
        }}>
          Сообщение удалено
        </div>
      </div>
    )
  }
```

Add delete state and a handler. Find:

```jsx
  const handleReact = async (emoji) => {
    try {
      await toggleReaction(roomId, message, emoji)
    } catch (err) {
      console.error('React failed:', err)
    }
  }
```

and insert immediately after it:

```jsx
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDelete = async () => {
    setConfirmOpen(false)
    try {
      await deleteMessage(roomId, message.id)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }
```

Wire the delete button into `MessageActions`. Change the call from Task 2:

```jsx
      {hovered && (
        <MessageActions
          message={message}
          onReact={handleReact}
          onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
        />
      )}
```

to:

```jsx
      {hovered && (
        <MessageActions
          message={message}
          onReact={handleReact}
          onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
          onDeleteClick={isOwn ? () => setConfirmOpen(true) : undefined}
        />
      )}
```

Finally, wrap the component's return value in a fragment so the confirmation modal can render alongside the bubble. Find the closing of the return statement — the outer `<div ...>` that starts right after the block above, ending with:

```jsx
        </div>
      </div>
    </div>
  )
}
```

(the three closing `</div>` tags that close the footer, the content column, and the outer flex row, followed by the closing `)` of `return` and `}` of the component). Change the `return (` that opens this block from:

```jsx
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
```

to:

```jsx
  return (
    <>
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
```

And change the final closing of that same return statement from:

```jsx
        </div>
      </div>
    </div>
  )
}
```

to:

```jsx
        </div>
      </div>
    </div>
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

- [ ] **Step 5: Manual verification**

1. As `tester1`, send "Сообщение на удаление".
2. Hover it → click 🗑 → confirm the "Удалить сообщение?" modal appears.
3. Click "Отмена" → confirm the modal closes and the message is untouched.
4. Click 🗑 again → click "Удалить" → confirm the bubble becomes a dashed "Сообщение удалено" tombstone, and the same happens live on `tester2`'s window.
5. Hover a message from `tester2` on the `tester1` window and confirm no 🗑 icon appears (only own messages are deletable).
6. Confirm no console errors during the above.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Chat/MessageList.jsx client/src/components/Chat/MessageBubble.jsx
git commit -m "Add deleting own messages (redaction + tombstone)"
```

---

### Task 4: Reply

**Files:**
- Modify: `client/src/lib/matrix.js` (append `escapeHtml` helper + `sendReply`)
- Modify: `client/src/components/Chat/MessageList.jsx` (`extractMessages`: `senderId` field, reply resolution, forward `onReply`)
- Modify: `client/src/components/Chat/InputArea.jsx` (reply mode: preview strip, send branching)
- Modify: `client/src/components/Chat/MessageBubble.jsx` (render quoted preview, wire `onReply`)
- Modify: `client/src/components/Chat/index.jsx` (lift `replyingTo` state, mutual exclusivity with edit)
- Test: manual browser verification

**Interfaces:**
- Produces (`lib/matrix.js`): `sendReply(roomId, text, replyTo): Promise` where `replyTo` is a message object from `extractMessages` (needs `.id`, `.senderId`, `.sender`, `.text`).
- Produces (`MessageList.jsx`): message objects now always carry `senderId: string`; may carry `replyTo: { sender: string|null, snippet: string }`.
- Produces (`Chat/index.jsx`): passes `onReply: (message) => void` into `MessageList`, and `replyingTo`/`onCancelReply` into `InputArea`; entering reply mode clears edit mode and vice versa.

- [ ] **Step 1: Add `sendReply` to `lib/matrix.js`**

Append after `toggleReaction` (order relative to `editMessage`/`deleteMessage` doesn't matter — append at the end of the file):

```js

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendReply(roomId, text, replyTo) {
  if (!_client) throw new Error('Not connected')
  const snippet = (replyTo.text || '').slice(0, 200)
  const plainFallback = `> <${replyTo.senderId}> ${snippet}\n\n${text}`
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

- [ ] **Step 2: Add `senderId` and reply resolution to `extractMessages`**

In `client/src/components/Chat/MessageList.jsx`, replace the whole `extractMessages` function (as it stands after Task 3) with:

```js
function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const byId = new Map()
  const order = []
  const reactionsByTarget = new Map()
  const editsByTarget = new Map()

  for (const ev of events) {
    const type = ev.getType()

    if (type === 'm.reaction') {
      const rel = ev.getRelation()
      if (!rel || rel.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) continue
      let emojiMap = reactionsByTarget.get(rel.event_id)
      if (!emojiMap) { emojiMap = new Map(); reactionsByTarget.set(rel.event_id, emojiMap) }
      const entry = emojiMap.get(rel.key) || { count: 0, reactedByMe: false, myEventId: null }
      entry.count += 1
      if (ev.getSender() === me) { entry.reactedByMe = true; entry.myEventId = ev.getId() }
      emojiMap.set(rel.key, entry)
      continue
    }

    if (type !== 'm.room.message') continue

    const rel = ev.getRelation()
    if (rel?.rel_type === 'm.replace') {
      const newContent = ev.getContent()['m.new_content']
      if (newContent?.body != null) editsByTarget.set(rel.event_id, newContent.body)
      continue
    }

    const senderId = ev.getSender()
    const member = room.getMember(senderId)
    const name = member?.name || senderId.replace('@', '').split(':')[0]

    const base = {
      id: ev.getId(),
      type: 'message',
      sender: name,
      senderId,
      avatar: name.slice(0, 2).toUpperCase(),
      time: new Date(ev.getTs()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      isOwn: senderId === me,
    }

    if (ev.isRedacted()) {
      base.deleted = true
      byId.set(base.id, base)
      order.push(base.id)
      continue
    }

    const content = ev.getContent()
    if (!content?.body) continue

    if (ev.replyEventId) {
      const original = room.findEventById(ev.replyEventId)
      if (original && original.getType() === 'm.room.message' && !original.isRedacted()) {
        const originalSenderId = original.getSender()
        const originalMember = room.getMember(originalSenderId)
        base.replyTo = {
          sender: originalMember?.name || originalSenderId.replace('@', '').split(':')[0],
          snippet: (original.getContent().body || '').slice(0, 120),
        }
      } else {
        base.replyTo = { sender: null, snippet: 'Исходное сообщение недоступно' }
      }
    }

    if (content.msgtype === 'm.image' && content.url) {
      base.image = { mxcUrl: content.url, name: content.body }
    } else if (content.msgtype === 'm.audio' && content.url && content['org.matrix.msc3245.voice']) {
      base.voice = { mxcUrl: content.url, durationMs: content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0 }
    } else if (content.msgtype === 'm.video' && content.url && content['dev.qts.round_video']) {
      base.roundVideo = { mxcUrl: content.url, durationMs: content.info?.duration || 0 }
    } else if (content.msgtype === 'm.file' && content.url) {
      base.file = { mxcUrl: content.url, name: content.body, ext: (content.body.split('.').pop() || '').toLowerCase(), size: formatFileSize(content.info?.size) }
    } else {
      base.text = content.body
    }

    byId.set(base.id, base)
    order.push(base.id)
  }

  const result = order.map(id => byId.get(id))

  for (const msg of result) {
    const emojiMap = reactionsByTarget.get(msg.id)
    if (emojiMap) {
      msg.reactions = Array.from(emojiMap.entries()).map(([emoji, entry]) => ({
        emoji, count: entry.count, reactedByMe: entry.reactedByMe, myEventId: entry.myEventId,
      }))
    }
    const editedBody = editsByTarget.get(msg.id)
    if (editedBody != null && msg.text != null) {
      msg.text = editedBody
      msg.edited = true
    }
  }

  return result
}
```

- [ ] **Step 3: Forward `onReply` through `MessageList`**

Change the component signature:

```js
export default function MessageList({ client, room, onEdit }) {
```

to:

```js
export default function MessageList({ client, room, onEdit, onReply }) {
```

and the render call:

```jsx
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} />
      ))}
```

to:

```jsx
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} onReply={onReply} />
      ))}
```

- [ ] **Step 4: Add reply mode to `InputArea.jsx`**

Change the matrix.js import:

```js
import { sendMessage, uploadFile, uploadVoiceMessage, uploadVideoNote, editMessage } from '../../lib/matrix'
```

to:

```js
import { sendMessage, uploadFile, uploadVoiceMessage, uploadVideoNote, editMessage, sendReply } from '../../lib/matrix'
```

Change the component signature:

```js
export default function InputArea({ room, editingMessage, onCancelEdit }) {
```

to:

```js
export default function InputArea({ room, editingMessage, onCancelEdit, replyingTo, onCancelReply }) {
```

Replace `handleSend` (as it stands after Task 2):

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
      if (editingMessage) {
        await editMessage(room.roomId, editingMessage.id, text)
        onCancelEdit()
      } else {
        await sendMessage(room.roomId, text)
      }
    } catch (err) {
      console.error('Send failed:', err)
    }
  }
```

with:

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
      if (editingMessage) {
        await editMessage(room.roomId, editingMessage.id, text)
        onCancelEdit()
      } else if (replyingTo) {
        await sendReply(room.roomId, text, replyingTo)
        onCancelReply()
      } else {
        await sendMessage(room.roomId, text)
      }
    } catch (err) {
      console.error('Send failed:', err)
    }
  }
```

Replace the preview strip added in Task 2:

```jsx
      {editingMessage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', marginBottom: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', borderLeft: '3px solid var(--accent-teal)' }}>
          <div style={{ flex: 1, fontSize: '12px', color: 'var(--text-secondary)' }}>Редактирование сообщения</div>
          <button onClick={onCancelEdit} style={{ color: 'var(--text-muted)', display: 'flex' }}>
            <IconX size={14} />
          </button>
        </div>
      )}
```

with a combined version covering both modes (they're mutually exclusive, enforced in `Chat/index.jsx`):

```jsx
      {(editingMessage || replyingTo) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', marginBottom: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', borderLeft: '3px solid var(--accent-teal)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingMessage ? (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Редактирование сообщения</div>
            ) : (
              <>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-teal)' }}>Ответ {replyingTo.sender}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {replyingTo.text || 'Медиа-сообщение'}
                </div>
              </>
            )}
          </div>
          <button onClick={editingMessage ? onCancelEdit : onCancelReply} style={{ color: 'var(--text-muted)', display: 'flex' }}>
            <IconX size={14} />
          </button>
        </div>
      )}
```

- [ ] **Step 5: Render the quoted preview and wire `onReply` in `MessageBubble.jsx`**

Change the component signature:

```jsx
export default function MessageBubble({ message, roomId, onEdit }) {
```

to:

```jsx
export default function MessageBubble({ message, roomId, onEdit, onReply }) {
```

Update the `MessageActions` call (as it stands after Task 3):

```jsx
      {hovered && (
        <MessageActions
          message={message}
          onReact={handleReact}
          onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
          onDeleteClick={isOwn ? () => setConfirmOpen(true) : undefined}
        />
      )}
```

to:

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

Render the quote block inside the bubble. Find the start of the "Bubble" div's content:

```jsx
        <div style={{
          background: isOwn ? '#0d3326' : 'var(--bg-card)',
          border: '1px solid ' + (isOwn ? '#1c4535' : 'var(--border)'),
          borderRadius: isOwn ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
          padding: '8px 12px',
        }}>
          {text && (
```

and insert the quote block right before `{text && (`:

```jsx
        <div style={{
          background: isOwn ? '#0d3326' : 'var(--bg-card)',
          border: '1px solid ' + (isOwn ? '#1c4535' : 'var(--border)'),
          borderRadius: isOwn ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
          padding: '8px 12px',
        }}>
          {message.replyTo && (
            <div style={{
              borderLeft: '2px solid var(--accent-teal)',
              paddingLeft: '8px',
              marginBottom: '6px',
              opacity: 0.85,
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-teal)' }}>
                {message.replyTo.sender || 'Сообщение'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {message.replyTo.snippet}
              </div>
            </div>
          )}

          {text && (
```

- [ ] **Step 6: Lift `replyingTo` state into `Chat/index.jsx`**

Replace the entire contents of `client/src/components/Chat/index.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'

export default function Chat({ client, room, navMode, onNav }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)

  useEffect(() => {
    setEditingMessage(null)
    setReplyingTo(null)
  }, [room.roomId])

  const handleEdit = (msg) => {
    setReplyingTo(null)
    setEditingMessage(msg)
  }

  const handleReply = (msg) => {
    setEditingMessage(null)
    setReplyingTo(msg)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-primary)',
      minWidth: 0,
    }}>
      <Header client={client} room={room} navMode={navMode} onNav={onNav} />
      <MessageList client={client} room={room} onEdit={handleEdit} onReply={handleReply} />
      <InputArea
        room={room}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
    </div>
  )
}
```

- [ ] **Step 7: Manual verification**

1. As `tester1`, send "Привет".
2. As `tester2`, hover that message → click ↩ in the action bar.
3. Confirm the composer shows a strip: "Ответ tester1" / "Привет", with a ✕ to cancel.
4. Type "Как дела?" and send.
5. Confirm the new bubble shows a quoted preview (sender "tester1", snippet "Привет") above "Как дела?", on both windows live.
6. Click ✎ (edit) on one of your own messages, then click ↩ (reply) on another message — confirm the edit strip is replaced by the reply strip (mutual exclusivity), and vice versa.
7. Click ✕ on the reply strip and confirm the composer returns to normal send mode with no leftover quote.
8. Delete the original "Привет" message (from Task 3's delete flow), then check the replying bubble's quote — after the next timeline recompute it should read "Исходное сообщение недоступно" instead of "Привет" (confirms the fallback path).

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/matrix.js client/src/components/Chat/MessageList.jsx client/src/components/Chat/InputArea.jsx client/src/components/Chat/MessageBubble.jsx client/src/components/Chat/index.jsx
git commit -m "Add replying to messages"
```
