# Group Roles (Admin/Moderator/Member)

## Context

`client/`'s `ChatInfoModal.jsx` already reads Matrix power levels for
several checks — `myPowerLevel`, `canEditTopic`/`canEditAvatar`
(`room.currentState.maySendStateEvent(...)`), `canInvite`/`canKick`
(`room.currentState.hasSufficientPowerLevelFor(...)`) — and the existing
kick UI already gates on `m.powerLevel < myPowerLevel`. But there is no
UI anywhere to *view* a member's role or *change* it. Today, exactly one
role matters in practice: the room creator, who gets power level 100
automatically on room creation; everyone else joins at the Matrix
default of 0. Nobody can ever be promoted, so the `hasSufficientPowerLevelFor`
checks for kick/topic-edit (which require power level 50 by Matrix
default) are permanently true only for the creator.

This feature adds the missing piece: viewing and changing member roles,
built entirely on the power-levels plumbing that's already there.

## Goal

In any group channel, members with sufficient permission can see each
other's role and promote/demote members between three tiers, the same
way Telegram exposes Owner/Admin/Member. No protocol changes — this is a
UI layer over Matrx's existing `m.room.power_levels` state event.

## Scope for this iteration

In scope:
1. Three fixed role tiers mapped onto Matrix power levels: **Участник**
   (0), **Модератор** (50), **Админ** (100). No custom/arbitrary power
   level UI.
2. A role badge next to each member in `ChatInfoModal.jsx`'s member list
   (shown for Модератор/Админ; no badge for Участник, to avoid clutter).
3. A role-change control (`<select>`) next to eligible members, gated by:
   - the viewer can send `m.room.power_levels` at all
     (`room.currentState.maySendStateEvent('m.room.power_levels', me)`)
   - the target's current role is below the viewer's own
     (`m.powerLevel < myPowerLevel` — same condition the existing kick
     button already uses)
   - the dropdown only offers roles ≤ the viewer's own power level (so a
     Модератор can promote/demote between Участник and Модератор, but
     cannot create or demote an Админ; an Админ can do anything,
     including create another Админ — multiple Админы are allowed, per
     user decision, matching Telegram's "add admin" model)
4. One new `matrix.js` function, `setMemberRole(roomId, userId,
   powerLevel)`, wrapping `matrix-js-sdk`'s `client.setPowerLevel()`.

Explicitly out of scope:
- Ban (prevents rejoin) — per user decision, only roles + the existing
  kick are in scope this iteration. Ban is a separate, later feature if
  wanted.
- Custom/arbitrary power levels — only the three fixed tiers.
- Per-action fine-grained permission overrides (e.g. "this Модератор can
  kick but not edit topic") — Matrix's `power_levels` event supports this
  in principle, but it's not exposed here; the three tiers use Matrix's
  own defaults for which actions require which level (50 for
  kick/topic/avatar edits, 100 only matters for who's allowed to grant
  100 to someone else).
- DMs — role UI only applies to group channels, same as the existing
  topic/avatar/invite/kick sections in `ChatInfoModal.jsx`, which are
  already conditioned on `!isDM`.
- Any change to `NewChannelModal.jsx`'s room creation — the creator still
  gets power level 100 automatically via Matrix's own default; no new
  "assign initial roles" step at creation time.

## Design

### 1. Role tier mapping (shared constant)

A small helper, colocated with the modal (no new file needed — this is
three lines, not worth its own module):

```js
const ROLE_LABELS = { 0: null, 50: 'Модератор', 100: 'Админ' }
const ROLE_OPTIONS = [
  { level: 0, label: 'Участник' },
  { level: 50, label: 'Модератор' },
  { level: 100, label: 'Админ' },
]
```

A member's displayed role badge is `ROLE_LABELS[member.powerLevel]` —
`null` (no badge) for exactly 0. A power level that isn't one of 0/50/100
(possible if someone used a different Matrix client to set a custom
value) falls through to `null` — no badge, not a crash; this app doesn't
attempt to represent arbitrary levels, only the three it manages.

### 2. `matrix.js` — `setMemberRole`

```js
export async function setMemberRole(roomId, userId, powerLevel) {
  if (!_client) throw new Error('Not connected')
  await _client.setPowerLevel(roomId, userId, powerLevel)
}
```

`matrix-js-sdk`'s `setPowerLevel(roomId, userId, powerLevel)` (confirmed
in the installed v34 SDK, `client.js`) fetches the room's current
`m.room.power_levels` content and merges the single change — no manual
read-modify-write needed here.

### 3. `ChatInfoModal.jsx` — member list changes

Add, alongside the existing `canKick` etc.:

```js
const canEditRoles = !isDM && room.currentState.maySendStateEvent('m.room.power_levels', me)
```

In the member row (currently just avatar + name + optional "Убрать"
button), add the role badge and, when eligible, the role-change control:

```jsx
{members.map(m => (
  <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}>
    <div style={{ /* existing avatar circle, unchanged */ }}>
      {m.name.slice(0, 2).toUpperCase()}
    </div>
    <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
      {m.name}{m.userId === me ? ' (вы)' : ''}
    </span>
    {ROLE_LABELS[m.powerLevel] && (
      <span style={{ fontSize: '11px', color: 'var(--accent-teal)', fontWeight: 600 }}>
        {ROLE_LABELS[m.powerLevel]}
      </span>
    )}
    {canEditRoles && m.userId !== me && m.powerLevel < myPowerLevel && (
      <select
        value={m.powerLevel}
        onChange={e => handleRoleChange(m.userId, Number(e.target.value))}
        disabled={roleChangingUserId === m.userId}
        style={{ fontSize: '11px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-primary)' }}
      >
        {ROLE_OPTIONS.filter(o => o.level <= myPowerLevel).map(o => (
          <option key={o.level} value={o.level}>{o.label}</option>
        ))}
      </select>
    )}
    {canKick && m.userId !== me && m.powerLevel < myPowerLevel && (
      <button onClick={() => { setKickError(''); setKickTarget(m) }} style={{ fontSize: '11px', color: '#ff4d4d' }}>Убрать</button>
    )}
  </div>
))}
```

New state and handler in the component, following the existing
`handleKick`/`handleInvite` pattern:

```js
const [roleChangingUserId, setRoleChangingUserId] = useState(null)

const handleRoleChange = async (userId, powerLevel) => {
  setRoleChangingUserId(userId)
  setError('')
  try {
    await setMemberRole(room.roomId, userId, powerLevel)
  } catch (err) {
    setError(err.data?.error || err.message || 'Не удалось изменить роль')
  } finally {
    setRoleChangingUserId(null)
  }
}
```

No optimistic local state update is needed: `matrix-js-sdk` applies the
resulting `m.room.power_levels` state event to the room via the normal
sync/event pipeline, which re-renders `members` (sourced from
`room.getJoinedMembers()`) with the new power level automatically, the
same way the existing kick/invite actions already rely on sync to update
the member list rather than manually patching local state.

## Error handling

- A rejected role change (race with another concurrent change, or a
  permission edge case the client-side gating didn't anticipate) surfaces
  inline via the same `error` state and `err.data?.error || err.message
  || '<fallback>'` convention already used for every other action in this
  modal — no new error-handling pattern introduced.
- The dropdown's own option list is the primary defense against invalid
  attempts (you can't select a role you're not allowed to grant), so a
  server-side rejection here is expected to be rare — a race condition,
  not the common path.

## Testing

No automated test framework — manual verification via
`scripts/dev/local-test-synapse.sh`, `tester1`/`tester2`:

1. `tester1` creates a channel, invites `tester2`. Confirm `tester2`
   shows no role badge (Участник) and `tester1` sees a role dropdown next
   to `tester2` defaulted to "Участник".
2. `tester1` promotes `tester2` to Модератор. Confirm the badge appears
   for `tester2` in both accounts' views (after sync), and that
   `tester2` now sees the "Убрать" button and role dropdown for other
   members (once a third test account exists) or at minimum that
   `tester2`'s own client now reflects `canKick`/`canEditRoles` as true.
3. With `tester2` now a Модератор, confirm `tester2`'s role dropdown for
   `tester1` (the Админ) does not appear at all (`m.powerLevel <
   myPowerLevel` is false — 100 is not less than 50), and that if a third
   member existed, `tester2` could not offer "Админ" as an option (only
   Участник/Модератор, since `ROLE_OPTIONS.filter(o => o.level <=
   myPowerLevel)` caps at 50).
4. `tester1` demotes `tester2` back to Участник. Confirm the badge
   disappears and the "Убрать" button/role dropdown disappear from
   `tester2`'s own view of the member list.
5. Confirm DMs show no role UI at all (unchanged from today).
