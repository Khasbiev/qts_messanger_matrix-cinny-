# Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small, independent fixes per `docs/superpowers/specs/2026-09-03-quick-wins-design.md`: don't auto-select a room on login, show real DM presence instead of a hardcoded "в сети", and persist unsent composer text per chat.

**Architecture:** Three unrelated single-file changes — `App.jsx` (remove auto-select), `Header.jsx` (real presence via `client.getPresence` + `UserEvent.Presence`), `InputArea.jsx` (`localStorage`-backed drafts). No shared state between them.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- Presence and draft-storage failures are logged via `console.error` only and otherwise no-op silently, matching the established error-handling convention.
- Drafts are only saved/restored for the plain send-mode compose text — never while `editingMessage`/`replyingTo` is active.

---

### Task 1: Don't auto-select a room on login

**Files:**
- Modify: `client/src/App.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

- [ ] **Step 1: Remove both auto-select call sites**

In `client/src/App.jsx`, find:

```js
  useEffect(() => {
    restoreSession().then(async (c) => {
      if (c) {
        try {
          await startSync(c)
          const rooms = c.getRooms()
          setClient(c)
          if (rooms.length > 0) setActiveRoom(rooms[0])
        } catch {
          await logout()
        }
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])
```

Replace with:

```js
  useEffect(() => {
    restoreSession().then(async (c) => {
      if (c) {
        try {
          await startSync(c)
          setClient(c)
        } catch {
          await logout()
        }
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])
```

Find:

```js
  const handleLogin = (newClient) => {
    const rooms = newClient.getRooms()
    setClient(newClient)
    if (rooms.length > 0) setActiveRoom(rooms[0])
  }
```

Replace with:

```js
  const handleLogin = (newClient) => {
    setClient(newClient)
  }
```

- [ ] **Step 2: Manual verification**

Setup: `scripts/dev/local-test-synapse.sh start` + `seed` (skip if the container from prior work is already running — `docker ps`; `tester1`/`tester2` already exist), `cd client && npm run dev`.

1. Log in as `tester1` (an account with multiple existing rooms). Confirm the app lands on the "Выберите канал" empty state, not the first room.
2. Click a room in the sidebar — confirm it opens normally.
3. Reload the page while a room is open — confirm session restore also lands on the empty state (not auto-reopening the previously active room; there's no such persistence today and this task doesn't add any).
4. Confirm no console errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/App.jsx
git commit -m "Don't auto-select a room on login"
```

---

### Task 2: Real DM presence

**Files:**
- Modify: `client/src/components/Chat/Header.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

- [ ] **Step 1: Import `UserEvent` and compute the other DM member's user ID**

Change the top import:

```jsx
import { RoomMemberEvent } from 'matrix-js-sdk'
```

to:

```jsx
import { RoomMemberEvent, UserEvent } from 'matrix-js-sdk'
```

- [ ] **Step 2: Add presence state and subscription**

Find:

```jsx
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
    ? (typingNames.length === 1 ? 'печатает…' : `${typingNames.length} ${pluralizePeople(typingNames.length)} печатают…`)
    : (isDM ? 'в сети' : `${memberCount} участник${memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов'}`)
```

Replace with:

```jsx
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

  const [presence, setPresence] = useState(null)

  useEffect(() => {
    if (!isDM) {
      setPresence(null)
      return
    }
    const me = client.getUserId()
    const other = room.getJoinedMembers().find(m => m.userId !== me)
    if (!other) {
      setPresence(null)
      return
    }
    const otherUserId = other.userId

    client.getPresence(otherUserId)
      .then(status => setPresence(status.presence))
      .catch(err => console.error('Presence fetch failed:', err))

    const onPresence = (event, user) => {
      if (user.userId !== otherUserId) return
      setPresence(user.presence)
    }
    client.on(UserEvent.Presence, onPresence)
    return () => client.off(UserEvent.Presence, onPresence)
  }, [client, room, isDM])

  const presenceText = presence === 'online' ? 'в сети' : presence === 'unavailable' ? 'отошёл' : 'не в сети'

  const subtitle = typingNames.length > 0
    ? (typingNames.length === 1 ? 'печатает…' : `${typingNames.length} ${pluralizePeople(typingNames.length)} печатают…`)
    : (isDM ? presenceText : `${memberCount} участник${memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов'}`)
```

- [ ] **Step 3: Manual verification**

Setup as in Task 1 (reuse running Synapse/dev server if still up). Requires two accounts (`tester1`/`tester2`) in a shared DM.

1. As `tester1`, open the DM with `tester2` while `tester2` is logged in and active (their client has synced recently). Confirm the header subtitle shows "в сети".
2. Log `tester2` out (or close their tab/browser context entirely so their client stops syncing). Wait a short while (presence typically takes a few seconds to a minute or two to flip depending on server config — check periodically rather than assuming an instant flip). Confirm `tester1`'s header eventually shows "не в сети".
3. Log `tester2` back in and reopen the DM (or just let them reconnect) — confirm `tester1`'s header returns to "в сети" without `tester1` needing to reload.
4. Confirm a channel room (non-DM) still shows the member-count subtitle, unaffected.
5. Confirm typing still overrides presence exactly as before (type from `tester2`, confirm `tester1` sees "печатает…", stop and confirm it reverts to the presence text, not a hardcoded string).
6. Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Chat/Header.jsx
git commit -m "Show real DM presence instead of hardcoded online status"
```

---

### Task 3: Per-chat drafts

**Files:**
- Modify: `client/src/components/Chat/InputArea.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

- [ ] **Step 1: Add a debounced draft-save helper and a clear-draft helper**

Find:

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
  const draftTimeoutRef = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`qts_draft_${room.roomId}`)
      if (saved) setValue(saved)
    } catch (err) {
      console.error('Draft load failed:', err)
    }
  }, [room])

  const saveDraft = (text) => {
    clearTimeout(draftTimeoutRef.current)
    draftTimeoutRef.current = setTimeout(() => {
      try {
        const key = `qts_draft_${room.roomId}`
        if (text.trim()) localStorage.setItem(key, text)
        else localStorage.removeItem(key)
      } catch (err) {
        console.error('Draft save failed:', err)
      }
    }, 400)
  }

  const clearDraft = () => {
    clearTimeout(draftTimeoutRef.current)
    try {
      localStorage.removeItem(`qts_draft_${room.roomId}`)
    } catch (err) {
      console.error('Draft clear failed:', err)
    }
  }
```

- [ ] **Step 2: Save on input, clear on plain send**

Find:

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    stopTyping()
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

Replace with:

```js
  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    const isPlainSend = !editingMessage && !replyingTo
    setValue('')
    stopTyping()
    if (isPlainSend) clearDraft()
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

Find:

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
    if (!editingMessage && !replyingTo) {
      saveDraft(e.target.value)
    }
  }
```

- [ ] **Step 3: Manual verification**

Setup as in Task 1 (reuse running Synapse/dev server if still up).

1. Open a chat, type some text without sending, switch to a different chat. Switch back — confirm the text is restored.
2. With that same draft still showing, reload the whole page, log back in if needed, open that chat again — confirm the draft survives the reload (this is the key difference from just in-memory state — verify it's actually reading from `localStorage`, e.g. via devtools Application/Storage tab).
3. Send the drafted message — confirm it sends normally, then switch away and back to that chat — confirm the draft is gone (empty composer), not reappearing.
4. Type in a chat, then clear the text back to empty (backspace to nothing) without sending — switch away and back — confirm no stale draft reappears (an emptied draft should have been removed, not saved as an empty string).
5. Start replying to a message (composer prefills with the reply UI), confirm this does NOT get saved as/overwrite that room's plain draft — cancel the reply and confirm any earlier plain draft for that room (if you had one from a previous step) is unaffected.
6. Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Chat/InputArea.jsx
git commit -m "Persist unsent composer text per chat"
```
