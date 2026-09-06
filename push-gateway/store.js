import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json')

function load() {
  if (!existsSync(DATA_FILE)) return {}
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
}

function save(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
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
