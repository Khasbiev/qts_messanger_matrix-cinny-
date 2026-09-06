# Phone Login

## Context

`client/`'s only auth screen today is `LoginScreen.jsx`: three fields
(Сервер, Имя пользователя, Пароль), calling `matrix.js`'s `login()` which
does a plain `m.login.password` against whatever homeserver URL is typed
in. There is no registration screen anywhere in the app — the two seeded
test accounts (`tester1`/`tester2`) exist only because the local test
harness creates them directly via Synapse's admin tooling; a real user has
no way to create an account through the UI at all today.

Synapse itself has registration turned off for the public
(`enable_registration: false` in `synapse/homeserver.yaml.template`) and a
`registration_shared_secret` already configured, which is what Synapse's
own admin registration protocol (`GET/POST
/_synapse/admin/v1/register`) uses to create accounts out-of-band without
opening public signup.

Per user decision, this is a demo-scale project (not expecting meaningful
signup volume or abuse pressure yet), so **no phone verification (SMS or
flash-call) is in scope** — a phone number here is just a login
identifier, verified only in the sense that whoever typed it also set the
account's password. A previous SMS/flash-call design for this same "login
like Telegram" idea was explicitly abandoned by the user in favor of this
simpler approach.

## Goal

A user opens the app, sees a phone number + password form with a
Вход/Регистрация toggle — no server field, no separate admin step.
Registering creates a real Matrix account (username derived from the
phone number) and logs the user in immediately. Logging in works with
just phone + password. Existing accounts (`tester1`, `tester2`) keep
working exactly as before.

## Scope for this iteration

In scope:
1. A new standalone `auth-gateway/` service (Node + Express), sibling to
   `push-gateway/`, holding the `registration_shared_secret` server-side
   and never exposing it to the browser. Its only route,
   `POST /register`, takes `{ phone, name, password }`, normalizes the
   phone number to a Matrix username, and creates the account in Synapse
   via the Admin API's shared-secret registration protocol.
2. Reworking `LoginScreen.jsx` into a single screen with a Вход/Регистрация
   toggle: registration asks for Имя + Номер телефона + Пароль; login
   asks for Номер телефона + Пароль. The Сервер field is removed — the
   homeserver becomes a fixed constant.
3. A `register()` function in `matrix.js` that calls the gateway, then
   logs in with the resulting username/password, then sets the display
   name via the already-connected client (`client.setDisplayName`).
4. Environment wiring: `auth-gateway/.env` (`REGISTRATION_SHARED_SECRET`,
   `SYNAPSE_URL`, `PORT`), `client/.env` (`VITE_AUTH_GATEWAY_URL`) — same
   pattern already established by `push-gateway`/`push.js`.
5. Fully testable against the existing local Synapse test harness: the
   gateway runs on the host (like every other dev-time process in this
   project, `push-gateway` included) and reaches the harness's Synapse
   directly at `http://localhost:8008` — no Docker-networking workaround
   needed here, since this is an outbound host→container call through an
   already-published port, not the reverse direction that caused the
   `host.docker.internal` problems in the push-notifications feature.

Explicitly out of scope:
- Any SMS or flash-call phone verification — deferred (see Context).
- Enabling Synapse's public `enable_registration` — registration stays
  gateway-mediated only.
- Any change to `docker-compose.yml`, `nginx/nginx.conf`, or production
  deployment — the gateway ships as working code; deployment is a
  separate, later decision (same split already used for
  `push-gateway`).
- Password reset / "forgot password" flow — not part of this iteration.
- Rate-limiting or abuse protection on `auth-gateway`'s `/register` route.
  **Correction found during final review:** this route is not covered by
  Synapse's `rc_registration` limiter at all — that limiter keys off the
  caller's IP address, and Synapse's own admin registration handler
  (`register_user(..., by_admin=True)`) never passes one, so the check is
  skipped unconditionally for every request this gateway makes. There is
  no rate limit on this path, full stop. Accepted anyway at this
  project's demo scale, but recorded accurately rather than behind an
  incorrect sense of an existing safety net. Worth revisiting before any
  real deployment: `/register` currently accepts CORS requests from any
  origin (`auth-gateway/server.js`'s `app.use(cors())`), so publishing it
  turns an `enable_registration: false` homeserver into an effectively
  open-signup one.
- Changing how `tester1`/`tester2` or any other existing account works.

## Design

### 1. `auth-gateway/` — new standalone service

A sibling directory to `push-gateway/`, `client/`, `synapse/`, `nginx/`.
Own `package.json` (`express`, `dotenv`, `crypto` is a Node builtin),
`.env.example`, `.gitignore` (`node_modules/`, `.env`).

**Phone → username normalization** (shared logic, small pure function):

```js
export function phoneToUsername(phone) {
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `u7${digits.slice(1)}`
  }
  if (digits.length === 10) return `u7${digits}`
  return null
}
```

Returns `null` for anything that isn't a recognizable RU-shaped number
(10 digits, or 11 starting with 7/8 — covers `+7...`, `8...`, and bare
10-digit input); the route rejects with 400 in that case. A leading `8`
(the historic Russian trunk prefix) is normalized to `7`, matching how
Russians actually dictate/type their own numbers.

**Correction found during implementation:** the original design of this
function returned a purely-numeric string (e.g. `79161234567`) to use
directly as the Matrix username. Synapse rejects that outright —
`M_INVALID_USERNAME: "Numeric user IDs are reserved for guest users."` —
a hard architectural constraint (guest accounts get sequential numeric
IDs, so regular accounts may not have a fully-numeric localpart), not a
configuration option. The fix is the `u` prefix shown above: it makes
every generated username start with a letter while staying entirely
deterministic from the phone number, so the mapping is still trivially
invertible and stable. `@u79161234567:matrix.messanger.qts.dev` is what
the resulting Matrix user ID looks like.

**`server.js`** — one route:

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
  const { phone, name, password } = req.body
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
      body: JSON.stringify({ nonce, username, password, admin: false, mac, displayname: name }),
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

**Correction found during final review:** the original design of this
service deliberately withheld `name` from the Synapse call, on the belief
that the Admin register API has no display-name parameter. That belief
was wrong — Synapse's `UserRegisterServlet.on_POST` reads an optional
`displayname` field from the request body and passes it straight through
as `default_display_name`, and it is not part of the HMAC computation
(the shared-secret protocol's `mac` only ever covers `nonce`, `username`,
`password`, and the admin flag). The corrected route sends
`displayname: name` alongside the other fields in the `POST` body shown
above, making the display name atomic with account creation. This also
removes a client-side follow-up call and its failure mode (see §3).

### 2. `LoginScreen.jsx` — Вход/Регистрация toggle

Single component, a `mode` state (`'login' | 'register'`) toggled by a
text link under the form (`"Нет аккаунта? Зарегистрироваться"` /
`"Уже есть аккаунт? Войти"`). Both modes share the same visual shell as
today's form (same `Field` helper, same button styling).

- **Вход:** Номер телефона, Пароль. Submits to `login(phone, password)`
  (see §3 for what changed inside `login()`).
- **Регистрация:** Имя, Номер телефона, Пароль. Submits to
  `register(name, phone, password)`.

The Сервер field is deleted entirely. `matrix.js` gets a module-level
constant:

```js
const HOMESERVER = 'https://matrix.messanger.qts.dev'
```

replacing the `homeserver` parameter previously threaded in from the
login form.

### 3. `matrix.js` — `login()` and new `register()`

`login()` keeps its exact current body and signature except it drops the
`homeserver` parameter (uses the new `HOMESERVER` constant) and the
`username` it's given is used as-is — **no phone normalization happens
inside `login()`**. This is deliberate: it keeps `tester1`/`tester2`
working unchanged (typing `tester1` logs in as `tester1`, exactly like
today), while a real phone number typed into the same field is normalized
one layer up, in `LoginScreen.jsx`, before either `login()` or
`register()` ever sees it — using the same `phoneToUsername()` logic as
the gateway (duplicated as a tiny client-side copy in
`client/src/lib/phone.js`, since `client/` and `auth-gateway/` don't share
a package). If the typed value doesn't parse as a phone number,
`LoginScreen.jsx` passes it through unchanged — this is what preserves
`tester1`/`tester2` login.

```js
export async function register(name, username, password) {
  if (!AUTH_GATEWAY_URL) throw new Error('Регистрация временно недоступна')

  let resp
  try {
    resp = await fetch(`${AUTH_GATEWAY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: username, name, password }),
    })
  } catch {
    throw new Error('Сервер регистрации недоступен')
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}))
    throw new Error(data.error || 'Не удалось зарегистрироваться')
  }
  const { username: registeredUsername } = await resp.json()

  return login(registeredUsername, password)
}
```

`register()` deliberately re-derives the final `username` from the
gateway's response rather than reusing whatever the caller passed in,
since the gateway is the single source of truth for the normalized form
actually stored in Synapse. The display name is now set atomically at
registration time by `auth-gateway` itself (§1's corrected `server.js`),
so there is no follow-up `setDisplayName` call here to fail independently
of the registration/login itself.

**Correction found during final review:** the original version of this
function called `resp.json()` unconditionally before checking `resp.ok`,
and had no guard for `AUTH_GATEWAY_URL` being unset. Since `auth-gateway`
deployment is deferred (see Scope), an unset `VITE_AUTH_GATEWAY_URL` is
the actual default state in any environment that hasn't set up the
gateway yet — without the guard above, `register()` would fetch the
literal relative path `undefined/register`, get back a non-JSON response,
and `resp.json()` would throw a raw `SyntaxError` that surfaces to the
user as unreadable English text instead of a Russian message. The
corrected version above closes both gaps.

**Second correction, found during live browser verification after the
final review's fix wave landed:** even with `AUTH_GATEWAY_URL` set, a
`fetch()` call itself throws (not merely returns a non-ok response) when
the target is unreachable — gateway process down, network blip, refused
connection. That threw a raw `TypeError: Failed to fetch`, visible to the
user verbatim, since it happens before the `resp.ok` check can run. The
`fetch` call is now wrapped in its own `try`/`catch`, translating any
network-level failure to `'Сервер регистрации недоступен'` — the same
message `auth-gateway` itself uses when *it* can't reach Synapse, keeping
the phrasing consistent across both hops of this request chain.

**Third correction, found the same way:** `HOMESERVER` was a bare literal
pointing at the production domain, with no way to override it for local
testing now that the Сервер field is gone. Registering an account creates
it on whatever Synapse `auth-gateway`'s `SYNAPSE_URL` points at (correctly
the local test harness during development), but the subsequent `login()`
call used the hardcoded production `HOMESERVER` — a mismatch invisible to
every curl-based check in this feature's verification (curl always talked
to Synapse directly, never through the client's own `login()`), and only
surfaced once an actual browser exercised the real registration flow
end-to-end. Fixed by making it overridable:
```js
const HOMESERVER = import.meta.env.VITE_HOMESERVER_URL || 'https://matrix.messanger.qts.dev'
```
`client/.env.example` documents `VITE_HOMESERVER_URL` for local testing
against `scripts/dev/local-test-synapse.sh`, left unset in production so
the hardcoded default still applies there.

### 4. Environment variables

`auth-gateway/.env.example`:
```
REGISTRATION_SHARED_SECRET=
SYNAPSE_URL=http://localhost:8008
PORT=4001
```

`client/.env.example` gains:
```
VITE_AUTH_GATEWAY_URL=http://localhost:4001
```

For local testing, `SYNAPSE_URL` points at the test harness's exposed
port (`http://localhost:8008`) — the gateway runs on the host, same as
`push-gateway`, and the harness already publishes that port to the host
for the browser's own direct login calls, so no extra Docker networking
is needed.

## Error handling

- `auth-gateway` always returns a `{ error: '<Russian message>' }` body
  on failure (invalid phone, duplicate phone, Synapse unreachable), shown
  inline in `LoginScreen.jsx` via the same `err.data?.error || err.message
  || '<fallback>'` convention already used everywhere else in this app.
- A duplicate phone number surfaces as "Этот номер уже зарегистрирован"
  specifically (not a generic failure), since it's the one error a real
  user will actually hit by accident (registering twice).
- If `register()`'s own `login()` call fails right after a successful
  gateway registration (e.g. a network blip), the account still exists in
  Synapse — the user simply lands back on the login form and can sign in
  normally with the phone/password they just set. No rollback is
  attempted; this mirrors how every other multi-step flow in this app
  already treats a already-committed-server-side step as final.

## Testing

No automated test framework exists in `client/` or `push-gateway/`, and
none is introduced for `auth-gateway/` either — same manual-verification
approach used for every feature this session:

- `auth-gateway` can be exercised standalone with a raw HTTP client
  against the running local test harness's Synapse before any browser is
  involved — register a throwaway number, confirm the account exists via
  Synapse's admin API, confirm a second registration with the same number
  returns the duplicate-phone error.
- In the browser: register a brand-new phone number + name + password
  through the actual UI, confirm the app logs straight in and the display
  name is set correctly (visible in the app's own UI, e.g. the sidebar or
  a message sent by that account). Log out, log back in with the same
  phone/password, confirm it works.
- Confirm `tester1`/`tester2` still log in exactly as before, typing their
  plain usernames into the same phone-labeled field.
- Confirm the Сервер field is gone and the form defaults straight to
  whichever mode (Вход) is shown first.
