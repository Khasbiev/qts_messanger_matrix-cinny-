import { createClient, ClientEvent, RoomEvent } from 'matrix-js-sdk'

const STORAGE_KEY = 'qts_matrix_session'

let _client = null

export function getClient() {
  return _client
}

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

export async function restoreSession() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  const { homeserver, accessToken, userId, deviceId } = JSON.parse(stored)

  _client = createClient({ baseUrl: homeserver, accessToken, userId, deviceId })
  return _client
}

export function startSync(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sync timeout')), 30000)

    client.once(ClientEvent.Sync, (state) => {
      clearTimeout(timer)
      if (state === 'PREPARED' || state === 'SYNCING') {
        autoJoinInvites(client)
        resolve()
      } else {
        reject(new Error(`Sync failed: ${state}`))
      }
    })

    client.startClient({ initialSyncLimit: 30 })
  })
}

// There is no invite-accept UI anywhere in this app, and registration is
// already invite-only/admin-controlled (small trusted deployment) — so an
// unjoined invite is never a feature, only a stuck room nobody can see.
// Without this, starting a new DM/channel from either side leaves the
// other person invited-but-never-joined: they see nothing, and the two
// users end up writing into two different rooms without knowing it.
function autoJoinInvites(client) {
  for (const room of client.getRooms()) {
    if (room.getMyMembership() === 'invite') {
      joinAndRegisterDirect(client, room)
    }
  }
  client.on(RoomEvent.MyMembership, (room, membership) => {
    if (membership === 'invite') {
      joinAndRegisterDirect(client, room)
    }
  })
}

// The inviter's own m.direct account data already lists this room, but
// isDirectRoom() only ever checks the CURRENT user's own m.direct — so
// without mirroring it here too, the invited side's sidebar sorts an
// auto-joined DM under "Каналы" instead of "Личные сообщения". The
// invite's m.room.member content carries is_direct + who sent it; both
// disappear once we've joined (the join event has neither), so read them
// before calling joinRoom.
async function joinAndRegisterDirect(client, room) {
  const inviteEvent = room.currentState.getStateEvents('m.room.member', client.getUserId())
  const isDirect = inviteEvent?.getContent()?.is_direct === true
  const inviterId = inviteEvent?.getSender()

  try {
    await client.joinRoom(room.roomId)
  } catch (err) {
    console.error('Auto-join failed:', err)
    return
  }

  if (!isDirect || !inviterId) return
  try {
    const directContent = client.getAccountData('m.direct')?.getContent() || {}
    const existing = directContent[inviterId] || []
    if (existing.includes(room.roomId)) return
    await client.setAccountData('m.direct', { ...directContent, [inviterId]: [...existing, room.roomId] })
  } catch (err) {
    console.error('Registering auto-joined DM failed:', err)
  }
}

export async function logout() {
  if (_client) {
    try { await _client.logout() } catch { /* token may already be invalid */ }
    _client.stopClient()
    _client = null
  }
  localStorage.removeItem(STORAGE_KEY)
}

export async function sendMessage(roomId, text) {
  if (!_client) throw new Error('Not connected')
  return _client.sendTextMessage(roomId, text)
}

export async function uploadFile(roomId, file) {
  if (!_client) throw new Error('Not connected')
  const { content_uri: mxcUrl } = await _client.uploadContent(file, { type: file.type })

  const isImage = file.type.startsWith('image/')
  const content = {
    msgtype: isImage ? 'm.image' : 'm.file',
    body: file.name,
    url: mxcUrl,
    info: {
      mimetype: file.type,
      size: file.size,
    },
  }

  if (isImage) {
    const { width, height } = await readImageDimensions(file)
    content.info.w = width
    content.info.h = height
  }

  return _client.sendMessage(roomId, content)
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(objectUrl)
    }
    img.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl
  })
}

export async function createChannel({ name, topic, inviteUserIds }) {
  if (!_client) throw new Error('Not connected')
  const { room_id } = await _client.createRoom({
    name,
    topic: topic || undefined,
    visibility: 'private',
    preset: 'private_chat',
    invite: inviteUserIds,
  })
  return room_id
}

export async function searchUsers(term) {
  if (!_client) throw new Error('Not connected')
  if (!term.trim()) return []
  const { results } = await _client.searchUserDirectory({ term, limit: 50 })
  return results.filter(u => u.user_id !== _client.getUserId())
}

export async function createOrGetDirectMessage(userId) {
  if (!_client) throw new Error('Not connected')
  const directContent = _client.getAccountData('m.direct')?.getContent() || {}
  const known = directContent[userId] || []

  for (const roomId of known) {
    const room = _client.getRoom(roomId)
    if (room && room.getMyMembership() !== 'leave') return roomId
  }

  // m.direct is a private per-account cache: it's never updated by the
  // other side inviting us, so if they started this DM first (or we're
  // racing them), it's empty even though a perfectly good shared room
  // already exists. Fall back to actual room membership — the one thing
  // both sides always agree on — before creating a duplicate.
  const existingRoom = _client.getRooms().find(room => {
    if (room.getMyMembership() === 'leave') return false
    const members = room.getMembers().filter(m => m.membership === 'join' || m.membership === 'invite')
    return members.length === 2 && members.some(m => m.userId === userId)
  })
  if (existingRoom) {
    if (!known.includes(existingRoom.roomId)) {
      await _client.setAccountData('m.direct', { ...directContent, [userId]: [...known, existingRoom.roomId] })
    }
    return existingRoom.roomId
  }

  const { room_id } = await _client.createRoom({
    is_direct: true,
    visibility: 'private',
    preset: 'private_chat',
    invite: [userId],
  })

  await _client.setAccountData('m.direct', { ...directContent, [userId]: [...known, room_id] })

  return room_id
}

export async function resolveMediaUrl(mxcUrl) {
  if (!_client) throw new Error('Not connected')
  const httpUrl = _client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, false, false, true)
  if (!httpUrl) throw new Error('Invalid media URL')
  const resp = await fetch(httpUrl, {
    headers: { Authorization: `Bearer ${_client.getAccessToken()}` },
  })
  if (!resp.ok) throw new Error('Не удалось загрузить медиафайл')
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}

export function getOwnProfile() {
  if (!_client) throw new Error('Not connected')
  const user = _client.getUser(_client.getUserId())
  return {
    displayName: user?.displayName || _client.getUserId().replace('@', '').split(':')[0],
    avatarMxcUrl: user?.avatarUrl || null,
  }
}

export async function updateDisplayName(name) {
  if (!_client) throw new Error('Not connected')
  await _client.setDisplayName(name)
}

export async function updateAvatar(file) {
  if (!_client) throw new Error('Not connected')
  const { content_uri: mxcUrl } = await _client.uploadContent(file, { type: file.type })
  await _client.setAvatarUrl(mxcUrl)
  return mxcUrl
}

export async function uploadVoiceMessage(roomId, blob, durationMs) {
  if (!_client) throw new Error('Not connected')
  const mimetype = blob.type || 'audio/ogg'
  const { content_uri: mxcUrl } = await _client.uploadContent(blob, { type: mimetype })

  const content = {
    msgtype: 'm.audio',
    body: 'Голосовое сообщение',
    url: mxcUrl,
    info: { mimetype, size: blob.size, duration: durationMs },
    'org.matrix.msc1767.audio': { duration: durationMs },
    'org.matrix.msc3245.voice': {},
  }

  return _client.sendMessage(roomId, content)
}

export async function uploadVideoNote(roomId, blob, durationMs) {
  if (!_client) throw new Error('Not connected')
  const mimetype = blob.type || 'video/webm'
  const { content_uri: mxcUrl } = await _client.uploadContent(blob, { type: mimetype })

  const content = {
    msgtype: 'm.video',
    body: 'Видеосообщение',
    url: mxcUrl,
    info: { mimetype, size: blob.size, duration: durationMs, w: 240, h: 240 },
    'dev.qts.round_video': true,
  }

  return _client.sendMessage(roomId, content)
}

export function isDirectRoom(client, roomId) {
  const directRoomIds = new Set(
    Object.values(client.getAccountData('m.direct')?.getContent() || {}).flat()
  )
  return directRoomIds.has(roomId)
}

export function waitForRoom(roomId, timeoutMs = 5000) {
  if (!_client) throw new Error('Not connected')
  return new Promise((resolve, reject) => {
    const existing = _client.getRoom(roomId)
    if (existing) { resolve(existing); return }
    const start = Date.now()
    const interval = setInterval(() => {
      const room = _client.getRoom(roomId)
      if (room) {
        clearInterval(interval)
        resolve(room)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval)
        reject(new Error('Room did not appear in time'))
      }
    }, 200)
  })
}

export async function sendReaction(roomId, eventId, emoji) {
  if (!_client) throw new Error('Not connected')
  return _client.sendEvent(roomId, 'm.reaction', {
    'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: emoji },
  })
}

export async function removeReaction(roomId, reactionEventId) {
  if (!_client) throw new Error('Not connected')
  return _client.redactEvent(roomId, reactionEventId)
}

export async function toggleReaction(roomId, message, emoji) {
  if (!_client) throw new Error('Not connected')
  const existing = message.reactions?.find(r => r.reactedByMe)
  if (existing && existing.emoji === emoji) {
    return removeReaction(roomId, existing.myEventId)
  }
  if (existing) {
    await removeReaction(roomId, existing.myEventId)
  }
  return sendReaction(roomId, message.id, emoji)
}

export async function editMessage(roomId, eventId, newText) {
  if (!_client) throw new Error('Not connected')
  return _client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `* ${newText}`,
    'm.new_content': { msgtype: 'm.text', body: newText },
    'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
  })
}

export async function deleteMessage(roomId, eventId) {
  if (!_client) throw new Error('Not connected')
  return _client.redactEvent(roomId, eventId)
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendReply(roomId, text, replyTo) {
  if (!_client) throw new Error('Not connected')
  const snippet = (replyTo.text || '').slice(0, 200)
  const quoted = snippet
    .split('\n')
    .map((line, i) => (i === 0 ? `> <${replyTo.senderId}> ${line}` : `> ${line}`))
    .join('\n')
  const plainFallback = `${quoted}\n\n${text}`
  const htmlFallback = `<mx-reply><blockquote><a href="https://matrix.to/#/${roomId}/${replyTo.id}">In reply to</a> <a href="https://matrix.to/#/${replyTo.senderId}">${escapeHtml(replyTo.sender)}</a><br />${escapeHtml(snippet)}</blockquote></mx-reply>${escapeHtml(text)}`

  return _client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: plainFallback,
    format: 'org.matrix.custom.html',
    formatted_body: htmlFallback,
    'm.relates_to': { 'm.in_reply_to': { event_id: replyTo.id } },
  })
}

export async function forwardMessage(sourceRoomId, message, targetRoomIds) {
  if (!_client) throw new Error('Not connected')
  const forwardedFrom = { sender: message.senderId, displayName: message.sender }

  let content
  if (message.text != null) {
    content = {
      msgtype: 'm.text',
      body: `Переслано от ${message.sender}:\n${message.text}`,
    }
  } else {
    const sourceRoom = _client.getRoom(sourceRoomId)
    const event = sourceRoom?.findEventById(message.id)
    if (!event) throw new Error('Исходное сообщение недоступно')
    content = { ...event.getContent() }
    delete content['m.relates_to']
  }
  content['dev.qts.forwarded_from'] = forwardedFrom

  const results = await Promise.allSettled(targetRoomIds.map(roomId => _client.sendMessage(roomId, { ...content })))
  const failedRoomIds = targetRoomIds.filter((_, i) => results[i].status === 'rejected')
  if (failedRoomIds.length > 0) {
    const err = new Error(`Не удалось переслать в ${failedRoomIds.length} из ${targetRoomIds.length} чатов`)
    err.failedRoomIds = failedRoomIds
    throw err
  }
}

export async function leaveRoom(roomId) {
  if (!_client) throw new Error('Not connected')
  await _client.leave(roomId)
}

export async function updateRoomTopic(roomId, topic) {
  if (!_client) throw new Error('Not connected')
  await _client.setRoomTopic(roomId, topic)
}

export async function updateRoomAvatar(roomId, file) {
  if (!_client) throw new Error('Not connected')
  const { content_uri: mxcUrl } = await _client.uploadContent(file, { type: file.type })
  await _client.sendStateEvent(roomId, 'm.room.avatar', { url: mxcUrl }, '')
  return mxcUrl
}

export async function inviteToRoom(roomId, userId) {
  if (!_client) throw new Error('Not connected')
  await _client.invite(roomId, userId)
}

export async function kickFromRoom(roomId, userId) {
  if (!_client) throw new Error('Not connected')
  await _client.kick(roomId, userId)
}
