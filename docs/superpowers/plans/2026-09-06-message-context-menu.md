# Message Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-clicking a message opens a Telegram-style vertical context menu at the cursor, offering the same actions as the existing hover bar plus copying the message's text — per `docs/superpowers/specs/2026-09-06-message-context-menu-design.md`.

**Architecture:** A single task. `MessageActions.jsx` exports its existing `QUICK_REACTIONS` list so it can be reused. A new `MessageContextMenu.jsx` renders a `position: fixed`, cursor-anchored, viewport-clamped menu (measured and repositioned via `useLayoutEffect`, closed via the same click-outside/Escape pattern `EmojiPicker.jsx` already uses). `MessageBubble.jsx` wires an `onContextMenu` handler on the message row and renders the new menu, calling the exact same handlers the hover bar already calls.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- The context menu is a second entry point to existing behavior, not a new implementation of it — every action must call the same handler the hover bar already uses.
- Long-press/touch support, a "..." button alternative trigger, and any action beyond React/Reply/Forward/Copy text/Edit/Delete are explicitly out of scope.

---

### Task 1: Context menu on right-click

**Files:**
- Modify: `client/src/components/Chat/MessageActions.jsx`
- Create: `client/src/components/Chat/MessageContextMenu.jsx`
- Modify: `client/src/components/Chat/MessageBubble.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`MessageActions.jsx`): `QUICK_REACTIONS` (array of emoji strings) is now exported, not just module-local.
- Produces (`MessageContextMenu.jsx`): default export `MessageContextMenu({ position: {x, y}, onClose, onReact, onReply, onForward, onCopy, onEdit, onDeleteClick })` — `onCopy`/`onEdit`/`onDeleteClick` are optional; the component renders a menu row for each only when that prop is truthy.

- [ ] **Step 1: Export `QUICK_REACTIONS` from `MessageActions.jsx`**

Find:

```js
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']
```

Replace with:

```js
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']
```

- [ ] **Step 2: Create `MessageContextMenu.jsx`**

Create `client/src/components/Chat/MessageContextMenu.jsx`:

```jsx
import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { QUICK_REACTIONS } from './MessageActions'

function MenuItem({ onClick, children, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '9px 14px', textAlign: 'left', fontSize: '13px',
        color: danger ? '#ff6b6b' : 'var(--text-primary)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {children}
    </button>
  )
}

export default function MessageContextMenu({ position, onClose, onReact, onReply, onForward, onCopy, onEdit, onDeleteClick }) {
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

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', zIndex: 200, ...style,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: '180px', padding: '4px', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 4px 8px' }}>
        {QUICK_REACTIONS.map(e => (
          <button
            key={e}
            onClick={() => run(() => onReact(e))}
            style={{ width: '30px', height: '30px', borderRadius: '6px', fontSize: '17px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
            onMouseLeave={ev => { ev.currentTarget.style.background = 'none' }}
          >
            {e}
          </button>
        ))}
      </div>
      <MenuItem onClick={() => run(onReply)}>↩ Ответить</MenuItem>
      <MenuItem onClick={() => run(onForward)}>➦ Переслать</MenuItem>
      {onCopy && <MenuItem onClick={() => run(onCopy)}>📋 Копировать текст</MenuItem>}
      {onEdit && <MenuItem onClick={() => run(onEdit)}>✎ Редактировать</MenuItem>}
      {onDeleteClick && <MenuItem danger onClick={() => run(onDeleteClick)}>🗑 Удалить</MenuItem>}
    </div>
  )
}
```

- [ ] **Step 3: Wire it into `MessageBubble.jsx`**

Find:

```jsx
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import { findMentionSpans } from '../../lib/mentions'
import { findUrlSpans } from '../../lib/linkify'
import useResolvedMedia from '../../lib/useResolvedMedia'
import LinkPreview from './LinkPreview'
import MessageActions from './MessageActions'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

Replace with:

```jsx
import { resolveMediaUrl, toggleReaction, deleteMessage } from '../../lib/matrix'
import { findMentionSpans } from '../../lib/mentions'
import { findUrlSpans } from '../../lib/linkify'
import useResolvedMedia from '../../lib/useResolvedMedia'
import LinkPreview from './LinkPreview'
import MessageActions from './MessageActions'
import MessageContextMenu from './MessageContextMenu'
import Modal from '../Modals/Modal'
import ForwardModal from '../Modals/ForwardModal'
```

Find:

```jsx
export default function MessageBubble({ message, roomId, onEdit, onReply, highlighted }) {
  const [hovered, setHovered] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
```

Replace with:

```jsx
export default function MessageBubble({ message, roomId, onEdit, onReply, highlighted }) {
  const [hovered, setHovered] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
```

Find:

```jsx
  const handleDelete = async () => {
    setConfirmOpen(false)
    try {
      await deleteMessage(roomId, message.id)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }
```

Insert immediately after it:

```jsx

  const handleContextMenu = (e) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCopy = () => {
    if (text != null) navigator.clipboard.writeText(text).catch(() => {})
  }
```

Find:

```jsx
    <div
      data-event-id={message.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
```

Replace with:

```jsx
    <div
      data-event-id={message.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={handleContextMenu}
      style={{
```

Find:

```jsx
    {forwardOpen && (
      <ForwardModal message={message} roomId={roomId} onClose={() => setForwardOpen(false)} />
    )}
    </>
  )
}
```

Replace with:

```jsx
    {forwardOpen && (
      <ForwardModal message={message} roomId={roomId} onClose={() => setForwardOpen(false)} />
    )}
    {contextMenu && (
      <MessageContextMenu
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        onReact={handleReact}
        onReply={() => onReply(message)}
        onForward={() => setForwardOpen(true)}
        onCopy={text != null ? handleCopy : undefined}
        onEdit={isOwn && text != null ? () => onEdit(message) : undefined}
        onDeleteClick={isOwn ? () => setConfirmOpen(true) : undefined}
      />
    )}
    </>
  )
}
```

`text` and `isOwn` are already destructured from `message` earlier in this
component (`const { isOwn, sender, avatar, time, text, file, image, voice,
roundVideo, reactions, readBy } = message`), and `handleReact` already
exists (used by both the reactions footer and the hover bar) — no new
destructuring or handler duplication needed.

- [ ] **Step 4: Manual verification**

Setup: `bash scripts/dev/local-test-synapse.sh start` (reuse if already
running — check `docker ps`), `cd client && npm run dev`, log in as
`tester1` in a room shared with `tester2`.

1. Right-click a message from `tester2` — confirm the browser's native
   context menu does NOT appear, and instead a custom menu opens at the
   cursor with: a reaction row, "Ответить", "Переслать", and (if the
   message has text) "Копировать текст" — but no "Редактировать" or
   "Удалить" (not your own message).
2. Right-click your own text message — confirm "Редактировать" and
   "Удалить" also appear.
3. Right-click your own image/file/voice message (no text) — confirm
   "Удалить" appears but "Редактировать" and "Копировать текст" do not.
4. Click a reaction in the menu — confirm it reacts exactly like the
   hover bar's quick-reaction row would, and the menu closes.
5. Click "Ответить" — confirm it opens the same reply-composer state the
   hover bar's reply button opens. Click "Переслать" — confirm the same
   `ForwardModal` opens. On your own message, click "Редактировать" —
   confirm the same edit-composer state opens. Click "Удалить" — confirm
   the same delete-confirmation `Modal` opens.
6. Click "Копировать текст", then paste (e.g. into the message composer)
   — confirm the pasted text matches the message's text.
7. Right-click a message near each edge/corner of the browser window
   (top-left, top-right, bottom-left, bottom-right) — confirm the menu
   stays fully on-screen every time (flips to whichever side fits).
8. Open the menu, then click elsewhere in the app — confirm it closes.
   Open it again and press Escape — confirm it closes.
9. Confirm the existing hover bar (icons appearing on mouse-enter) still
   works exactly as before — no regression.
10. Confirm no console errors throughout.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Chat/MessageActions.jsx client/src/components/Chat/MessageContextMenu.jsx client/src/components/Chat/MessageBubble.jsx
git commit -m "Add right-click context menu for message actions"
```
