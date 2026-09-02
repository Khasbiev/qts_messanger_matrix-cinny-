# Typing Indicator + Read Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live "печатает…" indicator in the chat header, and light up the `✓✓` on own messages once someone else has actually read them — per `docs/superpowers/specs/2026-09-03-typing-read-receipts-design.md`.

**Architecture:** Both pieces are thin wiring over `matrix-js-sdk` APIs that already do the work server-side (`client.sendTyping`, `RoomMemberEvent.Typing`, `room.hasUserReadEvent`, `RoomEvent.Receipt`). Typing touches `InputArea.jsx` (sender), `Chat/index.jsx` (prop plumbing), and `Header.jsx` (display). Read receipts touch only `MessageList.jsx` — `extractMessages()` already has a per-message post-processing loop that attaches `reactions` and applies edits; this adds `readBy` there, and the file's existing multi-listener effect gains one more listener.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- `sendTyping` failures are logged via `console.error` only, matching the established convention.
- `readBy` is a **count** (number of other joined members who've read the message), not a boolean — `MessageBubble.jsx`'s existing render already colors the checkmark on `readBy > 0` and needs no changes.
- The `'в сети'` DM-subtitle stub stays exactly as-is when nobody is typing — real presence is a separate, later item.

---

### Task 1: Typing indicator

**Files:**
- Modify: `client/src/components/Chat/InputArea.jsx`
- Modify: `client/src/components/Chat/index.jsx`
- Modify: `client/src/components/Chat/Header.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: none new.
- Produces: `InputArea` now requires a `client` prop (currently missing) — `Chat/index.jsx` must pass it.

- [ ] **Step 1: Pass `client` into `InputArea`**

In `client/src/components/Chat/index.jsx`, change:

```jsx
      <InputArea
        room={room}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
```

to:

```jsx
      <InputArea
        client={client}
        room={room}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
```

- [ ] **Step 2: Accept `client` and add typing-tracking refs in `InputArea.jsx`**

Change the component signature:

```js
export default function InputArea({ room, editingMessage, onCancelEdit, replyingTo, onCancelReply }) {
```

to:

```js
export default function InputArea({ client, room, editingMessage, onCancelEdit, replyingTo, onCancelReply }) {
```

Find:

```js
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const videoPreviewRef = useRef(null)
```

and add two more refs after it:

```js
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const videoPreviewRef = useRef(null)
  const isTypingRef = useRef(false)
  const typingTimeoutRef = useRef(null)
```

- [ ] **Step 3: Add `notifyTyping`/`stopTyping` and a room-change cleanup effect**

Find the `wasEditingRef` effect block (right after the `videoPreviewRef` effect):

```js
  const wasEditingRef = useRef(false)
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.text || '')
      wasEditingRef.current = true
      textareaRef.current?.focus()
    } else if (wasEditingRef.current) {
      setValue('')
      wasEditingRef.current = false
    }
  }, [editingMessage])
```

Insert immediately after it:

```js
  const notifyTyping = () => {
    if (!isTypingRef.current) {
      isTypingRef.current = true
      client.sendTyping(room.roomId, true, 10000).catch(err => console.error('Typing indicator failed:', err))
    }
    clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false
      client.sendTyping(room.roomId, false, 10000).catch(err => console.error('Typing indicator failed:', err))
    }, 4000)
  }

  const stopTyping = () => {
    clearTimeout(typingTimeoutRef.current)
    if (isTypingRef.current) {
      isTypingRef.current = false
      client.sendTyping(room.roomId, false, 10000).catch(err => console.error('Typing indicator failed:', err))
    }
  }

  useEffect(() => {
    return () => stopTyping()
  }, [room])
```

(The cleanup effect's closure captures the `room`/`stopTyping` from the render it was set up in, so when `room` changes, React runs the *previous* render's cleanup — sending the stop signal for the room being left — before the new effect for the new room is set up. Standard React cleanup-on-dependency-change behavior; no extra bookkeeping needed.)

- [ ] **Step 4: Wire `notifyTyping`/`stopTyping` into `handleInput` and `handleSend`**

Find:

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
```

Replace with:

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    stopTyping()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
```

Find:

```js
  const handleInput = (e) => {
    setValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }
```

Replace with:

```js
  const handleInput = (e) => {
    setValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    if (e.target.value.trim()) {
      notifyTyping()
    } else {
      stopTyping()
    }
  }
```

- [ ] **Step 5: Display the indicator in `Header.jsx`**

Change the top imports from:

```jsx
import { IconArrowLeft, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import { isDirectRoom } from '../../lib/matrix'
```

to:

```jsx
import { useState, useEffect } from 'react'
import { RoomMemberEvent } from 'matrix-js-sdk'
import { IconArrowLeft, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import { isDirectRoom } from '../../lib/matrix'
```

Find:

```jsx
export default function Header({ client, room, navMode, onNav }) {
  const memberCount = room.getJoinedMemberCount()
  const isDM = isDirectRoom(client, room.roomId)
  const color = colorFor(room.roomId)
  const avatarLabel = isDM ? room.name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const NavIcon = NAV_ICON[navMode]

  return (
```

Replace with:

```jsx
export default function Header({ client, room, navMode, onNav }) {
  const memberCount = room.getJoinedMemberCount()
  const isDM = isDirectRoom(client, room.roomId)
  const color = colorFor(room.roomId)
  const avatarLabel = isDM ? room.name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const NavIcon = NAV_ICON[navMode]

  const [typingNames, setTypingNames] = useState([])

  useEffect(() => {
    const me = client.getUserId()
    const computeTyping = () => {
      const names = room.getJoinedMembers()
        .filter(m => m.userId !== me && m.typing)
        .map(m => m.name)
      setTypingNames(names)
    }
    computeTyping()
    const onTyping = (event, member) => {
      if (member.roomId !== room.roomId) return
      computeTyping()
    }
    client.on(RoomMemberEvent.Typing, onTyping)
    return () => client.off(RoomMemberEvent.Typing, onTyping)
  }, [client, room])

  const subtitle = typingNames.length > 0
    ? (typingNames.length === 1 ? 'печатает…' : `${typingNames.length} человек печатают…`)
    : (isDM ? 'в сети' : `${memberCount} участник${memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов'}`)

  return (
```

Then find the subtitle line itself:

```jsx
        <div style={{ fontSize: '12px', color: 'var(--accent-teal)', marginTop: '1px' }}>
          {isDM ? 'в сети' : `${memberCount} участник${memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов'}`}
        </div>
```

Replace with:

```jsx
        <div style={{ fontSize: '12px', color: 'var(--accent-teal)', marginTop: '1px' }}>
          {subtitle}
        </div>
```

- [ ] **Step 6: Manual verification**

Setup: `scripts/dev/local-test-synapse.sh start` + `seed` (skip if the container from prior work is already running — `docker ps`; `tester1`/`tester2` already exist), `cd client && npm run dev`, log in as `tester1` and `tester2` in two separate browser sessions/profiles, open the same shared DM in both.

1. As `tester1`, start typing in the composer (don't send). Confirm `tester2`'s header subtitle switches from "в сети" to "печатает…" within a moment.
2. Stop typing and wait ~4-5 seconds without sending or clearing. Confirm `tester2`'s header reverts to "в сети".
3. As `tester1`, type again, then send the message. Confirm `tester2`'s header reverts to "в сети" promptly on send (not waiting for the 4s timeout).
4. As `tester1`, type, then clear the composer text entirely (backspace to empty) without sending. Confirm `tester2`'s header reverts to "в сети" promptly.
5. As `tester1`, type something, then switch to a different room before sending or clearing. Confirm `tester2` sees the indicator disappear (not stuck).
6. Confirm no console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Chat/InputArea.jsx client/src/components/Chat/index.jsx client/src/components/Chat/Header.jsx
git commit -m "Add live typing indicator"
```

---

### Task 2: Real read receipts

**Files:**
- Modify: `client/src/components/Chat/MessageList.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: none new.
- Produces: message objects from `extractMessages()` now carry a real `readBy: number` (count of other joined members who've read up to that message) for `isOwn` messages — `MessageBubble.jsx` needs no changes, it already renders this correctly once the field is real.

- [ ] **Step 1: Compute `readBy` in `extractMessages()`**

In `client/src/components/Chat/MessageList.jsx`, find the per-message post-processing loop:

```js
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

Replace with:

```js
  const result = order.map(id => byId.get(id))
  const others = room.getJoinedMembers().filter(m => m.userId !== me)

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
    if (msg.isOwn) {
      msg.readBy = others.filter(m => room.hasUserReadEvent(m.userId, msg.id)).length
    }
  }

  return result
}
```

- [ ] **Step 2: Recompute on new receipts**

Find the listener effect's `onTimelineReset` handler and the `client.on`/`client.off` blocks around it:

```js
    const onTimelineReset = (resetRoom) => {
      if (resetRoom?.roomId !== room.roomId) return
      setReachedStart(false)
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, recomputeOnRelevantEvent)
    client.on(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
    client.on(RoomEvent.Redaction, onRedaction)
    client.on(RoomEvent.TimelineReset, onTimelineReset)
    return () => {
      client.off(RoomEvent.Timeline, recomputeOnRelevantEvent)
      client.off(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
      client.off(RoomEvent.Redaction, onRedaction)
      client.off(RoomEvent.TimelineReset, onTimelineReset)
    }
  }, [client, room])
```

Replace with:

```js
    const onTimelineReset = (resetRoom) => {
      if (resetRoom?.roomId !== room.roomId) return
      setReachedStart(false)
      setMessages(extractMessages(client, room))
    }
    // A read receipt from another member doesn't change the timeline itself,
    // only whether our own sent messages now count as "read" — recompute so
    // the ✓✓ checkmark updates live.
    const onReceipt = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, recomputeOnRelevantEvent)
    client.on(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
    client.on(RoomEvent.Redaction, onRedaction)
    client.on(RoomEvent.TimelineReset, onTimelineReset)
    client.on(RoomEvent.Receipt, onReceipt)
    return () => {
      client.off(RoomEvent.Timeline, recomputeOnRelevantEvent)
      client.off(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
      client.off(RoomEvent.Redaction, onRedaction)
      client.off(RoomEvent.TimelineReset, onTimelineReset)
      client.off(RoomEvent.Receipt, onReceipt)
    }
  }, [client, room])
```

- [ ] **Step 3: Manual verification**

Setup as in Task 1 (reuse running Synapse/dev server if still up).

1. As `tester1`, send a message. Confirm it initially shows a plain/gray `✓✓` (since `tester2` hasn't opened the room yet — if `tester2`'s tab already has this DM open and focused, the receipt may arrive almost immediately; to see the gray state clearly, have `tester2` switch to a different room first).
2. As `tester2`, open (or switch back to) the shared DM.
3. Confirm `tester1`'s view of that message updates the `✓✓` to the colored/accent state live, without reloading.
4. Send a second message from `tester1` while `tester2`'s DM is already open and focused — confirm it goes straight to colored (or very quickly after) since the read receipt should follow almost immediately.
5. Confirm messages from `tester2` (not `isOwn` for `tester1`) never show a checkmark at all — unchanged from before.
6. Confirm no console errors throughout.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Chat/MessageList.jsx
git commit -m "Compute real read receipts for own messages"
```
