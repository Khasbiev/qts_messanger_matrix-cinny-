const AUTH_GATEWAY_URL = import.meta.env.VITE_AUTH_GATEWAY_URL

function authHeaders(client) {
  return { Authorization: `Bearer ${client.getAccessToken()}`, 'Content-Type': 'application/json' }
}

export async function getMyUsername(client) {
  if (!AUTH_GATEWAY_URL) return null
  const resp = await fetch(`${AUTH_GATEWAY_URL}/username/me`, { headers: authHeaders(client) })
  if (!resp.ok) return null
  const { username } = await resp.json()
  return username
}

export async function setMyUsername(client, username) {
  if (!AUTH_GATEWAY_URL) throw new Error('Юзернеймы временно недоступны')
  const resp = await fetch(`${AUTH_GATEWAY_URL}/username`, {
    method: 'POST',
    headers: authHeaders(client),
    body: JSON.stringify({ username }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || 'Не удалось сохранить юзернейм')
  return data.username
}

// Returns [{ user_id, username }] - the caller resolves display names.
export async function searchByUsername(client, term) {
  if (!AUTH_GATEWAY_URL || !term.trim()) return []
  const resp = await fetch(`${AUTH_GATEWAY_URL}/username/search?q=${encodeURIComponent(term.trim())}`, {
    headers: authHeaders(client),
  })
  if (!resp.ok) return []
  const { results } = await resp.json()
  return results
}
