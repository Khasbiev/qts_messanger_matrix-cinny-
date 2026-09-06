# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can enable push notifications from Settings; a new message in any of their rooms shows an OS notification (sender + preview) even when the tab isn't focused, on desktop and on an installed-PWA mobile browser alike, and clicking it opens the exact room — per `docs/superpowers/specs/2026-09-06-push-notifications-design.md`.

**Architecture:** Task 1 builds a new standalone `push-gateway/` service (Node/Express + `web-push`) that speaks the Matrix Push Gateway API on one side and real, VAPID-signed Web Push on the other — fully testable with `curl`, no browser needed. Task 2 adds the client-side half: a service worker, a subscribe/unsubscribe library, and a Settings toggle — testable by actually subscribing in a browser and confirming the subscription/pusher exist. Task 3 adds minimal URL-based deep-linking so a notification click opens the right room, plus full end-to-end verification that a real push is delivered and displayed.

**Tech Stack:** `push-gateway/`: Node.js + Express + `web-push` (new, standalone service, its own `package.json`). `client/`: no new dependency — a hand-written service worker and the browser's native `PushManager`/`Notification` APIs.

## Global Constraints

- No changes to `docker-compose.yml`, `nginx/nginx.conf`, or any production deployment wiring — this plan produces working code only; deployment is a separate, later decision.
- No phone/SMS login work — a separate, deferred feature.
- Gateway subscription storage is a local JSON file — not a database. Acceptable at this project's ~30-user scale.
- No auto-prompt for notification permission on login — the Settings toggle is the only way to opt in, matching how browsers expect permission requests to be user-initiated.
- No automated test framework exists in `client/`, and none is introduced for `push-gateway/` — every task's test step is manual verification (via `curl` for Task 1, via the browser/Playwright for Tasks 2-3).
- UI copy is Russian, matching existing strings. Styling in any React component: inline `style={{...}}` with `var(--...)` CSS custom properties, no new CSS files.

---

### Task 1: The push-gateway service

**Files:**
- Create: `push-gateway/package.json`
- Create: `push-gateway/.env.example`
- Modify: `.gitignore` (repo root)
- Create: `push-gateway/store.js`
- Create: `push-gateway/server.js`
- Create: `push-gateway/scripts/generate-vapid-keys.js`
- Test: manual verification via `curl` (no automated test framework)

**Correction found during Task 2's implementation:** this task's original
steps below don't add CORS headers. `curl` never hits this gap (nothing
about `curl` enforces same-origin policy), but a real browser calling
`POST /register`/`POST /unregister` from `client/`'s origin (a different
port, e.g. `http://localhost:5173` → `http://localhost:4000`) is a
cross-origin request, and Express sends no
`Access-Control-Allow-Origin` header by default — the browser blocks the
response from reaching the calling JavaScript. `POST /_matrix/push/v1/notify`
doesn't need this (Synapse calls it server-to-server, which browser CORS
never applies to), but applying `cors()` to the whole app is simpler than
scoping it to two routes and this gateway has no cookies/auth for a
permissive CORS policy to leak. Step 4 below includes the fix.

**Interfaces:**
- Produces: a running HTTP server (default port `4000`, overridable via `PORT`) exposing `POST /register` (`{pushkey, subscription}` → stores it), `POST /unregister` (`{pushkey}` → removes it), `POST /_matrix/push/v1/notify` (the Matrix Push Gateway API — Task 2/3 will point a Matrix pusher's `data.url` at `<this>/_matrix/push/v1/notify`), and `GET /health`.
- Produces (`store.js`): `setSubscription(pushkey, subscription)`, `getSubscription(pushkey)`, `removeSubscription(pushkey)` — a JSON-file-backed key/value store at `push-gateway/data/subscriptions.json`.

- [ ] **Step 1: Scaffold the package**

Create `push-gateway/package.json`:

```json
{
  "name": "qts-push-gateway",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "generate-vapid-keys": "node scripts/generate-vapid-keys.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "web-push": "^3.6.7",
    "dotenv": "^16.4.5"
  }
}
```

This repo has one shared `.gitignore` at the repo root (no per-directory
`.gitignore` files anywhere else in the project) — it already has a bare
`.env` pattern (no leading slash, so it matches `.env` at any directory
depth, including `push-gateway/.env` and `client/.env` later in this
plan) and a bare `node_modules/` pattern, so neither needs repeating
here. The one thing genuinely new to this feature is the runtime data
directory. Find, in the repo root `.gitignore`, the existing
`# ─── Matrix deployment ─── ... .local-test-synapse/` block:

```
# ─── Matrix deployment ────────────────────────────────────────
# Real secrets / generated files — NEVER commit these
.env
synapse/data/
synapse/homeserver.yaml
nginx/certbot/
.local-test-synapse/
```

Replace with:

```
# ─── Matrix deployment ────────────────────────────────────────
# Real secrets / generated files — NEVER commit these
.env
synapse/data/
synapse/homeserver.yaml
nginx/certbot/
.local-test-synapse/
push-gateway/data/
```

Create `push-gateway/.env.example`:

```
# Generate with: npm run generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
# Required by the Web Push protocol — a contact URL or mailto: link the
# browser's push service can use to reach the sender if something's wrong
# with how it's sending pushes.
VAPID_SUBJECT=mailto:admin@qts.dev
PORT=4000
```

Run `cd push-gateway && npm install` to generate `package-lock.json` and
`node_modules/` (the latter is gitignored, per the `.gitignore` above).

- [ ] **Step 2: Create the JSON-file-backed store**

Create `push-gateway/store.js`:

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

- [ ] **Step 3: Create the VAPID key generation script**

Create `push-gateway/scripts/generate-vapid-keys.js`:

```js
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey)
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey)
```

Run it (`npm run generate-vapid-keys` from `push-gateway/`) and keep the
printed output — Step 5's manual verification needs it copied into a real
`push-gateway/.env` file (create one, based on `.env.example`, with these
two values plus `VAPID_SUBJECT=mailto:admin@qts.dev` and `PORT=4000`).
This `.env` file is gitignored — never commit it.

- [ ] **Step 4: Create the server**

Create `push-gateway/server.js`. This includes the CORS fix noted above
(`cors` import + `app.use(cors())`) — if you're implementing this task
fresh, this is simply what to write; if you're fixing an already-committed
version that's missing it, add the `cors` import line and the
`app.use(cors())` line to the existing file and add `"cors": "^2.8.5"` to
`push-gateway/package.json`'s `dependencies` (Step 1), then `npm install`
again from `push-gateway/` to pick it up:

```js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import webpush from 'web-push'
import { setSubscription, getSubscription, removeSubscription } from './store.js'

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PORT = 4000 } = process.env

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set (run: npm run generate-vapid-keys)')
  process.exit(1)
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const app = express()
app.use(cors())
app.use(express.json())

app.post('/register', (req, res) => {
  const { pushkey, subscription } = req.body
  if (!pushkey || !subscription) return res.status(400).json({ error: 'pushkey and subscription required' })
  setSubscription(pushkey, subscription)
  res.json({ ok: true })
})

app.post('/unregister', (req, res) => {
  const { pushkey } = req.body
  if (!pushkey) return res.status(400).json({ error: 'pushkey required' })
  removeSubscription(pushkey)
  res.json({ ok: true })
})

app.post('/_matrix/push/v1/notify', async (req, res) => {
  const notification = req.body?.notification || {}
  const devices = notification.devices || []
  const rejected = []

  const senderName = notification.sender_display_name || notification.sender || 'Кто-то'
  const bodyText = notification.content?.body || 'Новое сообщение'
  const isGroupish = notification.room_name && notification.room_name !== senderName
  const title = isGroupish ? notification.room_name : senderName
  const body = isGroupish ? `${senderName}: ${bodyText}` : bodyText
  const payload = JSON.stringify({ title, body, roomId: notification.room_id, eventId: notification.event_id })

  for (const device of devices) {
    const subscription = getSubscription(device.pushkey)
    if (!subscription) {
      rejected.push(device.pushkey)
      continue
    }
    try {
      await webpush.sendNotification(subscription, payload)
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(device.pushkey)
        rejected.push(device.pushkey)
      } else {
        console.error('Push send failed for', device.pushkey, err.message)
      }
    }
  }

  res.json({ rejected })
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Push gateway listening on port ${PORT}`)
})
```

- [ ] **Step 5: Manual verification**

From `push-gateway/`, with `.env` filled in from Step 3:

1. `npm start` — confirm `Push gateway listening on port 4000` prints
   with no error.
2. In another terminal: `curl http://localhost:4000/health` — confirm
   `{"ok":true}`.
3. Register a fake subscription:
   ```bash
   curl -X POST http://localhost:4000/register \
     -H "Content-Type: application/json" \
     -d '{"pushkey":"test-key","subscription":{"endpoint":"https://example.com/fake","keys":{"p256dh":"fake","auth":"fake"}}}'
   ```
   Confirm the response is `{"ok":true}`, and that
   `push-gateway/data/subscriptions.json` now contains a `"test-key"`
   entry with that subscription object.
4. Test the "unknown pushkey" rejection path (no network call needed —
   this is the deterministic case to check first):
   ```bash
   curl -X POST http://localhost:4000/_matrix/push/v1/notify \
     -H "Content-Type: application/json" \
     -d '{"notification":{"sender":"@alice:example.com","sender_display_name":"Alice","room_id":"!abc:example.com","event_id":"$123","content":{"body":"hello"},"devices":[{"pushkey":"never-registered"}]}}'
   ```
   Confirm the response is exactly `{"rejected":["never-registered"]}`.
5. Test the registered-but-undeliverable path using the fake subscription
   from step 3 (its `endpoint` isn't a real push service, so
   `webpush.sendNotification` will fail to deliver — confirm the server
   process's own console logs an error line via `console.error('Push
   send failed for', ...)` and that the HTTP response is still `200` with
   `{"rejected":[]}` (a delivery failure that isn't a clean 404/410 must
   not silently drop the response or crash the process):
   ```bash
   curl -i -X POST http://localhost:4000/_matrix/push/v1/notify \
     -H "Content-Type: application/json" \
     -d '{"notification":{"sender":"@alice:example.com","sender_display_name":"Alice","room_id":"!abc:example.com","event_id":"$123","content":{"body":"hello"},"devices":[{"pushkey":"test-key"}]}}'
   ```
6. Unregister: `curl -X POST http://localhost:4000/unregister -H "Content-Type: application/json" -d '{"pushkey":"test-key"}'` —
   confirm `{"ok":true}` and that `"test-key"` is gone from
   `push-gateway/data/subscriptions.json`.

- [ ] **Step 6: Commit**

```bash
git add push-gateway/package.json push-gateway/package-lock.json push-gateway/.env.example push-gateway/store.js push-gateway/server.js push-gateway/scripts/generate-vapid-keys.js .gitignore
git commit -m "Add push-gateway service (Matrix Push Gateway API to Web Push bridge)"
```

Do NOT `git add push-gateway/.env` or `push-gateway/data/` — both are
gitignored and contain secrets/runtime state, never commit them.

---

### Task 2: Client service worker, subscription library, and Settings toggle

**Files:**
- Create: `client/public/sw.js`
- Create: `client/src/lib/push.js`
- Create: `client/.env.example`
- Modify: `client/src/main.jsx`
- Modify: `client/src/components/Modals/SettingsModal.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: Task 1's running gateway (`POST /register`, `POST /unregister`, `POST /_matrix/push/v1/notify`).
- Produces (`lib/push.js`): `isPushSubscribed(): Promise<boolean>`, `enablePush(client): Promise<void>`, `disablePush(client): Promise<void>` — `client` is the existing `matrix-js-sdk` client instance already threaded through every modal in this codebase (`SettingsModal` already receives it as a prop). Task 3 does not call these directly but shares the same service worker (`public/sw.js`).
- Produces (`public/sw.js`): a `push` handler that shows a notification with `data: {roomId, eventId}`, and a `notificationclick` handler that `postMessage`s `{type: 'open-room', roomId}` to an already-open window or opens `/?room=<roomId>` if none is open — Task 3's `App.jsx` listens for that message and reads that URL param.

**A design refinement over the spec, found while planning this task:**
the spec used one `VITE_PUSH_GATEWAY_URL` for everything. That's wrong for
local testing: the browser's own `/register`/`/unregister` calls need a
URL reachable from the HOST machine (`http://localhost:4000` when running
Task 1's gateway locally), but the URL embedded in the Matrix pusher
registration is called by SYNAPSE — which, against this project's
Dockerized local test harness, runs *inside a container* where
`localhost` means the container itself, not the host machine. This plan
uses two separate env vars so both cases work correctly: `VITE_PUSH_GATEWAY_URL`
(browser → gateway, direct) and `VITE_PUSH_GATEWAY_NOTIFY_URL` (embedded
in the pusher, what Synapse calls — `http://host.docker.internal:4000`
when testing against the local Dockerized harness, falling back to the
same value as `VITE_PUSH_GATEWAY_URL` if unset, which is what a real
single-domain production deployment would want).

- [ ] **Step 1: Create the service worker**

Create `client/public/sw.js`:

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

- [ ] **Step 2: Register the service worker**

Find, in `client/src/main.jsx`:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/variables.css'
import './styles/base.css'

ReactDOM.createRoot(document.getElementById('root')).render(
```

Replace with:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/variables.css'
import './styles/base.css'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')).render(
```

- [ ] **Step 3: Create the client env template**

Create `client/.env.example`:

```
VITE_PUSH_GATEWAY_URL=http://localhost:4000
# The URL Synapse itself calls to deliver a push. Usually the same as
# above, EXCEPT when testing locally against the Dockerized Synapse test
# harness (scripts/dev/local-test-synapse.sh) — that container can't
# resolve "localhost" as this host machine. Use
# http://host.docker.internal:4000 in that case.
VITE_PUSH_GATEWAY_NOTIFY_URL=http://localhost:4000
VITE_VAPID_PUBLIC_KEY=
```

Create `client/.env` with real values: the same `VAPID_PUBLIC_KEY` printed
by Task 1's `generate-vapid-keys` script, and
`VITE_PUSH_GATEWAY_URL=http://localhost:4000` for now (Task 3 covers when
`VITE_PUSH_GATEWAY_NOTIFY_URL` needs to differ). This file is already
covered by the repo root `.gitignore`'s bare `.env` pattern (see Task 1) —
no new ignore rule needed, just don't `git add` it.

- [ ] **Step 4: Create the subscription library**

Create `client/src/lib/push.js`:

```js
const GATEWAY_URL = import.meta.env.VITE_PUSH_GATEWAY_URL
const GATEWAY_NOTIFY_URL = import.meta.env.VITE_PUSH_GATEWAY_NOTIFY_URL || GATEWAY_URL
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
    data: { url: `${GATEWAY_NOTIFY_URL}/_matrix/push/v1/notify` },
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

- [ ] **Step 5: Wire the Settings toggle**

Find, in `client/src/components/Modals/SettingsModal.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { IconCamera, IconLoader2 } from '@tabler/icons-react'
import Modal from './Modal'
import { getOwnProfile, updateDisplayName, updateAvatar, resolveMediaUrl } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'
```

Replace with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { IconCamera, IconLoader2, IconBell, IconBellOff } from '@tabler/icons-react'
import Modal from './Modal'
import { getOwnProfile, updateDisplayName, updateAvatar, resolveMediaUrl } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'
import { isPushSubscribed, enablePush, disablePush } from '../../lib/push'
```

Find:

```jsx
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
```

Replace with:

```jsx
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [error, setError] = useState('')
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const fileInputRef = useRef(null)
```

Find:

```jsx
  useEffect(() => {
    let cancelled = false
    let url = null
    if (profile.avatarMxcUrl) {
      resolveMediaUrl(profile.avatarMxcUrl).then(resolved => {
        if (cancelled) { URL.revokeObjectURL(resolved); return }
        url = resolved
        setAvatarBlobUrl(resolved)
      }).catch(() => {})
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [profile.avatarMxcUrl])
```

Insert immediately after it:

```jsx

  useEffect(() => {
    isPushSubscribed().then(setPushSubscribed).catch(() => {})
  }, [])
```

Find:

```jsx
  const handleSaveName = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === profile.displayName) return
    setSavingName(true)
    setError('')
    setNameSaved(false)
    try {
      await updateDisplayName(trimmed)
      setProfile(p => ({ ...p, displayName: trimmed }))
      setNameSaved(true)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось сохранить имя')
    } finally {
      setSavingName(false)
    }
  }
```

Insert immediately after it:

```jsx

  const handleTogglePush = async () => {
    setPushBusy(true)
    setPushError('')
    try {
      if (pushSubscribed) {
        await disablePush(client)
        setPushSubscribed(false)
      } else {
        await enablePush(client)
        setPushSubscribed(true)
      }
    } catch (err) {
      setPushError(err.message || 'Не удалось изменить настройку уведомлений')
    } finally {
      setPushBusy(false)
    }
  }
```

Find:

```jsx
        <Field label="Matrix ID" value={userId} />
        <Field label="Сервер" value={homeserver} />
        <Field label="Устройство" value={deviceId} />

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
  )
}
```

Replace with:

```jsx
        <Field label="Matrix ID" value={userId} />
        <Field label="Сервер" value={homeserver} />
        <Field label="Устройство" value={deviceId} />

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Уведомления
          </div>
          <button
            onClick={handleTogglePush}
            disabled={pushBusy}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
              fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px',
            }}
          >
            {pushBusy ? <IconLoader2 size={16} className="spin" /> : (pushSubscribed ? <IconBell size={16} color="var(--accent-teal)" /> : <IconBellOff size={16} />)}
            {pushSubscribed ? 'Push-уведомления включены' : 'Включить push-уведомления'}
          </button>
          {pushError && <div style={{ fontSize: '11px', color: '#ff4d4d', marginTop: '4px' }}>{pushError}</div>}
        </div>

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 6: Manual verification**

Setup: Task 1's gateway running (`cd push-gateway && npm start`), then
`cd client`, create `.env` from `.env.example` if not already done in
Step 3 (fill in the real `VITE_VAPID_PUBLIC_KEY` from Task 1's generated
keys), `npm run dev`, log in as `tester1`.

1. A Playwright browser MCP session is available (tools named
   `mcp__plugin_playwright_playwright__*`). Notification permission
   prompts are native browser UI that Playwright must be configured to
   auto-grant — check whether your Playwright tooling exposes a
   permissions-granting call (commonly something like granting
   `notifications` permission for the origin before triggering the
   prompt); if you can't find one, request the permission via
   `browser_evaluate` calling `Notification.requestPermission()` directly
   first to see what happens in this environment, and report exactly
   what you find if it's not straightforward — don't silently skip this
   verification.
2. Open Settings, click "Включить push-уведомления" — confirm the button
   updates to "Push-уведомления включены" (with the teal bell icon) and
   no error text appears.
3. Verify via `browser_evaluate`:
   `await (await navigator.serviceWorker.ready).pushManager.getSubscription()`
   — confirm it returns a non-null subscription object (with a real
   `endpoint` starting with a push-service URL, not `null`).
4. Check `browser_network_requests` for a `PUT` (or `POST`, whichever
   `matrix-js-sdk`'s HTTP layer uses) to a path containing `/pushers/set`
   — confirm it returned a `200`/success status.
5. Check `push-gateway/data/subscriptions.json` on disk — confirm a new
   entry appeared with a `pushkey` matching what's in `localStorage` under
   the key `qts_push_key` (read via `browser_evaluate`,
   `localStorage.getItem('qts_push_key')`).
6. Click the Settings button again (now "Push-уведомления включены") to
   disable — confirm it reverts to "Включить push-уведомления",
   `pushManager.getSubscription()` now returns `null`, and the entry is
   gone from `push-gateway/data/subscriptions.json`.
7. Confirm no console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add client/public/sw.js client/src/lib/push.js client/.env.example client/src/main.jsx client/src/components/Modals/SettingsModal.jsx
git commit -m "Add push notification subscription flow and Settings toggle"
```

Do NOT commit `client/.env` (real keys/URLs) — it's already covered by the
repo root `.gitignore`'s bare `.env` pattern (confirmed in Task 1), so a
plain `git status` should not show it as a candidate to stage at all.

---

### Task 3: Deep-linking and end-to-end verification

**Files:**
- Modify: `client/src/App.jsx`
- Test: manual browser verification (no automated test framework in `client/`)

**Interfaces:**
- Consumes: Task 2's service worker (`public/sw.js`), which already `postMessage`s `{type: 'open-room', roomId}` to open windows and opens `/?room=<roomId>` for a cold start — this task is what makes the client side of that contract actually do something.

- [ ] **Step 1: Add the deep-link effect to `App.jsx`**

Find:

```jsx
  const handleLeaveRoom = () => {
    setActiveRoom(null)
    setJumpToEventId(null)
  }

  if (loading) {
```

Replace with:

```jsx
  const handleLeaveRoom = () => {
    setActiveRoom(null)
    setJumpToEventId(null)
  }

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

  if (loading) {
```

`client` is only ever set after `startSync` has already completed once
(the existing `restoreSession().then(async c => { await startSync(c);
setClient(c) })` effect above this one), so `client.getRoom(roomId)`
reliably finds any room the user is already a member of by the time this
effect can run — no race against an incomplete initial sync. A `roomId`
that doesn't resolve (stale link, room left) silently falls through to
the normal room-list view.

- [ ] **Step 2: Manual verification — deep-linking in isolation**

With the dev server running and `tester1` logged in already (a normal
session, no push involved yet):

1. Note the `roomId` of any room `tester1` is in (e.g. via
   `browser_evaluate` reading `client.getRooms()[0].roomId` from within
   the running app, or by checking Sidebar state).
2. Navigate directly to `http://localhost:<port>/?room=<that roomId>`
   (URL-encode it if needed) — confirm the app opens directly into that
   room, and the URL's `?room=` param is gone afterward (replaced via
   `history.replaceState`).
3. Navigate to `http://localhost:<port>/?room=!nonexistent:example.com`
   (a room the user isn't in) — confirm the app loads normally (room
   list or default view), no error, no crash.
4. Test the "already open" / `postMessage` path directly: with the app
   open and a real room loaded, run via `browser_evaluate`:
   ```js
   navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-room', roomId: '<some other real roomId>' } }))
   ```
   confirm the app switches to that room (this exercises the exact
   listener `App.jsx` registered, independent of whether a real
   service-worker-initiated postMessage can be triggered through
   Playwright).

- [ ] **Step 3: Manual verification — full end-to-end push delivery**

This is the complete flow: a real message triggers a real push that's
really displayed, and clicking-equivalent (the `postMessage`/URL path
already verified in Step 2) opens the right room.

Setup:
1. Confirm Task 1's gateway is running and reachable.
2. Since Synapse (from `scripts/dev/local-test-synapse.sh`) runs inside
   Docker, update `client/.env`'s `VITE_PUSH_GATEWAY_NOTIFY_URL` to
   `http://host.docker.internal:4000` (NOT `localhost` — the Dockerized
   Synapse container can't resolve `localhost` as this host machine).
   Restart the client dev server if it caches env vars at startup (Vite
   does — a restart is needed after editing `.env`).
3. In Settings, if `tester1` already enabled push against the old
   (`localhost`) notify URL from Task 2's verification, toggle it off and
   back on now, so the pusher re-registers with the corrected
   `host.docker.internal` URL.
4. Log in as `tester2` (a second browser context/tab) in a room shared
   with `tester1`.

Test:
1. As `tester2`, send a message in the shared room.
2. As `tester1`, after a brief moment, check via `browser_evaluate`:
   ```js
   await (await navigator.serviceWorker.ready).getNotifications()
   ```
   Confirm this returns an array with at least one notification object,
   and that its `.title`/`.body` match `tester2`'s display name and
   message text (per the gateway's title/body construction logic from
   Task 1).
3. Confirm the notification's `.data` (or `.tag`) reflects the correct
   `roomId` for the room the message was sent in.
4. Confirm no console errors throughout, on either `tester1`'s or
   `tester2`'s side.
5. If feasible in your Playwright environment, also confirm the
   `push-gateway` process's own console shows no `Push send failed`
   error line during this real delivery (a real, successfully-delivered
   push should log nothing on failure paths) — if the gateway process's
   output isn't accessible to you, note that limitation rather than
   guessing.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "Add deep-linking so a notification click opens the right room"
```
