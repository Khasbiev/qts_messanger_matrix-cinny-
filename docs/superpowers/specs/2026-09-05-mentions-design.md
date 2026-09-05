# @Mentions

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`. Messages
are currently sent as plain text only — `sendMessage()` in `lib/matrix.js`
calls `_client.sendTextMessage(roomId, text)` with no formatting at all.
The one exception is `sendReply()`, which already builds a `formatted_body`
(`format: 'org.matrix.custom.html'`) with `<a href="https://matrix.to/#/...">`
links for its quoted-reply fallback, using a local `escapeHtml()` helper —
this is the existing precedent for HTML content in this codebase.

Room membership is available synchronously and locally via
`room.getJoinedMembers()` (`RoomMember[]`, each with `.userId` and `.name`),
already used the same way in `ChatInfoModal.jsx` and `Header.jsx`. No
network round-trip is needed to build a mention candidate list.

`MessageList.jsx`'s `extractMessages()` is the single place that turns raw
timeline events into the message objects `MessageBubble.jsx` renders,
folding in reactions/edits/redactions/replies/forwards the same way this
feature needs to fold in mentions.

## Goal

Typing `@Name` in the composer — either picked from an autocomplete
dropdown or typed out by hand — turns into a Matrix mention: the recipient
gets highlighted (both the inline "@Name" text and, for the mentioned user
specifically, the whole message bubble), and the message carries the
standard `m.mentions` field so homeserver push rules see it as a real
mention.

## Scope for this iteration

In scope:
1. An inline autocomplete dropdown in the composer, triggered by typing
   `@`, filtered against the current room's joined members (local only, no
   server call), with keyboard navigation and click-to-select.
2. Mention detection at send time (`sendMessage`, `sendReply`,
   `editMessage`): any exact `@DisplayName` token in the text — whether
   inserted by the autocomplete or typed by hand — is resolved against the
   room's current members and turned into `m.mentions.user_ids` plus a
   `formatted_body` mention pill (`<a href="https://matrix.to/#/@id:server">`).
   Messages with no resolvable mention are sent exactly as today, with no
   format change.
3. Rendering: the resolved mention is shown as a styled inline span (not a
   link, not clickable) in the message text. If the current user is one of
   the mentioned users, the message bubble gets a permanent accent
   (left border + background tint), distinct from the temporary
   search-jump highlight flash that already exists.

Explicitly out of scope:
- Clicking a mention pill (no profile view, no DM shortcut).
- A separate "mentions" unread counter in the sidebar — the existing
  unread badge is unaffected.
- `@all` / `@room` / `@channel` broadcast mentions.
- Mentioning users who aren't currently joined to the room.
- Disambiguating two joined members who happen to share the exact same
  display name — the first match (by iteration order) wins. Acceptable
  for an invite-only ~30-person deployment where duplicate display names
  are not expected in practice.

## Design

### 1. `lib/mentions.js` — new, dependency-free module

Shared by both the send path (`lib/matrix.js`) and the render path
(`MessageBubble.jsx`), so the exact same matching rule governs what counts
as a mention in both directions.

```js
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// members: [{ userId, name }] — a RoomMember-shaped array (or a plain
// array of the same shape, for the render path where names are already
// resolved). Returns non-overlapping, position-sorted spans.
export function findMentionSpans(text, members) {
  const candidates = members
    .filter(m => m.name && m.userId)
    .sort((a, b) => b.name.length - a.name.length) // longest name first
  const claimed = []
  const spans = []

  for (const member of candidates) {
    const pattern = new RegExp(
      `(^|\\s)@${escapeRegExp(member.name)}(?=$|[\\s.,!?;:)\\]])`,
      'g'
    )
    let match
    while ((match = pattern.exec(text))) {
      const start = match.index + match[1].length
      const end = start + 1 + member.name.length
      if (claimed.some(c => start < c.end && end > c.start)) continue
      claimed.push({ start, end })
      spans.push({ start, end, userId: member.userId, displayName: member.name })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

// Assembles an HTML fragment with mention pills, given the caller's own
// escapeHtml (kept out of this module to avoid it depending on
// lib/matrix.js — matrix.js depends on this module, not the other way).
export function buildMentionHtml(text, spans, escapeHtml) {
  let html = ''
  let cursor = 0
  for (const span of spans) {
    html += escapeHtml(text.slice(cursor, span.start))
    html += `<a href="https://matrix.to/#/${span.userId}">${escapeHtml(text.slice(span.start, span.end))}</a>`
    cursor = span.end
  }
  html += escapeHtml(text.slice(cursor))
  return html
}
```

Word-boundary rule: a match must be preceded by start-of-string or
whitespace, and followed by end-of-string, whitespace, or common
punctuation (`.,!?;:)]`). This is what lets "typed by hand, not via
autocomplete" still work, while not matching a display name that's a
substring of a longer word.

### 2. `lib/matrix.js` — send-side wiring

`sendMessage`:
```js
export async function sendMessage(roomId, text) {
  if (!_client) throw new Error('Not connected')
  const spans = findMentionSpans(text, mentionCandidates(roomId))
  if (spans.length === 0) return _client.sendTextMessage(roomId, text)
  return _client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: text,
    format: 'org.matrix.custom.html',
    formatted_body: buildMentionHtml(text, spans, escapeHtml),
    'm.mentions': { user_ids: [...new Set(spans.map(s => s.userId))] },
  })
}

function mentionCandidates(roomId) {
  const room = _client.getRoom(roomId)
  if (!room) return []
  const me = _client.getUserId()
  return room.getJoinedMembers().filter(m => m.userId !== me)
}
```

`sendReply` gains the same treatment, applied only to the actual reply
text (not the quoted snippet): the existing
`htmlFallback = ...${escapeHtml(text)}` becomes
`...${spans.length ? buildMentionHtml(text, spans, escapeHtml) : escapeHtml(text)}`,
and `m.mentions` is added to the sent content when `spans.length > 0`. The
`plainFallback` body (used by non-rich clients) is unchanged — it already
contains the literal `@DisplayName` text.

`editMessage` computes spans for `newText` the same way and, when present,
adds `format`/`formatted_body`/`m.mentions` **inside `m.new_content`**
(the fields that edit-aware clients read), leaving the top-level
`body: "* ${newText}"` fallback untouched:
```js
export async function editMessage(roomId, eventId, newText) {
  if (!_client) throw new Error('Not connected')
  const spans = findMentionSpans(newText, mentionCandidates(roomId))
  const newContent = { msgtype: 'm.text', body: newText }
  if (spans.length > 0) {
    newContent.format = 'org.matrix.custom.html'
    newContent.formatted_body = buildMentionHtml(newText, spans, escapeHtml)
    newContent['m.mentions'] = { user_ids: [...new Set(spans.map(s => s.userId))] }
  }
  return _client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `* ${newText}`,
    'm.new_content': newContent,
    'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
  })
}
```

### 3. `MessageList.jsx` — render-side extraction

`extractMessages()` already tracks `editsByTarget` (event ID → replacement
body) for `m.replace` relations and applies it after the main pass. Extend
that map to carry mentions too:

```js
if (rel?.rel_type === 'm.replace') {
  const newContent = ev.getContent()['m.new_content']
  if (newContent?.body != null) {
    editsByTarget.set(rel.event_id, {
      body: newContent.body,
      mentionedUserIds: newContent['m.mentions']?.user_ids || [],
    })
  }
  continue
}
```

On the initial pass, set `base.mentionedUserIds = content['m.mentions']?.user_ids || []`.
In the merge loop (where `editedBody` is currently applied), also apply
the edit's mentions when present:
```js
const edit = editsByTarget.get(msg.id)
if (edit != null && msg.text != null) {
  msg.text = edit.body
  msg.edited = true
  msg.mentionedUserIds = edit.mentionedUserIds
}
```
Finally, resolve display names once (current names, not names-at-send-time
— consistent with how sender names are already resolved live elsewhere in
this function) and compute the "does this mention me" flag:
```js
msg.mentions = msg.mentionedUserIds
  .map(uid => ({ userId: uid, name: room.getMember(uid)?.name || uid.replace('@', '').split(':')[0] }))
msg.mentionsMe = msg.mentionedUserIds.includes(me)
```

### 4. `MessageBubble.jsx` — rendering

Import `findMentionSpans` from `lib/mentions.js`. Replace the plain
`{text}` render with a small local helper:
```jsx
function renderWithMentions(text, mentions) {
  if (!mentions?.length) return text
  const spans = findMentionSpans(text, mentions)
  if (spans.length === 0) return text
  const nodes = []
  let cursor = 0
  spans.forEach((span, i) => {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    nodes.push(
      <span key={i} style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
        {text.slice(span.start, span.end)}
      </span>
    )
    cursor = span.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
```
called as `renderWithMentions(text, message.mentions)` in place of the bare
`text` inside the existing `<p>`.

The message content wrapper (the div currently styled with
`background: isOwn ? '#0d3326' : 'var(--bg-card)'`) gets, when
`message.mentionsMe` is true: `borderLeft: '3px solid var(--accent-orange)'`
and a light background tint (`rgba(255, 107, 53, 0.08)`) layered under the
existing background — this is permanent (tied to the message, not a
timed effect), unlike the existing `highlighted` prop which drives the
temporary fade-out flash used by jump-to-search-result and is unrelated to
this feature.

### 5. `MentionAutocomplete.jsx` — new component, and `InputArea.jsx` wiring

New file `Chat/MentionAutocomplete.jsx`: a presentational dropdown, styled
like `EmojiPicker.jsx` (`position: absolute`, `background: var(--bg-surface)`,
bordered, positioned above the composer — `bottom: 54px; left: 8px` instead
of `EmojiPicker`'s `right: 0`). Props: `members` (already filtered/sorted),
`selectedIndex`, `onSelect(member)`, `onHover(index)`.

`InputArea.jsx` owns the trigger detection, since it already owns
`value`/`textareaRef`:
- New state: `mentionQuery` (string or `null`), `mentionStart` (caret index
  of the `@`), `mentionIndex` (selected row, resets to 0 whenever the
  filtered list changes).
- In `handleInput`, after updating `value`, run a regex against the text
  up to the caret: `/(?:^|\s)@([^\s@]*)$/`. A match sets `mentionQuery` to
  the captured group and `mentionStart` to the `@`'s index; no match
  clears `mentionQuery`.
- Filtered members: `room.getJoinedMembers()` minus self, minus those
  without a `.name`, substring-matched case-insensitively against
  `mentionQuery` (empty query shows all, capped to a reasonable count,
  e.g. 8, to keep the dropdown short).
- In `handleKeyDown`, when `mentionQuery != null` and the filtered list is
  non-empty: `ArrowDown`/`ArrowUp` move `mentionIndex` (wrapping), `Enter`
  or `Tab` select the highlighted row (preventing the existing send-on-Enter
  behavior), `Escape` clears `mentionQuery` without touching the text.
  Otherwise, existing key handling is unchanged.
- Selecting a member replaces the text from `mentionStart` to the current
  caret with `@${member.name} ` (trailing space), moves the caret to just
  after the inserted text, refocuses the textarea, and clears
  `mentionQuery`.

## Error handling

None of this touches the network beyond the existing `sendMessage` calls —
member lookup is local/synchronous. No new failure modes are introduced;
a message that fails to send fails exactly as it does today (existing
try/catch in `InputArea.handleSend`).

## Testing

No automated test framework exists in `client/`. Manual verification with
two logged-in test users (`tester1`/`tester2`) in a shared room:
- Typing `@` shows the dropdown filtered to joined members (excluding
  self); typing more narrows it; arrow keys move selection; Enter/Tab
  inserts the name; Escape dismisses without altering typed text.
- Sending a message with a selected/typed `@Name` shows the name
  highlighted in the sent bubble for both participants, and the receiving
  user's bubble gets the permanent accent border/tint.
- A message with no `@Name` sends and renders exactly as before (no
  regression to plain-text messages).
- Editing a message to add or remove a mention updates the highlight
  accordingly.
- A reply that includes a mention shows both the quoted-reply block and
  the mention highlight correctly.
- A name that's a substring of another joined member's name (if two test
  users are named so it's testable) resolves to the longest/correct match.
