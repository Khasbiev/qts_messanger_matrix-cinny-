# History Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrolling to the top of an open chat auto-loads older history (`client.scrollback`), Telegram-style, without losing scroll position — per `docs/superpowers/specs/2026-09-02-history-pagination-design.md`.

**Architecture:** All work is in `client/src/components/Chat/MessageList.jsx`. `extractMessages()` already re-reads the room's entire live timeline on every relevant event, so once `client.scrollback()` prepends older events into that timeline, the existing recompute pipeline (already wired from the message-actions work) picks them up with zero changes there. New code is purely scroll-position bookkeeping: a near-bottom ref for deciding when to auto-scroll, and a near-top scroll trigger for pagination.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling (except reusing the already-global `.spin` animation class, as `MessageBubble.jsx` already does for `IconLoader2`).
- Pagination triggers only on scroll-near-top — no manual "load more" button (explicit user decision).
- Auto-scroll-to-bottom fires only when the user was already near the bottom, or on first opening a room — never during a pagination-triggered prepend.
- A failed `scrollback()` call is logged via `console.error` only — no retry/backoff UI, matching the rest of the codebase's error-handling convention.

---

### Task 1: Fix auto-scroll-to-bottom to respect scroll position

**Files:**
- Modify: `client/src/components/Chat/MessageList.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces: a `containerRef` (React ref) on the message list's scrollable `<div>`, and an `isNearBottomRef` (React ref, boolean) tracking whether the user is currently scrolled near the bottom. Task 2 reads/writes both.

This task is a prerequisite for Task 2 (pagination is unusable without it — prepending history would otherwise immediately snap back to the bottom) but is independently valuable and testable on its own: today, any live event in an open room (someone else's reaction, an edit, a new message) yanks whoever is reading old history back to the bottom. This fixes that.

- [ ] **Step 1: Add `containerRef` and `isNearBottomRef`, and reset the latter on room change**

In `client/src/components/Chat/MessageList.jsx`, find:

```jsx
export default function MessageList({ client, room, onEdit, onReply }) {
  const [messages, setMessages] = useState(() => extractMessages(client, room))
  const bottomRef = useRef(null)

  useEffect(() => {
    setMessages(extractMessages(client, room))
  }, [client, room])
```

Replace with:

```jsx
export default function MessageList({ client, room, onEdit, onReply }) {
  const [messages, setMessages] = useState(() => extractMessages(client, room))
  const bottomRef = useRef(null)
  const containerRef = useRef(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    isNearBottomRef.current = true
    setMessages(extractMessages(client, room))
  }, [client, room])
```

- [ ] **Step 2: Make the bottom-scroll effect conditional**

Find:

```jsx
  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages])
```

Replace with:

```jsx
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView()
    }
  }, [messages])
```

- [ ] **Step 3: Add the scroll handler and wire it to the container**

Find the component's `return` statement (the non-empty-messages branch):

```jsx
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} onReply={onReply} />
      ))}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
```

Insert a `handleScroll` function right before this `return` (after the read-receipt `useEffect`, i.e. after the closing `}, [client, room, messages])` of that effect):

```jsx
  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120
  }
```

Then change the `return` statement's outer `<div>` to attach the ref and handler:

```jsx
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}
    >
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} onReply={onReply} />
      ))}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
```

- [ ] **Step 4: Manual verification**

Setup: `scripts/dev/local-test-synapse.sh start` + `seed` (skip if the container from prior work is already running — `docker ps` to check; `tester1`/`tester2` already exist), `cd client && npm run dev`, log in as `tester1` and `tester2` in two separate browser sessions/profiles, open the same shared DM in both.

1. As `tester1`, confirm opening a room scrolls to the bottom (existing behavior, should be unchanged).
2. Scroll up a bit in the message list (not all the way to the top — just enough to not be at the bottom).
3. As `tester2`, send a new message.
4. Confirm `tester1`'s viewport does **not** jump to the bottom — it stays where it was scrolled to.
5. Scroll `tester1` back down to the bottom.
6. As `tester2`, send another message.
7. Confirm `tester1`'s viewport **does** auto-scroll to the bottom this time.
8. Switch `tester1` to a different room and back — confirm it opens scrolled to the bottom both times.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Chat/MessageList.jsx
git commit -m "Only auto-scroll to bottom when already near it"
```

---

### Task 2: Load older history on scroll-to-top

**Files:**
- Modify: `client/src/components/Chat/MessageList.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: `containerRef`, `isNearBottomRef` from Task 1 (unchanged).
- Produces: nothing new consumed by other files — self-contained within `MessageList.jsx`.

- [ ] **Step 1: Import `EventTimeline` and `IconLoader2`**

In `client/src/components/Chat/MessageList.jsx`, change:

```js
import { useState, useEffect, useRef } from 'react'
import { RoomEvent } from 'matrix-js-sdk'
import MessageBubble from './MessageBubble'
```

to:

```js
import { useState, useEffect, useRef } from 'react'
import { RoomEvent, EventTimeline } from 'matrix-js-sdk'
import { IconLoader2 } from '@tabler/icons-react'
import MessageBubble from './MessageBubble'
```

- [ ] **Step 2: Add `loadingHistory`/`reachedStart` state, reset on room change**

Find (as it stands after Task 1):

```jsx
  const containerRef = useRef(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    isNearBottomRef.current = true
    setMessages(extractMessages(client, room))
  }, [client, room])
```

Replace with:

```jsx
  const containerRef = useRef(null)
  const isNearBottomRef = useRef(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [reachedStart, setReachedStart] = useState(false)

  useEffect(() => {
    isNearBottomRef.current = true
    setLoadingHistory(false)
    setReachedStart(false)
    setMessages(extractMessages(client, room))
  }, [client, room])
```

- [ ] **Step 3: Add `loadMoreHistory` and extend `handleScroll`**

Find the `handleScroll` function added in Task 1:

```jsx
  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120
  }
```

Replace with (adds `loadMoreHistory` above it, and a pagination-trigger check inside it):

```jsx
  const loadMoreHistory = async () => {
    const container = containerRef.current
    if (!container || loadingHistory || reachedStart) return
    setLoadingHistory(true)
    const prevScrollHeight = container.scrollHeight
    try {
      const updatedRoom = await client.scrollback(room, 30)
      const hasMore = updatedRoom.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS) != null
      if (!hasMore) setReachedStart(true)
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight - prevScrollHeight
        }
      })
    } catch (err) {
      console.error('History pagination failed:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120
    if (container.scrollTop < 150 && !loadingHistory && !reachedStart) {
      loadMoreHistory()
    }
  }
```

- [ ] **Step 4: Render the loading / reached-start indicator**

Find the `return` statement's opening (as it stands after Task 1):

```jsx
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}
    >
      {messages.map(msg => (
```

Insert the indicator block right after the opening `<div ...>` and before `{messages.map(msg => (`:

```jsx
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}
    >
      {(loadingHistory || reachedStart) && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          {loadingHistory ? (
            <IconLoader2 size={18} className="spin" color="var(--text-muted)" />
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Начало истории</span>
          )}
        </div>
      )}
      {messages.map(msg => (
```

- [ ] **Step 5: Manual verification**

Setup as in Task 1 (reuse running Synapse/dev server if still up).

1. In the shared `tester1`/`tester2` DM, send enough messages that the room has more than 30 total (send ~35+ short messages from either account — a quick loop of short sends is fine, content doesn't matter).
2. Reload `tester1`'s tab so only the most recent ~30 are loaded (matches `initialSyncLimit: 30`).
3. Scroll to the very top of the message list.
4. Confirm: a spinner briefly appears at the top, older messages load in, and the viewport does **not** jump — whatever message was at the top of the visible area before loading should still be roughly where it was (not scrolled to the very top of the newly-loaded content, not jumped to the bottom).
5. Keep scrolling to the top repeatedly until the room's actual beginning is reached (the very first message ever sent in that room). Confirm "Начало истории" appears and no further loading is attempted (no repeated spinner flicker on further scroll-up attempts).
6. Confirm no console errors throughout.
7. Switch to a different room and back to the DM — confirm pagination state resets (scrolling to top again after switching back should be able to load more, not immediately show "Начало истории" if there's still more history above what's currently loaded — though after Step 5 there won't be, so this mainly confirms no stale `reachedStart: true` leaking from a different room; check a room with little history vs. the long one to be sure per-room state doesn't cross-contaminate).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Chat/MessageList.jsx
git commit -m "Load older history on scroll-to-top"
```
