# Message Context Menu

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. Message
actions (react, reply, forward, edit-own, delete-own) currently only
surface via `MessageActions.jsx`, a small icon-only bar shown when
`MessageBubble.jsx` sets `hovered` to `true` on mouse-enter. There is no
right-click/context-menu affordance anywhere in the app; a right-click on
a message currently opens the browser's native context menu.

No component in this codebase uses a React portal — `Modal.jsx` (and
everything built on it, like `ForwardModal`) already renders a full-
viewport overlay via plain `position: 'fixed'` with no portal, rendered
inline from wherever it's used (e.g. `MessageBubble.jsx` already
conditionally renders `<Modal>`/`<ForwardModal>` inside its own returned
fragment, alongside the main message row). A cursor-anchored menu can
follow the same convention.

`MessageActions.jsx` defines `QUICK_REACTIONS` (a fixed 7-emoji list) as
a local, non-exported constant, used for its hover-triggered quick-react
row.

## Goal

Right-clicking any real message (not a date divider, system line, or
already-deleted message) opens a Telegram-style vertical context menu,
positioned at the cursor, offering the same actions already available via
the hover bar — plus copying the message's text, which isn't available
anywhere today. The existing hover bar is unaffected; both coexist, same
as in Telegram.

## Scope for this iteration

In scope:
1. `onContextMenu` on the message row, `preventDefault()`-ing the
   browser's native menu and opening a custom one anchored at the click
   position, clamped so it never renders off-screen.
2. Menu contents: a quick-reaction row (reusing the existing
   `QUICK_REACTIONS` list) at the top, then labeled rows for Reply,
   Forward, Copy text (only when the message has text), Edit (only for
   the user's own text messages), Delete (only for the user's own
   messages) — exactly mirroring `MessageActions`' existing visibility
   rules.
3. Closing on: clicking outside the menu, pressing Escape, or picking any
   action.

Explicitly out of scope:
- Opening via long-press on touch/mobile (this app's mobile layout is a
  separate concern not addressed here; right-click is a desktop-only
  gesture and that's acceptable for this iteration).
- Any action beyond what's listed above (no "Pin", "Select", "Copy link
  to message" — none of those exist elsewhere in this app either).
- A "..." button as an alternate way to open the same menu without
  right-clicking (out of scope; right-click is the only trigger for now).
- Reskinning or removing the existing hover bar — it stays exactly as is.

## Design

### 1. `MessageActions.jsx` — export the shared reaction list

Find:

```js
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']
```

Change to:

```js
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']
```

No other change to this file — the hover bar itself is untouched.

### 2. `Chat/MessageContextMenu.jsx` — new component

Props: `{ message, position: {x, y}, onClose, onReact, onReply,
onForward, onCopy, onEdit, onDeleteClick }` — `onCopy`/`onEdit`/
`onDeleteClick` are `undefined` when not applicable, exactly like
`MessageActions`' existing prop convention (the caller decides
applicability, the component just renders-or-not based on truthiness).

Positioning: rendered with `position: 'fixed'`, initially at the
requested `{x, y}`, then measured via `useLayoutEffect` +
`getBoundingClientRect()` after mount and clamped so it never overflows
the viewport (flips left/up if it would run off the right/bottom edge) —
the menu's real height varies with how many rows apply (own vs. others'
messages, text vs. media), so clamping from an actual measurement is more
robust than a hardcoded estimate.

Closing: the same click-outside + Escape pattern already established by
`EmojiPicker.jsx` in this codebase (a `mousedown` listener on `document`
checking `ref.current.contains(e.target)`, plus a `keydown` listener for
`Escape`).

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

### 3. `MessageBubble.jsx` wiring

New state: `contextMenu` (`{ x, y } | null`). New handler:

```js
const handleContextMenu = (e) => {
  e.preventDefault()
  setContextMenu({ x: e.clientX, y: e.clientY })
}

const handleCopy = () => {
  if (text != null) navigator.clipboard.writeText(text).catch(() => {})
}
```

`onContextMenu={handleContextMenu}` is added to the same outer message
row `<div>` that already carries `data-event-id` and the hover
`onMouseEnter`/`onMouseLeave` handlers — i.e. only real messages (not the
`date`/`system`/`deleted` early-return branches, which keep the native
browser context menu, matching how `MessageActions` already excludes
those same branches).

The menu is rendered conditionally alongside the existing
`confirmOpen`/`forwardOpen` conditional renders at the end of the
component's returned fragment:

```jsx
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
```

This reuses the exact same handlers (`handleReact`, `onReply`,
`setForwardOpen`, `onEdit`, `setConfirmOpen`) the hover bar already calls
— the context menu is a second entry point to identical behavior, not a
parallel implementation.

## Error handling

`navigator.clipboard.writeText` can reject (e.g. permissions denied in an
unusual browser context) — caught and silently ignored (`.catch(() =>
{})`), matching this codebase's existing convention of not surfacing
low-stakes, rare failures as user-facing errors (e.g. `MediaImage`'s
image-load handling).

## Testing

No automated test framework exists in `client/`. Manual verification:
right-click a message from another user — confirm the menu opens at the
cursor with reactions, Reply, Forward, Copy text (if it has text), no
Edit/Delete; right-click your own text message — confirm Edit and Delete
also appear; right-click your own non-text (image/file/voice) message —
confirm Delete appears but Edit and Copy text do not; pick a reaction
from the menu and confirm it reacts exactly like the hover bar's reaction
picker; pick Reply/Forward/Edit/Delete and confirm each opens the same
existing UI the hover bar's buttons already open; click Copy text and
paste elsewhere to confirm the clipboard has the message's text; open the
menu near each edge/corner of the browser window and confirm it stays
fully on-screen; open the menu then click elsewhere and confirm it
closes; open it again and press Escape, confirm it closes; confirm the
hover bar still works exactly as before (no regression); confirm no
console errors throughout.
