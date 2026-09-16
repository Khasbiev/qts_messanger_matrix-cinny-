# Android App (Capacitor wrapper)

## Context

`client/` is the custom React + Vite frontend on `matrix-js-sdk`, already a
real installable PWA with working desktop/mobile-browser Web Push (VAPID,
via the standalone `push-gateway/` service — see
`2026-09-06-push-notifications-design.md`). `push-gateway/` is now wired
into `docker-compose.yml`/`nginx/nginx.conf` and deployed in production
(this supersedes that earlier spec's "deployment deferred" note).

There is no native Android app today, and no way to install this on
Android outside "open the site in Chrome and Add to Home Screen." The
user wants a real installable Android app, with the hard requirement that
push notifications keep working — including when the app is backgrounded
or fully killed, which is the scenario Android is strictest about.

**Key platform constraint driving this whole design:** a WebView-hosted
service worker (which is what a plain Capacitor wrapper would give you)
does not get woken up by the OS the way a real installed PWA in Chrome
does. Android only reliably wakes a backgrounded/killed app for push via
Firebase Cloud Messaging (FCM), delivered to a native broadcast receiver
outside the WebView entirely. So "keep notifications working" on Android
specifically means adding a native FCM path, not just packaging the
existing Web Push code as-is.

## Goal

A signed Android APK that installs and runs this same messenger, backed
by the same Synapse/auth-gateway/push-gateway backend already in
production, with push notifications that reliably arrive — sender +
message preview, tap-to-open-the-right-room — whether the app is
foregrounded, backgrounded, or fully killed. Existing desktop/browser Web
Push must keep working exactly as it does today; this is purely additive.

## Scope for this iteration

In scope:
1. `client/android/` — a Capacitor Android project wrapping the existing
   `dist/` build. No UI rewrite; the same React app runs in the WebView.
2. Native push notifications via `@capacitor/push-notifications` +
   Firebase Cloud Messaging, as a second delivery path alongside the
   existing Web Push one in `push-gateway/`.
3. `push-gateway/` gains FCM send capability (`firebase-admin`) and a
   `/register-fcm` endpoint, and its notify handler dispatches to the
   right transport per stored subscription.
4. A `dev.qts.android` pusher registered with Synapse for the native app,
   parallel to the existing `dev.qts.web` pusher — both can be active on
   the same account simultaneously (e.g. phone app + desktop browser).
5. Deep-linking from a tapped Android notification into the right room,
   reusing the existing `?room=<id>` mechanism already built for the web
   push flow.
6. A signed release APK, built locally, published as a static download
   (e.g. `https://messanger.qts.dev/app.apk`) — no Google Play.
7. App icon generated from the existing `icon-512.png` via
   `@capacitor/assets`.

Explicitly out of scope:
- Any UI rewrite or React Native port.
- Google Play Store listing/publishing, in-app auto-update.
- iOS. (Capacitor could later target it, but nothing here assumes it.)
- Native features beyond notifications (no native camera/contacts/etc.
  integration) — the app is a WebView wrapper plus the one native
  capability (push) that the platform requires.
- A shared npm package between `push-gateway/` and `client/` for any new
  constants — this project already duplicates small constants across
  services rather than introducing a shared package (see phone-number
  normalization precedent), and this spec follows the same convention.
- CI/automated build pipeline for the APK — built manually when a release
  is needed, same manual-verification posture as the rest of this project.

## Design

### 1. `client/android/` — Capacitor project

`npx cap init` inside `client/` (Capacitor lives alongside the existing
Vite project, not as a separate top-level directory), then
`npx cap add android`.

`client/capacitor.config.json`:
```json
{
  "appId": "dev.qts.android",
  "appName": "QTS Messenger",
  "webDir": "dist",
  "server": { "androidScheme": "https" }
}
```
`androidScheme: "https"` matters: it makes the WebView treat the bundled
app as served over `https://` (not `file://` or `http://`), which is a
prerequisite for `fetch`/`XHR`/WebSocket calls to the real
`https://matrix.messanger.qts.dev` backend to behave like a normal
same-scheme cross-origin request instead of tripping mixed-content or
`file://`-origin restrictions.

`client/android/` (the generated Gradle project) is committed to the
repo, matching Capacitor's own convention — same as an `ios/` folder
would be. Build outputs (`android/app/build/`, `android/.gradle/`,
`android/local.properties`) are gitignored; the project skeleton itself
is not.

Build flow: `npm run build` (existing Vite build, pointed at production
env vars — same `.env` values the production web deploy already uses,
since the app talks to the same live backend) → `npx cap sync android` →
open in Android Studio or `./gradlew assembleRelease` for the signed APK.

### 2. Firebase project + `google-services.json`

A free Firebase project, created manually by the user (this is a
Google-account action outside anything Claude can do), with one Android
app registered under it (`dev.qts.android`, matching `capacitor.config.json`'s
`appId` — FCM requires this to match). Only Cloud Messaging is used; no
Analytics/Crashlytics/etc. needed. Downloading that project's
`google-services.json` and placing it at `client/android/app/` is a
one-time setup step (gitignored — it's not secret exactly, but it's
environment-specific config, same posture as `.env` files elsewhere in
this project).

The gateway side needs a **service account key** from the same Firebase
project (Project Settings → Service Accounts → Generate new private key)
for `firebase-admin` to send messages server-side. This is a real secret
— stored like `push-gateway/.env`'s VAPID keys are (gitignored, supplied
via environment/mounted file in production).

### 3. `push-gateway/store.js` — subscription schema change

Current schema: `{ [pushkey]: <raw webpush subscription object> }`.

New schema: each stored value gains a `kind` discriminator:
```js
{ kind: 'webpush', subscription: { endpoint, keys: {...} } }
{ kind: 'fcm', token: '<fcm registration token>' }
```
Backward compatibility: an existing stored value with no `kind` field
(everything registered before this change) is treated as `kind: 'webpush'`
with the value itself as `subscription` — no migration script needed,
just a fallback read path in `getSubscription`'s caller.

### 4. `push-gateway/server.js` — new endpoint + notify branching

`POST /register-fcm` — body `{ pushkey, token }`; validates both are
non-empty strings, stores `setSubscription(pushkey, { kind: 'fcm', token })`.
No endpoint-allowlist check is needed here (unlike `/register`'s Web Push
endpoint allowlist) since FCM tokens aren't URLs — there's no equivalent
SSRF surface.

`/unregister` is reused as-is for FCM pushkeys too (it just deletes by
key, transport-agnostic).

`/_matrix/push/v1/notify`'s per-device loop branches on `kind`:
```js
const stored = getSubscription(device.pushkey)
if (!stored) { rejected.push(device.pushkey); continue }
const kind = stored.kind || 'webpush' // pre-migration entries have no `kind`
if (kind === 'fcm') {
  try {
    await messaging.send({
      token: stored.token,
      notification: { title, body },
      data: { roomId: notification.room_id, eventId: notification.event_id },
      android: { priority: 'high' },
    })
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      removeSubscription(device.pushkey)
      rejected.push(device.pushkey)
    } else {
      console.error('FCM send failed for', device.pushkey, err.message)
    }
  }
} else {
  // existing webpush.sendNotification(...) path, unchanged
}
```
`android: { priority: 'high' }` is required for FCM to attempt immediate
delivery to a backgrounded/killed app rather than batching it — without
this, Android can defer delivery arbitrarily (Doze mode batching).

`firebase-admin` is initialized once at startup from the service account
key (env var pointing at a mounted JSON file path, or the JSON inline via
an env var — same pattern as `VAPID_PRIVATE_KEY`).

### 5. Client: native push registration path

`client/src/lib/push.js` currently assumes a browser (`navigator.serviceWorker`,
`PushManager`). It gains a platform branch at the top of `enablePush`/
`disablePush`/`isPushSubscribed`:

```js
import { Capacitor } from '@capacitor/core'
```
`Capacitor.isNativePlatform()` is the existing, already-idiomatic way
Capacitor apps detect "am I running wrapped, or in a real browser."

When native:
- `isPushSubscribed()` checks `PushNotifications.checkPermissions()`.
- `enablePush(client)` calls `PushNotifications.requestPermissions()`,
  then `PushNotifications.register()`, and awaits the `registration`
  event (via `PushNotifications.addListener('registration', ...)`) to get
  the FCM token. That token is the `pushkey` sent to
  `POST ${GATEWAY_URL}/register-fcm`, and the Matrix pusher registered via
  `client.setPusher(...)` uses `app_id: 'dev.qts.android'` (a new constant,
  parallel to the existing `APP_ID = 'dev.qts.web'`) and
  `app_display_name: 'qts.dev messenger (Android)'`. Everything else about
  the `setPusher` call (kind `http`, `data.url` pointing at the gateway's
  notify endpoint) is identical to the existing web path — Synapse's
  pusher mechanism doesn't care what's behind the gateway URL.
- `disablePush(client)` calls `PushNotifications.unregister()` (Android)
  and removes the pusher/gateway registration the same way the web path
  does.

When not native, all existing behavior (Web Push, VAPID, service worker)
is untouched — this is the same file gaining a branch, not a rewrite.

### 6. Notification tap → deep link

`@capacitor/push-notifications`' `pushNotificationActionPerformed` listener
fires when the user taps a system notification. Its handler reads
`notification.data.roomId` (set server-side in the FCM `data` payload,
§4) and performs the same navigation `App.jsx`'s existing `postMessage`
`open-room` handler does today for the web flow — the cleanest way to
reuse it is to have this listener call the same `openFromRoomId`-shaped
logic (either by exporting it from `App.jsx` or by dispatching a
same-shaped `window.postMessage({ type: 'open-room', roomId })`, which
`App.jsx`'s existing listener already handles unmodified).

### 7. App icon

`@capacitor/assets generate --android` reads a single source icon (the
existing `client/public/icon-512.png`) and produces all required
`mipmap-*` densities plus an adaptive-icon foreground/background pair,
written into `client/android/app/src/main/res/`.

### 8. Signing + distribution

A release keystore is generated once (`keytool -genkeypair ...`), kept
outside the repo (like any signing key — loss means future updates can't
be signed as updates to the same app, so back it up manually). Release
builds (`./gradlew assembleRelease`) are signed with it. The resulting
`app-release.apk` is uploaded to the same VPS nginx serves the client
from, at a static path (e.g. `/app.apk`), linked from somewhere users will
find it (`guide.html` is the natural place, since it already documents
onboarding). Installing requires the user to allow "install from unknown
sources" for their browser/file manager — expected and fine for a
~30-person internal deployment.

## Error handling

- `enablePush` on native follows the same pattern the web path already
  uses: throw a Russian-language error (surfaced inline wherever
  `SettingsModal` already renders push errors) if permission is denied,
  registration fails, or the gateway `fetch` fails — no new error-handling
  convention introduced.
- FCM send failures in the gateway distinguish "token permanently invalid"
  (`messaging/registration-token-not-registered` → remove + reject, same
  treatment as a `410` Web Push response) from transient errors (logged,
  pushkey kept), mirroring the existing Web Push error handling exactly.
- A stored subscription with no `kind` (pre-existing data) must not throw
  or silently drop — it's read as `webpush`, so nothing already registered
  breaks when this ships.

## Security posture

- The FCM service account key is a real secret (full send-as-this-Firebase-app
  credential) — never committed, held the same way `VAPID_PRIVATE_KEY` is
  held today (`.env`/mounted file, gitignored, prod-only).
- `/register-fcm` has no endpoint-allowlist equivalent to `/register`'s,
  because an FCM token isn't a URL the gateway will later make a request
  to — the SSRF concern that motivated that allowlist doesn't apply here.
  It still validates the token is a non-empty string.
- `google-services.json` is not highly sensitive (it's the same file every
  client of a Firebase Android app ships with, by design — it identifies
  the project, not a secret credential), but is still gitignored to keep
  environment-specific config out of source control, consistent with this
  project's existing `.env` conventions.
- No new attack surface on `/_matrix/push/v1/notify` itself — same caller
  (Synapse), same trust boundary as already documented in the push
  notifications spec.

## Testing

No automated test framework exists for `client/` or `push-gateway/`, and
none is introduced here — verification stays manual, per this project's
established convention:

- Build a debug APK, install on a physical Android device or emulator
  with Google Play services (required for FCM — a plain AOSP emulator
  image without Play services won't receive FCM messages), log in with a
  test account, confirm the app behaves identically to the web client for
  core chat flows.
- Enable notifications from Settings on the Android app; from another
  account (browser or second device), send a message into a shared room
  while the Android app is (a) foregrounded, (b) backgrounded, and (c)
  fully killed (swiped away from recents) — confirm delivery in all three
  states, since (c) is exactly the case a plain WebView Web Push can't
  handle and the whole reason this design adds FCM.
- Confirm tapping the notification opens the app directly on the
  originating room.
- Regression-check the existing desktop/browser Web Push flow still works
  unchanged (enable on a browser tab, receive a push, click through) —
  this design must not touch that path's behavior.
- Confirm `tester1`/`tester2` (the local dev harness accounts) still work
  for basic login/chat inside the Android build pointed at the local test
  Synapse, for anyone iterating on this without touching production.
