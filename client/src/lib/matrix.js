import { createClient, ClientEvent } from 'matrix-js-sdk'

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
      if (state === 'PREPARED' || state === 'SYNCING') resolve()
      else reject(new Error(`Sync failed: ${state}`))
    })

    client.startClient({ initialSyncLimit: 30 })
  })
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
  const existing = directContent[userId]?.[0]
  if (existing && _client.getRoom(existing)) {
    return existing
  }

  const { room_id } = await _client.createRoom({
    is_direct: true,
    visibility: 'private',
    preset: 'private_chat',
    invite: [userId],
  })

  const updated = { ...directContent, [userId]: [...(directContent[userId] || []), room_id] }
  await _client.setAccountData('m.direct', updated)

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
