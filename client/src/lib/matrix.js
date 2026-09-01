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
