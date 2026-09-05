# Multi-File / Drag-and-Drop Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting multiple files via the paperclip button, or dragging files onto the chat window, uploads and sends each one as its own message, sequentially, in the order picked/dropped — per `docs/superpowers/specs/2026-09-06-multi-file-upload-design.md`.

**Architecture:** Task 1 moves upload orchestration (`uploading`/`uploadError` state, the sequential per-file upload loop) from `InputArea.jsx` up into `Chat/index.jsx`, and makes the file `<input>` accept `multiple` — both the button-driven picker and (in Task 2) drag-and-drop funnel through the same `handleFiles(fileList)` function. Task 2 adds drag-and-drop handlers and a full-pane drop overlay to `Chat/index.jsx`, calling the same `handleFiles` Task 1 already built.

**Tech Stack:** React 18 + Vite, `matrix-js-sdk` v34, inline styles + CSS custom properties, no test framework.

## Global Constraints

- No automated test framework exists in `client/` — every task's test step is manual browser verification against the disposable local Synapse harness (`scripts/dev/local-test-synapse.sh`).
- UI copy is Russian, matching existing strings.
- Styling: inline `style={{...}}` objects using `var(--...)` CSS custom properties. No new CSS files, no class-based styling.
- Files upload immediately on selection/drop, sequentially, in order — no staging/preview/cancel step, no media grouping/albums, no per-byte progress bar, no paste-from-clipboard support. All explicitly out of scope.
- One file's failure must not stop the rest of the batch; failures are reported once as an aggregate count after the whole batch finishes.

---

### Task 1: Multi-select upload, orchestration moved to `Chat/index.jsx`

**Files:**
- Modify: `client/src/components/Chat/InputArea.jsx`
- Modify: `client/src/components/Chat/index.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Produces (`Chat/index.jsx`): `handleFiles(fileList)` — async, uploads every file in `fileList` sequentially via `uploadFile(room.roomId, file)` (already exported from `lib/matrix.js`), tracks `uploading`/`uploadError` state, and is passed down to `InputArea` as the `onFiles` prop. Task 2 calls this same function from its drop handler — do not rename it or change its signature (`fileList: FileList | File[]`) without checking Task 2's expectations.
- Produces (`InputArea.jsx`): no longer owns `uploading`/`uploadError` state — receives them as props (`uploading`, `uploadError`) alongside a new `onFiles` prop.

- [ ] **Step 1: Remove upload state and logic from `InputArea.jsx`, accept props instead**

**Correction found during review:** `uploading`/`uploadError` in this file are NOT only used by file uploads — `handleStartRecording` and `handleSendRecording` (the voice/video-note recording feature, further down in this same file) also call `setUploadError`/`setUploading`. Deleting the local state pair without giving the recording feature its own replacement breaks recording with a `ReferenceError`. The steps below account for this: the file-batch `uploading`/`uploadError` become props, and recording gets its own new local `recordingBusy`/`recordingError` state instead of sharing names with the deleted setters.

Find:

```jsx
export default function InputArea({ client, room, editingMessage, onCancelEdit, replyingTo, onCancelReply }) {
  const [value, setValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
```

Replace with:

```jsx
export default function InputArea({ client, room, editingMessage, onCancelEdit, replyingTo, onCancelReply, onFiles, uploading, uploadError }) {
  const [value, setValue] = useState('')
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [recordingError, setRecordingError] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
```

Now find every other use of the deleted `setUploading`/`setUploadError` setters in this file (in `handleStartRecording` and `handleSendRecording`) and rename them to the new recording-specific setters — `setUploadError(...)` becomes `setRecordingError(...)`, `setUploading(true)`/`setUploading(false)` become `setRecordingBusy(true)`/`setRecordingBusy(false)`, with arguments otherwise unchanged. Do this before continuing — the file must not reference `setUploading`/`setUploadError` anywhere once this step is done, since the props of the same read-only names (added below) carry no setter.

Find:

```jsx
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

```

Delete this whole block — file uploads are now handled by the `onFiles` prop, called directly from the file input's `onChange` (Step 2).

Find:

```jsx
import { sendMessage, uploadFile, uploadVoiceMessage, uploadVideoNote, editMessage, sendReply } from '../../lib/matrix'
```

Replace with:

```jsx
import { sendMessage, uploadVoiceMessage, uploadVideoNote, editMessage, sendReply } from '../../lib/matrix'
```

(`uploadFile` is no longer called from this file — it's called from `Chat/index.jsx` now.)

- [ ] **Step 2: Wire the file input to `onFiles`, add `multiple`**

Find:

```jsx
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
```

Replace with:

```jsx
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={e => { onFiles(e.target.files); e.target.value = '' }}
      />
```

- [ ] **Step 3: Show upload progress as "file N of M"**

`uploading` becomes either `false` or `{ current, total }` (produced by
`Chat/index.jsx` in the next step) instead of a plain boolean. This status
line now has two independent sources — the file-batch upload (`uploading`/
`uploadError` props) and local recording (`recordingBusy`/`recordingError`,
from Step 1's correction) — either can be showing at a time, never both
simultaneously in practice, but the line should reflect whichever is
active. Find:

```jsx
      {(uploadError || uploading) && (
        <div style={{ fontSize: '11px', color: uploadError ? '#ff4d4d' : 'var(--text-muted)', padding: '4px 2px 0', textAlign: 'right' }}>
          {uploadError || 'Загрузка...'}
        </div>
      )}
```

Replace with:

```jsx
      {(uploadError || uploading || recordingError || recordingBusy) && (
        <div style={{ fontSize: '11px', color: (uploadError || recordingError) ? '#ff4d4d' : 'var(--text-muted)', padding: '4px 2px 0', textAlign: 'right' }}>
          {uploadError || recordingError || (uploading && uploading.total > 1 ? `Загрузка файла ${uploading.current} из ${uploading.total}...` : 'Загрузка...')}
        </div>
      )}
```

- [ ] **Step 4: Add `handleFiles` and upload state to `Chat/index.jsx`**

Find:

```jsx
import { useState } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'

export default function Chat({ client, room, navMode, onNav, onLeave, jumpToEventId }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
```

Replace with:

```jsx
import { useState } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'
import { uploadFile } from '../../lib/matrix'

export default function Chat({ client, room, navMode, onNav, onLeave, jumpToEventId }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setUploadError('')
    let failed = 0
    for (let i = 0; i < files.length; i++) {
      setUploading({ current: i + 1, total: files.length })
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

- [ ] **Step 5: Pass the new props to `InputArea`**

Find:

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

Replace with:

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

- [ ] **Step 6: Manual verification**

Setup: `bash scripts/dev/local-test-synapse.sh start` (reuse if already
running — check `docker ps`), `cd client && npm run dev`, log in as
`tester1` in a room.

1. Click the paperclip button and select 3 files at once in the native
   file picker (multi-select is now allowed) — confirm all 3 appear as
   separate messages in the room, in the same order they were listed in
   the picker.
2. While that batch is uploading, confirm the status text reads
   "Загрузка файла N из 3..." and the number increments as each file
   finishes, then clears once done.
3. Select a single file (not multi-select) — confirm the status text
   reads plain "Загрузка..." (not "файла 1 из 1") and everything else
   works exactly as before this change (no regression).
4. Temporarily break one upload (e.g. select a file larger than the
   server's configured max, or disconnect network mid-batch if feasible)
   among a batch of 2+ files — confirm the other file(s) still send, and
   an aggregate error like "Не удалось загрузить 1 из 2 файлов" appears.
5. Confirm no console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Chat/InputArea.jsx client/src/components/Chat/index.jsx
git commit -m "Support selecting multiple files at once"
```

---

### Task 2: Drag-and-drop onto the chat pane

**Files:**
- Modify: `client/src/components/Chat/index.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: Task 1's `handleFiles(fileList)`, already defined in this same file.

- [ ] **Step 1: Add drag state and handlers**

Find:

```jsx
export default function Chat({ client, room, navMode, onNav, onLeave, jumpToEventId }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
```

Replace with:

```jsx
export default function Chat({ client, room, navMode, onNav, onLeave, jumpToEventId }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const dragCounterRef = useRef(0)
```

Find:

```jsx
import { useState } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'
import { uploadFile } from '../../lib/matrix'
```

Replace with:

```jsx
import { useState, useRef } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'
import { uploadFile } from '../../lib/matrix'
```

Find:

```jsx
  const handleReply = (msg) => {
    setEditingMessage(null)
    setReplyingTo(msg)
  }
```

Insert immediately after it:

```jsx

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

`dragCounterRef` (not a boolean) avoids overlay flicker: `dragenter`/
`dragleave` fire on every element boundary the dragged item crosses, not
just the outermost pane, so a plain boolean toggled by both events
flickers as the pointer passes over child elements (header, message
rows, composer). A counter incremented on enter and decremented on leave,
showing the overlay whenever it's above zero, does not.

- [ ] **Step 2: Attach the handlers and render the overlay**

Find:

```jsx
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-primary)',
      minWidth: 0,
    }}>
      <Header client={client} room={room} navMode={navMode} onNav={onNav} onLeave={onLeave} />
```

Replace with:

```jsx
  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-primary)',
        minWidth: 0,
        position: 'relative',
      }}>
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
      <Header client={client} room={room} navMode={navMode} onNav={onNav} onLeave={onLeave} />
```

`pointerEvents: 'none'` on the overlay is what keeps the counter approach
correct — the overlay never itself becomes the element the pointer is
"over," so `dragleave` events keep firing on the underlying pane's real
children exactly as they would without the overlay present, and the
counter's enter/leave pairs stay balanced.

- [ ] **Step 3: Manual verification**

Setup as in Task 1.

1. Drag 2 files from the OS file explorer onto the chat's message list
   area — confirm the teal-dashed overlay with "Отпустите файлы, чтобы
   отправить" appears while dragging over it.
2. While still dragging, move the cursor over the header and the
   composer (still within the chat pane) — confirm the overlay stays
   visible continuously (no flicker) as the cursor crosses between
   internal elements.
3. Drag the files out of the browser window entirely (or onto the
   sidebar, outside this pane) — confirm the overlay disappears.
4. Drop the files back onto the chat pane — confirm the overlay
   disappears and both files send as separate messages, in the order
   the OS reports them in the drop (this matches whatever order
   `e.dataTransfer.files` provides, which is the browser's/OS's own
   ordering — not independently controlled by this code).
5. Select some message text in the chat and drag-select it (a non-file
   drag) — confirm the overlay does NOT appear.
6. Confirm no console errors throughout, and confirm the paperclip
   button's multi-select (Task 1) still works.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Chat/index.jsx
git commit -m "Add drag-and-drop file upload to the chat pane"
```
