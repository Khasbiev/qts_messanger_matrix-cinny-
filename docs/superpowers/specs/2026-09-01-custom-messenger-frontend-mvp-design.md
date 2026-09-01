# Custom Messenger Frontend — MVP for User Test Stand

## Context

The repo already contains an uncommitted `client/` directory: a React + Vite frontend
built directly on `matrix-js-sdk`, styled to match `corporate_messenger_ui.html`
(dark theme, teal/orange accents, `qts.dev` branding). It talks to the production
Matrix Synapse server (`matrix.messanger.qts.dev`) which is already deployed and live.

Verified working end-to-end against a disposable local Synapse instance (two test
users, a shared room): login, session restore, room list sync, real-time send,
real-time receive. Roughly 60% of the design in `corporate_messenger_ui.html` is
implemented and functional.

Not yet functional: creating chats from the UI, file upload/download, message
formatting toolbar, search, typing indicators, read receipts, E2E encryption.

## Goal

Bring `client/` to a state usable as a **test stand**: an internal group of people
(not necessarily one single team — potentially several unrelated groups of testers)
can register (invite-only, admin-created accounts), log in, start conversations,
and use the messenger for real day-to-day chat, including files.

## Scope for this iteration

In scope:
1. Create channels and direct messages from the UI (currently only possible via
   Matrix admin API/CLI).
2. Upload and receive files, with inline preview for images.
3. Fix DM/channel misclassification in the sidebar (see Known bug below).

Explicitly out of scope for this iteration (confirmed with user):
- End-to-end encryption (`matrix-js-sdk` supports it, but wiring a crypto store and
  device-verification UI is a substantial chunk of work on its own — deferred).
- Message formatting toolbar (bold/italic/list/@mention) — icons stay decorative.
- Search, typing indicators, read receipts, notifications.
- Any notion of "groups/orgs" that would isolate sets of testers from seeing each
  other in the user picker (see Known limitation below).

## Known bug (found during verification testing)

`Sidebar/index.jsx`'s `categorize()` currently classifies any room with exactly 2
joined members as a DM, regardless of whether it's actually a named channel. A
2-person private channel therefore shows up under "Личные сообщения" with an `@`
icon instead of `#`. Fixed as part of this iteration (see Design).

## Known limitation (accepted, not fixed this iteration)

The user picker (used to invite people to a channel or start a DM) lists **all**
registered users on the server. Testers from otherwise-unrelated pilot groups will
see each other's names/usernames in that picker, even though they can't see each
other's channels or DMs unless invited. Full isolation between groups of testers
would require a groups/orgs concept on top of Matrix — out of scope; flagged here
so it isn't rediscovered as a surprise later.

## Design

### 1. Creating chats from the UI

Two entry points, both reachable from the existing `+` buttons in the sidebar
section headers (`Sidebar/ChatItem.jsx`'s sibling `SectionHeader`, currently inert):

- **New channel** (`КАНАЛЫ` section `+`): modal with name, optional topic, and a
  multi-select user picker. Always created **private** (`preset: 'private_chat'`,
  `visibility: 'private'`) — invited members only, nobody can discover or join
  without being invited. This directly addresses the concern that unrelated
  testers shouldn't be able to wander into each other's channels.
- **New direct message** (`ЛИЧНЫЕ СООБЩЕНИЯ` section `+`): modal with a single-select
  user picker. On submit: if a DM room with that user already exists (checked via
  `m.direct` account data), reuse it and just switch to it; otherwise create a new
  room with `is_direct: true`, `preset: 'private_chat'`, invite the user, and add
  the new room ID to `m.direct` account data under that user's key.

Both modals share one `UserPicker` component (search box + list, fetched from the
Matrix user directory) and use a plain `Modal` overlay wrapper (Esc / backdrop
click to close — no need for anything fancier at this scale).

**Backend dependency:** Synapse's `user_directory` only returns users who already
share a room with the searcher, by default. For the picker to show *all* server
users (needed since testers won't share rooms yet when inviting someone new), add
`user_directory: { search_all_users: true }` to `synapse/homeserver.yaml.template`
and redeploy Synapse on the VPS. This is a production change and will be called out
explicitly as its own step, done only with explicit go-ahead at that point.

### 2. File upload / download

- `lib/matrix.js` gets `uploadFile(client, roomId, file)`: calls
  `client.uploadContent(file)` to get an `mxc://` URI, determines `msgtype` (`m.image`
  if `file.type` starts with `image/`, else `m.file`), builds the `info` block
  (mimetype, size; width/height for images via a throwaway `Image()` load), and
  sends via `client.sendMessage(roomId, content)`.
- `InputArea.jsx`: the paperclip button opens a hidden `<input type="file">`; on
  change, shows a simple inline "загрузка…" state in the composer while
  `uploadFile` runs, then clears it.
- `MessageList.jsx`'s `extractMessages()` and `MessageBubble.jsx` are extended to
  recognize `m.image`/`m.file` content: images render an inline `<img>` using
  `client.mxcUrlToHttp(content.url)` (thumbnail-sized via Matrix's `thumbnail_url`
  where available); other files keep the existing file-card layout, with the
  download button wired to the real `mxcUrlToHttp` link instead of being inert.

### 3. DM/channel categorization fix

`Sidebar/index.jsx`'s `categorize()` is rewritten to primarily use `m.direct`
account data (`client.getAccountData('m.direct')?.getContent()`, a map of
`userId -> roomId[]`) to decide which rooms are DMs. Rooms not present in that map
fall back to the current member-count heuristic, so pre-existing rooms (created
before this change, e.g. via admin API) don't regress. The sidebar subscribes to
`ClientEvent.AccountData` in addition to the events it already listens to, so the
list re-sorts if `m.direct` changes.

## Verification approach

No test framework is configured in `client/` (no Jest/Vitest/RTL), and this is
explicitly a hands-on test stand rather than a library with a long maintenance
tail — adding one now would be scope creep. Verification will be manual, the same
way the existing functionality was verified for this design: spin up a disposable
local Synapse container, register 2+ test users, and drive the app through a real
browser (Playwright) to exercise each new flow — create channel, invite, create
DM, upload an image, upload a generic file, confirm sidebar categorization — before
considering the feature done. The local test server and any generated test data
are torn down afterward; nothing touches the production server during
verification.

## Rollout

1. Implement and verify all three items locally against the disposable test
   Synapse (as above).
2. Only then, with explicit confirmation, apply the `user_directory.search_all_users`
   config change and redeploy Synapse on the production VPS — required for the
   user picker to work for real testers.
3. Commit `client/` (currently entirely untracked) once the above is done and
   verified.
