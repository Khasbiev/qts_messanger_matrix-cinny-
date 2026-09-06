# PWA Icon

## Context

`client/public/manifest.json` already declares `icon-192.png` and
`icon-512.png`, and `index.html` already sets `theme-color`,
`apple-mobile-web-app-*` meta tags, and links the manifest — but neither
icon file exists in `public/`, and `index.html` has no `<link rel="icon">`
or `<link rel="apple-touch-icon">` at all. This produces a recurring
`404` for `/icon-192.png` that's shown up in this app's browser console
throughout every feature verified this session, and means the browser
tab, bookmarks, and any "Add to Home Screen"/installed-PWA icon all show
a generic placeholder instead of a real app icon.

The app has an existing, unstyled-elsewhere brand mark:
`Auth/LoginScreen.jsx` renders the app name as a teal `>` character
(`color: var(--accent-teal)`, i.e. `#00E5B0`) immediately followed by
white `qts.dev` text, in bold JetBrains Mono, on the app's dark surface
background (`#0C0C0E`, the same value already set as `theme_color` in the
manifest and `background_color`/`theme-color` meta tag).

## Goal

A real `>`-glyph icon, matching the login screen's exact color treatment,
exists at both sizes the manifest already declares, and the browser tab/
bookmark/PWA-install icon all show it instead of a placeholder.

## Scope for this iteration

In scope:
1. `client/public/icon-192.png` and `client/public/icon-512.png`: a dark
   (`#0C0C0E`) square with a centered teal (`#00E5B0`) `>` character,
   bold JetBrains Mono (falling back to a bold monospace font if that
   exact font isn't available in whatever renders the icon), scaled
   proportionally for each size.
2. `index.html` gains `<link rel="icon" type="image/png" href="/icon-192.png">`
   and `<link rel="apple-touch-icon" href="/icon-192.png">`.

Explicitly out of scope:
- A maskable-icon variant (Android's adaptive-icon safe-zone padding).
- A legacy `favicon.ico`.
- Any icon size beyond the two the manifest already declares.
- Redesigning the manifest itself (name, colors, display mode) — it's
  already correct.

## Design

Icons are produced by rendering a small local HTML page (dark background,
centered `>` glyph sized proportionally to the square) and capturing it
at each exact target resolution — no image-editing tool or new npm
dependency needed, since Playwright's browser screenshot capability
(already used throughout this project's manual verification workflow) can
render arbitrary HTML/CSS at an exact pixel size and save the result as a
PNG. The same source HTML is reused for both sizes, just captured at a
different viewport/element size each time, so the two icons stay
pixel-for-pixel consistent with each other (same proportions, just scaled).

`index.html`'s new `<link>` tags go alongside the existing `<link
rel="manifest">` line, reusing `icon-192.png` for both the tab favicon and
the iOS home-screen icon (192px is within Apple's accepted range for
`apple-touch-icon`, which scales it down as needed — a dedicated
180×180 isn't worth a third generated asset for this scope).

## Testing

No automated test framework exists in `client/`. Manual verification:
load the app in a browser and confirm the browser tab shows the new `>`
icon instead of a placeholder; confirm `/icon-192.png` and
`/icon-512.png` both return `200` (not `404`) via the Network tab or a
direct request; confirm the previously-recurring
`Failed to load resource: 404 ... icon-192.png` console message no longer
appears anywhere in the app; open `manifest.json` directly in the browser
and confirm both icon URLs resolve. If the browser/OS being used exposes
an "Install app"/"Add to Home Screen" prompt, confirm the icon shown
there also matches (best-effort — not blocking if the test environment
doesn't support installing a PWA).
