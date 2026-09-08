import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const DATA_FILE = path.join(DATA_DIR, 'usernames.json')

function load() {
  if (!existsSync(DATA_FILE)) return {}
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
  } catch (err) {
    console.error('Usernames store is corrupt, starting empty:', err.message)
    return {}
  }
}

function save(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const tmpFile = `${DATA_FILE}.tmp`
  writeFileSync(tmpFile, JSON.stringify(data, null, 2))
  renameSync(tmpFile, DATA_FILE)
}

// Keyed by lowercased username (uniqueness is case-insensitive); each entry
// keeps the user's chosen casing alongside their user_id.
export function setUsername(userId, username) {
  const data = load()
  const key = username.toLowerCase()

  const existing = data[key]
  if (existing && existing.user_id !== userId) {
    const err = new Error('Этот юзернейм уже занят')
    err.code = 'USERNAME_TAKEN'
    throw err
  }

  // A user can only hold one username - drop any previous entry of theirs.
  for (const [k, v] of Object.entries(data)) {
    if (v.user_id === userId && k !== key) delete data[k]
  }

  data[key] = { user_id: userId, username }
  save(data)
}

export function getUsernameForUser(userId) {
  const data = load()
  for (const v of Object.values(data)) {
    if (v.user_id === userId) return v.username
  }
  return null
}

export function searchUsernames(term, limit = 20) {
  const data = load()
  const needle = term.toLowerCase()
  return Object.values(data)
    .filter(v => v.username.toLowerCase().includes(needle))
    .slice(0, limit)
}
