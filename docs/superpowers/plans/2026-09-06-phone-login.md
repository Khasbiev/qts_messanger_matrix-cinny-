# Phone Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the server/username/password login form with a phone
number + password Вход/Регистрация toggle, backed by a new small
`auth-gateway/` service that creates real Matrix accounts via Synapse's
shared-secret admin registration protocol.

**Architecture:** A new standalone Node/Express service (`auth-gateway/`,
sibling to `push-gateway/`) holds `REGISTRATION_SHARED_SECRET` and never
exposes it to the browser; its one route normalizes a phone number to a
Matrix username and registers the account via Synapse's Admin API. The
client gets a `register()` function in `matrix.js` that calls this
gateway then logs in normally, and `LoginScreen.jsx` is reworked into a
single toggleable Вход/Регистрация form with the Сервер field removed
(homeserver becomes a fixed constant).

**Tech Stack:** Node 22 (global `fetch`, no extra HTTP client needed) +
Express for the gateway; React + `matrix-js-sdk` on the client, same as
every other feature in this codebase.

## Global Constraints

- No SMS/flash-call verification in this iteration — a phone number is
  only a login identifier (per spec's Context/Scope).
- `auth-gateway` never exposes `REGISTRATION_SHARED_SECRET` to the
  browser — it stays a server-side env var only.
- Synapse's `enable_registration` stays `false` — no change to
  `synapse/homeserver.yaml.template` or any other deployment file.
- `tester1`/`tester2` (and any other existing account) must keep logging
  in unchanged, by typing their plain username into the same field.
- No change to `docker-compose.yml` or `nginx/nginx.conf` — deployment of
  `auth-gateway` is a separate, later decision (same split already used
  for `push-gateway`).
- Russian UI copy and the existing `err.data?.error || err.message ||
  '<fallback>'` error-surfacing convention apply to every new
  user-facing error in this plan.
- All verification is manual, against `scripts/dev/local-test-synapse.sh`
  — no automated test framework exists in `client/` or `push-gateway/`,
  and none is introduced here either.

---

### Task 1: `auth-gateway/` service

**Correction found during implementation:** the first version of this
task specified `phoneToUsername` returning a purely-numeric string (e.g.
`79161234567`) for direct use as the Matrix username. Synapse's admin
registration API rejects that outright:
`M_INVALID_USERNAME: "Numeric user IDs are reserved for guest users."` —
a hard architectural rule, not something configurable. Every
`phoneToUsername`/username example in this task and in Task 2 has been
corrected to prefix the digits with `u` (e.g. `u79161234567`), which
satisfies Synapse's username grammar (must start with a letter) while
staying entirely deterministic from the phone number.

**Files:**
- Create: `auth-gateway/package.json`
- Create: `auth-gateway/.env.example`
- Create: `auth-gateway/.gitignore`
- Create: `auth-gateway/phone.js`
- Create: `auth-gateway/server.js`

**Interfaces:**
- Produces: `phoneToUsername(phone)` (exported from `phone.js`) — returns
  a normalized username string, or `null` if `phone` isn't a recognizable
  RU-shaped number.
- Produces: `POST http://localhost:4001/register` — body
  `{ phone, name, password }` (all strings) → `200 { ok: true, username }`
  on success, or `4xx/5xx { error: '<Russian message>' }` on failure. Task
  2's client code consumes this exact route and response shape.

- [ ] **Step 1: Create the gateway's `package.json`**

```json
{
  "name": "qts-auth-gateway",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd auth-gateway && npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 3: Create `.env.example` and `.gitignore`**

`auth-gateway/.env.example`:
```
# The same value already configured as `registration_shared_secret` in
# synapse/homeserver.yaml.template (or, for local testing, in
# .local-test-synapse's generated config).
REGISTRATION_SHARED_SECRET=
# Base URL of the Synapse homeserver's Client-Server + Admin API.
SYNAPSE_URL=http://localhost:8008
PORT=4001
```

`auth-gateway/.gitignore`:
```
node_modules/
.env
```

- [ ] **Step 4: Write `phone.js`**

```js
export function phoneToUsername(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `u7${digits.slice(1)}`
  }
  if (digits.length === 10) return `u7${digits}`
  return null
}
```

- [ ] **Step 5: Verify `phoneToUsername` by hand**

Run: `node -e "import('./auth-gateway/phone.js').then(m => { console.log(m.phoneToUsername('+7 916 123-45-67')); console.log(m.phoneToUsername('89161234567')); console.log(m.phoneToUsername('9161234567')); console.log(m.phoneToUsername('12345')); })"`
Expected output, in order: `u79161234567`, `u79161234567`, `u79161234567`,
`null`.

- [ ] **Step 6: Write `server.js`**

```js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { phoneToUsername } from './phone.js'

const { REGISTRATION_SHARED_SECRET, SYNAPSE_URL, PORT = 4001 } = process.env

if (!REGISTRATION_SHARED_SECRET || !SYNAPSE_URL) {
  console.error('REGISTRATION_SHARED_SECRET and SYNAPSE_URL must be set')
  process.exit(1)
}

const app = express()
app.use(cors())
app.use(express.json())

app.post('/register', async (req, res) => {
  const { phone, name, password } = req.body || {}
  if (!phone || !name || !password) {
    return res.status(400).json({ error: 'phone, name and password required' })
  }
  const username = phoneToUsername(phone)
  if (!username) {
    return res.status(400).json({ error: 'Некорректный номер телефона' })
  }

  try {
    const nonceResp = await fetch(`${SYNAPSE_URL}/_synapse/admin/v1/register`)
    const { nonce } = await nonceResp.json()

    const mac = crypto
      .createHmac('sha1', REGISTRATION_SHARED_SECRET)
      .update(`${nonce}\0${username}\0${password}\0notadmin`)
      .digest('hex')

    const regResp = await fetch(`${SYNAPSE_URL}/_synapse/admin/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce, username, password, admin: false, mac }),
    })
    const regData = await regResp.json()

    if (!regResp.ok) {
      if (regData.errcode === 'M_USER_IN_USE') {
        return res.status(409).json({ error: 'Этот номер уже зарегистрирован' })
      }
      return res.status(502).json({ error: 'Не удалось создать аккаунт' })
    }

    res.json({ ok: true, username })
  } catch (err) {
    console.error('Registration failed:', err.message)
    res.status(502).json({ error: 'Сервер регистрации недоступен' })
  }
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Auth gateway listening on port ${PORT}`)
})
```

- [ ] **Step 7: Start the local Synapse test harness**

Run: `scripts/dev/local-test-synapse.sh start` (if not already running from
a previous session), then `scripts/dev/local-test-synapse.sh seed` if this
is a fresh harness.
Expected: Synapse reachable at `http://localhost:8008` (confirm with
`curl http://localhost:8008/_matrix/client/versions`).

Get the harness's `registration_shared_secret` (it's generated into the
harness's own gitignored config — check
`.local-test-synapse/homeserver.yaml` for the `registration_shared_secret`
value, or whatever the harness script prints on `start`) and put it in
`auth-gateway/.env` alongside `SYNAPSE_URL=http://localhost:8008` and
`PORT=4001` (copy `.env.example` to `.env` first).

- [ ] **Step 8: Start the gateway and register a throwaway account**

Run: `cd auth-gateway && npm start` (leave running), then in another
terminal:
```bash
curl -X POST http://localhost:4001/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"+7 999 000-11-22","name":"Тестовый Юзер","password":"TestPass123!"}'
```
Expected: `{"ok":true,"username":"u79990001122"}`.

- [ ] **Step 9: Verify the account actually exists in Synapse**

Run:
```bash
curl -X POST http://localhost:8008/_matrix/client/v3/login \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"u79990001122","password":"TestPass123!"}'
```
Expected: `200` with an `access_token` and `user_id` of
`@u79990001122:<homeserver domain>` in the response — proves the account
was really created with that username/password.

- [ ] **Step 10: Verify the duplicate-phone error**

Run the exact same `curl` from Step 8 again (same phone number).
Expected: `409` with `{"error":"Этот номер уже зарегистрирован"}`.

- [ ] **Step 11: Commit**

```bash
git add auth-gateway/
git commit -m "Add auth-gateway service (phone-based registration via Synapse admin API)"
```

---

### Task 2: Client-side phone login/registration

**Files:**
- Create: `client/src/lib/phone.js`
- Modify: `client/src/lib/matrix.js:1-36` (imports, `HOMESERVER` constant,
  `login()` signature, new `register()` function)
- Modify: `client/src/components/Auth/LoginScreen.jsx` (full rewrite)
- Modify: `client/.env.example`

**Interfaces:**
- Consumes: Task 1's `POST /register` route and response shape
  (`{ ok: true, username }` / `{ error }`).
- Consumes: `client/src/lib/matrix.js`'s existing `startSync(client)`
  (unchanged, already used by `LoginScreen.jsx` today).
- Produces: `phoneToUsername(phone)` in `client/src/lib/phone.js` — same
  behavior as Task 1's copy (duplicated on purpose, per the spec: `client/`
  and `auth-gateway/` don't share a package).
- Produces: `matrix.js`'s `login(username, password)` — **signature
  change**: the `homeserver` parameter is removed (was
  `login(homeserver, username, password)`). The only current caller is
  `LoginScreen.jsx` (verified — no other file calls `login()`), which this
  task also rewrites.
- Produces: `matrix.js`'s `register(name, phone, password)` → returns a
  connected, logged-in `client` (same shape `login()` returns), with
  `setDisplayName` already applied.

- [ ] **Step 1: Write `client/src/lib/phone.js`**

Identical logic to `auth-gateway/phone.js` — this is a deliberate,
spec-mandated duplication (no shared package between `client/` and
`auth-gateway/`):

```js
export function phoneToUsername(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `u7${digits.slice(1)}`
  }
  if (digits.length === 10) return `u7${digits}`
  return null
}
```

- [ ] **Step 2: Update `matrix.js`'s imports and add the `HOMESERVER` constant and `AUTH_GATEWAY_URL`**

Find (`client/src/lib/matrix.js` lines 1-7):
```js
import { createClient, ClientEvent, RoomEvent } from 'matrix-js-sdk'
import { findMentionSpans, buildMentionHtml } from './mentions'
import { disablePush } from './push'

const STORAGE_KEY = 'qts_matrix_session'

let _client = null
```

Replace with:
```js
import { createClient, ClientEvent, RoomEvent } from 'matrix-js-sdk'
import { findMentionSpans, buildMentionHtml } from './mentions'
import { disablePush } from './push'

const HOMESERVER = 'https://matrix.messanger.qts.dev'
const AUTH_GATEWAY_URL = import.meta.env.VITE_AUTH_GATEWAY_URL
const STORAGE_KEY = 'qts_matrix_session'

let _client = null
```

- [ ] **Step 3: Change `login()`'s signature to drop `homeserver`, and add `register()`**

Find (`client/src/lib/matrix.js` lines 13-36):
```js
export async function login(homeserver, username, password) {
  const temp = createClient({ baseUrl: homeserver })
  const resp = await temp.login('m.login.password', {
    user: username,
    password,
    initial_device_display_name: 'qts.dev messenger',
  })

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    homeserver,
    accessToken: resp.access_token,
    userId: resp.user_id,
    deviceId: resp.device_id,
  }))

  _client = createClient({
    baseUrl: homeserver,
    accessToken: resp.access_token,
    userId: resp.user_id,
    deviceId: resp.device_id,
  })

  return _client
}
```

Replace with:
```js
export async function login(username, password) {
  const temp = createClient({ baseUrl: HOMESERVER })
  const resp = await temp.login('m.login.password', {
    user: username,
    password,
    initial_device_display_name: 'qts.dev messenger',
  })

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    homeserver: HOMESERVER,
    accessToken: resp.access_token,
    userId: resp.user_id,
    deviceId: resp.device_id,
  }))

  _client = createClient({
    baseUrl: HOMESERVER,
    accessToken: resp.access_token,
    userId: resp.user_id,
    deviceId: resp.device_id,
  })

  return _client
}

export async function register(name, phone, password) {
  const resp = await fetch(`${AUTH_GATEWAY_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, password }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || 'Не удалось зарегистрироваться')

  const client = await login(data.username, password)
  await client.setDisplayName(name)
  return client
}
```

Note: `restoreSession()` (later in the same file) reads a stored
`homeserver` from `localStorage` and passes it to `createClient` — leave
that function exactly as-is; it still works unchanged since Step 3 keeps
writing `homeserver: HOMESERVER` into the same storage shape, so restoring
an old (pre-this-change) session that stored the same URL string still
works too.

- [ ] **Step 4: Rewrite `LoginScreen.jsx`**

Replace the entire file with:

```jsx
import { useState } from 'react'
import { IconEye, IconEyeOff, IconLogin, IconUserPlus } from '@tabler/icons-react'
import { login, register, startSync } from '../../lib/matrix'
import { phoneToUsername } from '../../lib/phone'

export default function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', password: '' })

  const set = (key) => (val) => setForm(f => ({ ...f, [key]: val }))

  const resolveUsername = (raw) => phoneToUsername(raw) ?? raw.trim()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const username = resolveUsername(form.phone)
      const client = mode === 'login'
        ? await login(username, form.password)
        : await register(form.name.trim(), form.phone, form.password)
      await startSync(client)
      onLogin(client)
    } catch (err) {
      setError(err.data?.error || err.message || 'Ошибка подключения')
      setLoading(false)
    }
  }

  const canSubmit = !loading && form.phone.trim() && form.password
    && (mode === 'login' || form.name.trim())

  return (
    <div style={{
      height: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '380px',
        padding: '40px',
        background: 'var(--bg-surface)',
        borderRadius: '16px',
        border: '1px solid var(--border)',
      }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px', marginBottom: '4px' }}>
            <span style={{ color: 'var(--accent-teal)' }}>{'>'}</span>
            <span style={{ color: 'var(--text-primary)' }}>qts.dev</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>MESSENGER</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {mode === 'register' && (
            <Field label="Имя" value={form.name} onChange={set('name')} placeholder="Как вас зовут" autoComplete="name" />
          )}
          <Field label="Номер телефона" value={form.phone} onChange={set('phone')} placeholder="+7 999 123-45-67" autoComplete="tel" />
          <Field
            label="Пароль"
            value={form.password}
            onChange={set('password')}
            type={showPass ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            suffix={
              <button type="button" onClick={() => setShowPass(s => !s)}
                style={{ color: 'var(--text-muted)', display: 'flex', padding: '0 2px' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                {showPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            }
          />

          {error && (
            <div style={{ fontSize: '12px', color: '#ff4d4d', padding: '8px 12px', background: 'rgba(255,77,77,0.08)', borderRadius: '6px', border: '1px solid rgba(255,77,77,0.2)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              marginTop: '8px',
              height: '42px',
              background: canSubmit ? 'var(--accent-teal)' : 'var(--bg-card)',
              color: canSubmit ? '#000' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '14px',
              borderRadius: '8px',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.opacity = '0.88' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            {mode === 'login' ? <IconLogin size={17} /> : <IconUserPlus size={17} />}
            {loading ? 'Подключение...' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>

          <button
            type="button"
            onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: '4px' }}
          >
            {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, suffix, autoComplete }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</div>
      <div
        style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '0 12px', height: '40px', transition: 'border-color 0.15s' }}
        onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px' }}
        />
        {suffix}
      </div>
    </div>
  )
}
```

Note on `resolveUsername`: `phoneToUsername` returns `null` for anything
that isn't a recognizable 10/11-digit RU number — in that case this falls
back to the raw trimmed input, which is what makes typing `tester1` still
work exactly as before. `register()` always receives the raw `form.phone`
(not `resolveUsername`'s output) because `auth-gateway`'s own
`phoneToUsername` is the source of truth for what username actually gets
created — this matches the spec's Task 3 design note.

- [ ] **Step 5: Add `VITE_AUTH_GATEWAY_URL` to `client/.env.example`**

Find:
```
VITE_VAPID_PUBLIC_KEY=
```

Replace with:
```
VITE_VAPID_PUBLIC_KEY=
VITE_AUTH_GATEWAY_URL=http://localhost:4001
```

- [ ] **Step 6: Copy `.env.example` to `.env` for local testing (if not already present)**

Run: check whether `client/.env` exists; if not, `cp client/.env.example client/.env` and fill in `VITE_AUTH_GATEWAY_URL=http://localhost:4001` (and whatever `VITE_VAPID_PUBLIC_KEY`/other values the existing `.env` already had from the push-notifications feature — do not overwrite those).

- [ ] **Step 7: Manual verification — registration through the real UI**

With `auth-gateway` running (`npm start` in `auth-gateway/`, from Task 1)
and the local Synapse test harness running, start the client dev server
(`cd client && npm run dev`) and in a browser:
1. Open the app — confirm the Сервер field is gone and the form shows
   Номер телефона + Пароль with a "Нет аккаунта? Зарегистрироваться" link.
2. Click the link, confirm the Имя field appears and the button/link text
   switch to Регистрация mode.
3. Register a new throwaway phone number (different from Task 1's test
   number) + a name + a password.
4. Expected: the app logs straight in (no separate login step) and shows
   the normal chat UI.

- [ ] **Step 8: Manual verification — display name and re-login**

In the app (still logged in from Step 7), confirm the display name shown
in the UI (e.g. the sidebar's own-user area, or by sending a message and
checking the sender name shown to another test account) matches the name
typed at registration. Log out, then log back in with the same phone
number + password via the Вход mode. Expected: login succeeds.

- [ ] **Step 9: Manual verification — `tester1`/`tester2` unaffected**

Log out, then log in typing `tester1` into the Номер телефона field (not
a phone-shaped value) with its existing password. Expected: login
succeeds exactly as before this change (this proves `resolveUsername`'s
fallback path works and `login()`'s signature change didn't break
existing accounts).

- [ ] **Step 10: Commit**

```bash
git add client/src/lib/phone.js client/src/lib/matrix.js client/src/components/Auth/LoginScreen.jsx client/.env.example
git commit -m "Replace username/server login with phone number login and registration"
```

---

### Task 3: End-to-end verification and cleanup pass

This task has no new code — it's a dedicated verification pass across
both prior tasks together, plus a check for anything the per-task manual
steps couldn't catch in isolation (state left over between the two dev
servers, `.env` files, stale sessions).

**Files:** none created or modified, unless verification surfaces a real
defect — in that case, fix it in the file it belongs to and note the fix
in the commit message.

**Interfaces:** Consumes everything Tasks 1-2 produced. Produces nothing
new.

- [ ] **Step 1: Fresh-state full flow**

Stop and restart both `auth-gateway` and the client dev server (rules out
any stale in-memory state from Tasks 1-2's testing). With a completely
fresh browser profile or incognito window (rules out stale
`localStorage`), register a brand-new phone number end-to-end through the
UI, confirm login, confirm the display name, log out, log back in with
phone+password.

- [ ] **Step 2: Duplicate-registration error surfaces correctly in the UI**

Attempt to register the *same* phone number used in Step 1 again, through
the actual UI (not `curl`). Expected: the inline error box shows "Этот
номер уже зарегистрирован" (not a generic/blank error), and the form
stays in Регистрация mode so the user can correct the number.

- [ ] **Step 3: `tester1`/`tester2` regression check, one more time, after a full restart**

With both accounts pre-existing from the harness's seed step, log in as
each in turn (typing the plain username, not a phone number) after the
fresh restart from Step 1. Expected: both succeed.

- [ ] **Step 4: Confirm no stray references to the removed `homeserver` prop/field remain**

Run: `grep -rn "form.homeserver\|homeserver:" client/src/components/Auth/LoginScreen.jsx`
Expected: no matches (the field and its state key are fully gone from
this file).

- [ ] **Step 5: Commit (only if Steps 1-4 required a fix)**

If everything passed with no code changes, skip this step — there's
nothing to commit. If a real defect was found and fixed, commit it with a
message describing the specific defect (not a generic "fix bugs").
