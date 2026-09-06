import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json')

function load() {
  if (!existsSync(DATA_FILE)) return {}
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
  } catch (err) {
    console.error('Subscriptions store is corrupt, starting empty:', err.message)
    return {}
  }
}

function save(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const tmpFile = `${DATA_FILE}.tmp`
  writeFileSync(tmpFile, JSON.stringify(data, null, 2))
  renameSync(tmpFile, DATA_FILE)
}

export function setSubscription(pushkey, subscription) {
  const data = load()
  data[pushkey] = subscription
  save(data)
}

export function getSubscription(pushkey) {
  return load()[pushkey]
}

export function removeSubscription(pushkey) {
  const data = load()
  delete data[pushkey]
  save(data)
}
