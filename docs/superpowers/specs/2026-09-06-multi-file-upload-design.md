# Multi-File / Drag-and-Drop Upload

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. Today,
`InputArea.jsx` has a single hidden `<input type="file">` (no `multiple`
attribute) triggered by the paperclip button; `handleFileChange` reads
only `e.target.files?.[0]` and calls `lib/matrix.js`'s `uploadFile(roomId,
file)` once, which uploads the content and sends one `m.room.message`
(`m.image` or `m.file`) immediately — no staging, no preview, no cancel.
There is no drag-and-drop anywhere in the app.

`Chat/index.jsx` is a thin layout shell: `Header` + `MessageList` +
`InputArea`, with `editingMessage`/`replyingTo` as its only state. `Modal`
components in this codebase already use `position: 'fixed'` directly
(no portal), so a full-pane drag overlay can be a plain conditionally-
rendered `<div>` in `Chat/index.jsx` without new infrastructure.

`forwardMessage` in `lib/matrix.js` is the existing precedent for
"one client action fans out to several server calls, some of which may
fail independently" — it uses `Promise.allSettled` and reports
`"Не удалось переслать в N из M чатов"` on partial failure. That pattern
doesn't fully apply here, though: forwarding sends the *same* message to
*different* rooms (order across rooms is irrelevant), whereas multi-file
upload sends *different* messages to the *same* room, where arrival order
is visible and matters.

## Goal

Selecting multiple files via the paperclip button, or dragging files onto
the chat window from the OS, uploads and sends each one as its own
message — in the order the files were selected/dropped — the same way a
single file already works today (immediate send, no staging).

## Scope for this iteration

In scope:
1. `<input type="file" multiple>` — the paperclip button's file picker
   accepts multiple files.
2. Drag-and-drop anywhere over the chat pane (header + message list +
   composer), with a full-pane overlay ("Отпустите файлы, чтобы
   отправить") shown while dragging files over it. Only triggers for
   actual files being dragged (`e.dataTransfer.types` includes `"Files"`),
   not other draggable page content.
3. Both entry points (file picker, drop) funnel through one shared
   handler that uploads files **sequentially** (await each one before
   starting the next), so messages land in the room in the order the user
   picked/dropped them.
4. Status text generalized from "Загрузка..." to "Загрузка файла N из
   M...".
5. One file's failure doesn't stop the rest — failures are collected and
   reported once at the end as an aggregate count, e.g. "Не удалось
   загрузить 2 из 5 файлов", following the existing
   `forwardMessage`-error-message convention. Successful files before/
   after a failure are still sent.

Explicitly out of scope:
- A staging/preview area (thumbnail list, per-file removal before
  sending, a "send" confirmation step). Every file starts uploading the
  moment it's picked or dropped, exactly like the current single-file
  behavior — this is a deliberate consistency choice, not a missing
  feature.
- Media grouping/albums (multiple images shown as one grouped message).
  Each file is still its own independent `m.room.message`, exactly as
  today.
- Paste-from-clipboard image upload.
- A per-byte upload progress bar (the existing "Загрузка..." text
  indicator, generalized to show file count, is enough).
- Reordering files during upload, pausing/resuming, retry-on-failure UI.

## Design

### 1. `InputArea.jsx` — multi-select input, no upload logic

`handleFileChange` and the upload state (`uploading`, `uploadError`) move
out of this component (see §2). `InputArea` keeps owning the button and
hidden input, but the input gains `multiple` and its `onChange` now calls
a prop, `onFiles(fileList)`, passed down from `Chat/index.jsx`:

```jsx
<input
  ref={fileInputRef}
  type="file"
  multiple
  style={{ display: 'none' }}
  onChange={e => { onFiles(e.target.files); e.target.value = '' }}
/>
```

`uploading`/`uploadError` become props (`uploading`, `uploadError`)
instead of local state, rendered in the same place the existing status
line already is.

### 2. `Chat/index.jsx` — owns upload orchestration and the drop zone

New state: `uploading` (boolean), `uploadError` (string), `dragActive`
(boolean, drives the overlay), plus a `dragCounter` ref to avoid overlay
flicker when the dragged item passes over child elements (`dragenter`/
`dragleave` fire on every element boundary crossed, not just the
outermost container — a plain boolean toggled on both events flickers;
a counter incremented on `dragenter` and decremented on `dragleave`,
showing the overlay whenever count > 0, does not).

```js
const handleFiles = async (fileList) => {
  const files = Array.from(fileList || [])
  if (files.length === 0) return
  setUploading(true)
  setUploadError('')
  let failed = 0
  for (let i = 0; i < files.length; i++) {
    try {
      await uploadFile(room.roomId, files[i])
    } catch (err) {
      console.error('Upload failed:', err)
      failed++
    }
  }
  setUploading(false)
  if (failed > 0) {
    setUploadError(
      files.length === 1
        ? 'Не удалось загрузить файл'
        : `Не удалось загрузить ${failed} из ${files.length} файлов`
    )
  }
}
```

Drag handlers on the root `<div>`:

```jsx
const dragCounterRef = useRef(0)

const handleDragEnter = (e) => {
  if (!e.dataTransfer.types.includes('Files')) return
  e.preventDefault()
  dragCounterRef.current++
  setDragActive(true)
}
const handleDragOver = (e) => {
  if (!e.dataTransfer.types.includes('Files')) return
  e.preventDefault()
}
const handleDragLeave = (e) => {
  if (!e.dataTransfer.types.includes('Files')) return
  dragCounterRef.current--
  if (dragCounterRef.current <= 0) {
    dragCounterRef.current = 0
    setDragActive(false)
  }
}
const handleDrop = (e) => {
  if (!e.dataTransfer.types.includes('Files')) return
  e.preventDefault()
  dragCounterRef.current = 0
  setDragActive(false)
  handleFiles(e.dataTransfer.files)
}
```

Overlay, rendered as a sibling inside the root `<div>` when `dragActive`:

```jsx
{dragActive && (
  <div style={{
    position: 'absolute', inset: 0, zIndex: 50,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0, 229, 176, 0.08)',
    border: '2px dashed var(--accent-teal)', borderRadius: '8px',
    pointerEvents: 'none',
  }}>
    <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--accent-teal)' }}>
      Отпустите файлы, чтобы отправить
    </span>
  </div>
)}
```

The root `<div>` needs `position: 'relative'` added (it's currently a
plain flex column with no positioning context) so the overlay's
`position: absolute` covers exactly the chat pane. `pointerEvents: 'none'`
on the overlay keeps the `dragleave`/`drop` events landing on the
underlying pane rather than the overlay itself, which is what makes the
`dragCounter` approach correct — the browser fires `dragenter`/
`dragleave` for the elements the pointer is actually over, and an overlay
that intercepted pointer events would introduce yet another element
boundary to count.

`InputArea` receives the new props:

```jsx
<InputArea
  client={client}
  room={room}
  editingMessage={editingMessage}
  onCancelEdit={() => setEditingMessage(null)}
  replyingTo={replyingTo}
  onCancelReply={() => setReplyingTo(null)}
  onFiles={handleFiles}
  uploading={uploading}
  uploadError={uploadError}
/>
```

## Error handling

- A file that fails (server rejects for size/type, network error) doesn't
  stop the loop — the remaining files still upload, and the failure is
  only surfaced once, in aggregate, after the whole batch finishes.
- The drag overlay only ever appears for an actual file drag (checked via
  `dataTransfer.types`), so dragging selected message text or other page
  content never triggers it.

## Testing

No automated test framework exists in `client/`. Manual verification:
select 3 files at once via the paperclip button and confirm they appear
in the room as 3 separate messages, in the order selected; drag 2 files
from the OS file explorer onto different parts of the chat pane (header,
message list, composer) and confirm the overlay appears/disappears
correctly as the drag enters/leaves the window, and dropping sends both
files in order; drag a mix where one file exceeds the server's
`max_upload_size` and confirm the other file(s) still send while an
aggregate error appears; drag non-file content (e.g. selected text) over
the chat and confirm no overlay appears; confirm single-file selection via
the button still works exactly as before (no regression); confirm no
console errors throughout.
