# Push Notifications

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`, now a
real PWA (manifest + icons, shipped in the previous plan). It has no
notification mechanism beyond the in-app unread-count badge
(`room.getUnreadNotificationCount()`) — nothing fires when the tab isn't
focused or the browser is closed. There is also no URL-based routing at
all today: `App.jsx` holds `activeRoom` as plain React state, set only via
`Sidebar`'s `onRoomSelect` callback.

Matrix's client-server API already supports registering an HTTP pusher
(`client.setPusher(pusher)` → `POST /pushers/set`, already present in the
installed `matrix-js-sdk`) that tells the homeserver "POST here when this
user should be notified." Synapse needs no special configuration to call
an arbitrary pusher URL — it just needs that URL to be reachable. But the
Push Gateway API Synapse speaks (`POST <url>/_matrix/push/v1/notify` with
a specific JSON shape) is not the same protocol as the W3C Web Push API a
browser's `PushManager` actually uses (VAPID-signed, end-to-end encrypted
payloads sent to a browser-vendor push service like FCM or Mozilla's
autopush) — nothing in this project bridges the two today. That bridge —
a small "push gateway" service translating one into the other — is what
this feature adds.

Per user decision, **production deployment (docker-compose/nginx changes,
real domain wiring) is explicitly deferred to a separate pass** — this
feature's scope is the working code (client + a new standalone gateway
service), fully testable against the existing local Synapse harness. Also
per user decision, phone/SMS-based login (a separate, much larger feature
requiring a Matrix identity server and a paid SMS provider) is deferred
entirely and not part of this spec.

## Goal

A user can turn on push notifications from Settings; from then on, a new
message in any of their rooms shows an OS-level notification (sender +
preview text) even when the app's tab isn't focused, using the same Web
Push mechanism on desktop and on a mobile device that's installed this
PWA (there's no separate "mobile app" — installed-PWA and desktop-tab
notifications both go through the identical browser Push API). Clicking
the notification focuses or opens the app on the exact room the message
came from.

## Scope for this iteration

In scope:
1. A new standalone `push-gateway/` service (Node + Express +
   `web-push`) implementing the Matrix Push Gateway API's
   `POST /_matrix/push/v1/notify` and translating each notification into
   a real, VAPID-signed Web Push message. Subscriptions are stored in a
   local JSON file (adequate at this project's ~30-user scale; a real
   database is future work, not this iteration).
2. A client-side service worker (`public/sw.js`) that shows a
   notification on `push` and, on click, focuses/opens the app at the
   originating room.
3. An explicit, user-initiated "Push-уведомления" toggle in
   `SettingsModal.jsx` (no auto-prompt on login — browsers actively
   discourage unsolicited permission prompts) that subscribes/unsubscribes
   via the browser's `PushManager`, registers the subscription with the
   new gateway, and registers/removes the corresponding Matrix pusher.
4. Minimal deep-linking: a `?room=<roomId>` URL query param, read once
   after login/sync completes to open that room, and a
   `postMessage`-based path for when the app is already open in a tab —
   this is the *only* routing this app gains; it is not a general router.
5. VAPID key generation (a one-time setup script in `push-gateway/`) and
   environment-variable wiring on both sides (gateway: `VAPID_PUBLIC_KEY`/
   `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; client: `VITE_PUSH_GATEWAY_URL`/
   `VITE_VAPID_PUBLIC_KEY`), both new to this project (neither side has
   had environment-driven config before).
6. Fully testable end-to-end against the existing local Synapse test
   harness — the Dockerized Synapse reaches the gateway (run directly on
   the host during development, like every other dev-time process in this
   project) via `host.docker.internal`, and actual push delivery is
   observable via `registration.getNotifications()` in the browser, not
   just inferred.

Explicitly out of scope:
- Any change to `docker-compose.yml`, `nginx/nginx.conf`, or production
  domain/TLS wiring — the gateway ships as working code, deployment is a
  separate, later decision.
- Phone/SMS login (`m.login.msisdn`) — separate feature, deferred.
- A real database for gateway subscription storage (JSON file is the v1
  choice).
- Per-room mute settings, notification grouping beyond the browser's own
  `tag`-based collapsing, reply-from-notification, badge-count (Badging
  API) integration, native mobile push (APNs/FCM) for a hypothetical
  future native app — none of this exists yet and none of it is needed
  for "PWA notifications on desktop and mobile browsers."
- Explicit handling of VAPID key rotation.

## Design

### 1. `push-gateway/` — new standalone service

A sibling directory to `client/`/`synapse/`/`nginx/`, its own
`package.json` (`express`, `web-push`, `dotenv`), `.env.example`, and
`.gitignore` (`node_modules/`, `.env`, `data/`).

**`store.js`** — a tiny JSON-file-backed key/value store, keyed by
`pushkey`:

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json')

function load() {
  if (!existsSync(DATA_FILE)) return {}
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
}

function save(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

export function setSubscription(pushkey, subscription) {
  const data = load()
  data[pushkey] = subscription
  save(data)
}

export function getSubscription(pushkey) {
  return load()[pushkey]
}

export function removeSubscription(pushkey) {
  const data = load()
  delete data[pushkey]
  save(data)
}
```

**`server.js`** — three routes:

- `POST /register` — body `{ pushkey, subscription }` (the raw
  `PushSubscription.toJSON()` object from the browser); stores it via
  `setSubscription`.
- `POST /unregister` — body `{ pushkey }`; removes it.
- `POST /_matrix/push/v1/notify` — the Matrix Push Gateway API endpoint.
  Body shape (per the Matrix spec, already what Synapse sends):
  `{ notification: { event_id, room_id, sender, sender_display_name,
  room_name, content: { body }, devices: [{ pushkey, ... }] } }`. For each
  device: look up its stored subscription; if missing, add the pushkey to
  the response's `rejected` list (tells Synapse to stop trying it — this
  is standard Push Gateway API behavior for a permanently-invalid
  pushkey). If present, build a small JSON payload —

  ```js
  const senderName = notification.sender_display_name || notification.sender || 'Кто-то'
  const bodyText = notification.content?.body || 'Новое сообщение'
  const isGroupish = notification.room_name && notification.room_name !== senderName
  const title = isGroupish ? notification.room_name : senderName
  const body = isGroupish ? `${senderName}: ${bodyText}` : bodyText
  const payload = JSON.stringify({ title, body, roomId: notification.room_id, eventId: notification.event_id })
  ```

  — and send it via `webpush.sendNotification(subscription, payload,
  { vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY,
  privateKey: VAPID_PRIVATE_KEY } })`. If that call rejects with a `404`
  or `410` status (the browser's push service confirming the subscription
  is gone), call `removeSubscription` and add the pushkey to `rejected`.
  Any other delivery error is logged but the pushkey is NOT rejected
  (transient failures shouldn't cause Synapse to give up on a still-valid
  subscription). Respond `200 { rejected: [...] }` in all cases per spec
  (Synapse expects this shape even when nothing was rejected — an empty
  array).

**`scripts/generate-vapid-keys.js`** — a one-time setup helper:

```js
import webpush from 'web-push'
const keys = webpush.generateVAPIDKeys()
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey)
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey)
```

Run once (`node scripts/generate-vapid-keys.js`), the operator copies the
output into `push-gateway/.env` (private key, subject) and
`client/.env` (public key only — it's not secret, it's embedded in the
client bundle by design, same as any VAPID public key in any Web Push
integration).

### 2. `client/public/sw.js` — service worker

```js
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data.json() } catch { /* payload stays {} */ }
  const title = payload.title || 'Новое сообщение'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.roomId || undefined,
    data: { roomId: payload.roomId, eventId: payload.eventId },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const roomId = event.notification.data?.roomId
  const targetUrl = roomId ? `/?room=${encodeURIComponent(roomId)}` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const c of clientsArr) {
        if ('focus' in c) {
          c.postMessage({ type: 'open-room', roomId })
          return c.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
```

`tag: payload.roomId` means a second push from the same room replaces the
first notification instead of stacking a new one — the standard, expected
behavior (matches Telegram: unread messages from one chat collapse into
one notification, not N).

Registered once, unconditionally, in `client/src/main.jsx`:

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
```

### 3. `client/src/lib/push.js` — subscribe/unsubscribe

```js
const GATEWAY_URL = import.meta.env.VITE_PUSH_GATEWAY_URL
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
const PUSH_KEY_STORAGE = 'qts_push_key'
const APP_ID = 'dev.qts.web'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function getOrCreatePushKey() {
  let key = localStorage.getItem(PUSH_KEY_STORAGE)
  if (!key) {
    key = crypto.randomUUID()
    localStorage.setItem(PUSH_KEY_STORAGE, key)
  }
  return key
}

export async function isPushSubscribed() {
  if (!('serviceWorker' in navigator)) return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function enablePush(client) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не получено')

  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const pushkey = getOrCreatePushKey()

  await fetch(`${GATEWAY_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushkey, subscription: subscription.toJSON() }),
  })

  await client.setPusher({
    pushkey,
    kind: 'http',
    app_id: APP_ID,
    app_display_name: 'qts.dev messenger (веб)',
    device_display_name: navigator.userAgent.slice(0, 60),
    lang: 'ru',
    data: { url: `${GATEWAY_URL}/_matrix/push/v1/notify` },
    append: false,
  })
}

export async function disablePush(client) {
  const pushkey = localStorage.getItem(PUSH_KEY_STORAGE)
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (subscription) await subscription.unsubscribe()
  if (pushkey) {
    await client.removePusher(pushkey, APP_ID).catch(() => {})
    await fetch(`${GATEWAY_URL}/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushkey }),
    }).catch(() => {})
  }
}
```

### 4. `SettingsModal.jsx` — the toggle

A new section (alongside the existing profile fields) with a button that
reads its label/state from `isPushSubscribed()` on mount and calls
`enablePush(client)`/`disablePush(client)` on click, mirroring the
existing `error`/loading-state conventions already used for the avatar
upload and name-save actions in this same file.

### 5. Deep-linking — `App.jsx`

```js
useEffect(() => {
  if (!client) return
  const openFromRoomId = (roomId) => {
    if (!roomId) return
    const room = client.getRoom(roomId)
    if (room) handleRoomSelect(room)
  }
  const params = new URLSearchParams(window.location.search)
  const roomId = params.get('room')
  if (roomId) {
    openFromRoomId(roomId)
    window.history.replaceState({}, '', window.location.pathname)
  }
  const onMessage = (event) => {
    if (event.data?.type === 'open-room') openFromRoomId(event.data.roomId)
  }
  navigator.serviceWorker?.addEventListener('message', onMessage)
  return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
}, [client])
```

`client` is only ever set after `startSync` has already completed once
(see the existing `restoreSession().then(async c => { await startSync(c);
setClient(c) })` in `App.jsx`), so `client.getRoom(roomId)` reliably finds
any room the user is already a member of by the time this effect can run
— no race against an incomplete initial sync. A `roomId` that doesn't
resolve (stale link, room left) silently falls through to the normal
room-list view, matching this app's established graceful-degradation
convention elsewhere (e.g. search's jump-to-message).

## Error handling

- `enablePush` surfaces a Russian error message (matching this app's
  existing `err.data?.error || err.message || '<fallback>'` convention)
  if the browser denies notification permission, if `pushManager.subscribe`
  rejects, or if the gateway registration `fetch` fails — shown inline in
  `SettingsModal`, not a silent failure.
- The gateway's `/_matrix/push/v1/notify` always responds `200` with a
  `rejected` array (even if empty) — Synapse's push-retry behavior expects
  this exact shape; a gateway-side error for one device must not prevent
  a response covering the others.
- A deep-link to a room the client can't resolve degrades silently to the
  normal app view (no error toast) — this mirrors the existing
  jump-to-message fallback behavior already established in this app.

## Security posture (v1)

The gateway is unauthenticated by design (matching how Synapse pusher URLs
work generally — no shared secret is exchanged), so its endpoints are
narrowed rather than locked down:

- `POST /register` validates `subscription.endpoint` against an allowlist
  of known browser push-service origins (FCM, Mozilla autopush, Windows
  WNS, Apple Web Push) before storing it. Without this, a forged
  `endpoint` value would make `webpush.sendNotification` deliver an
  attacker-controlled HTTP request on `/_matrix/push/v1/notify` — an SSRF
  vector via this service. This is the cheap mitigation for v1; a
  per-user registration secret is future work if the gateway is ever
  exposed beyond a trusted network.
- `/_matrix/push/v1/notify` still accepts any `pushkey` a caller names,
  since Synapse itself is the only expected caller in this deployment and
  authenticating that relationship (mTLS, shared secret) is deployment
  configuration, deferred with the rest of production wiring.
- Message bodies delivered to the browser's push service are capped at
  200 characters — Web Push payloads have a hard size ceiling
  (~4KB after encryption overhead) enforced by the push services
  themselves; oversized payloads are silently dropped rather than erroring,
  so truncating client-side is the only way to guarantee delivery.

## Testing

No automated test framework exists in `client/`, and none is being
introduced for `push-gateway/` either — verification is manual, but
**fully achievable locally**, not blocked on production deployment:

- The gateway can be started standalone (`node push-gateway/server.js`)
  and exercised directly (`/register`, `/unregister`) with a
  manually-constructed subscription object before any real browser is
  involved.
- With the local Synapse test harness (`scripts/dev/local-test-synapse.sh`,
  Dockerized) and the gateway running on the host, Synapse's outbound call
  to the pusher URL reaches the host-run gateway via `host.docker.internal`
  — the pusher's `data.url` used for *local* testing specifically should
  be `http://host.docker.internal:<gateway-port>/_matrix/push/v1/notify`
  rather than `localhost`, since `localhost` inside the Synapse container
  refers to the container itself, not the host.
- Real push delivery is directly observable, not just inferred: after
  triggering a push, `await (await navigator.serviceWorker.ready)
  .getNotifications()` in the browser lists the currently-shown
  notification objects, including their `title`/`body` — this confirms
  actual delivery through the real browser push service, not just that
  the gateway attempted to send something.
- End-to-end: `tester1` enables push notifications; `tester2` sends a
  message in a shared room while `tester1`'s tab is unfocused (or a second
  browser context entirely); confirm `tester1` receives a real,
  correctly-worded notification, and clicking it opens/focuses the app on
  that exact room.
