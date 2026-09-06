import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import webpush from 'web-push'
import { setSubscription, getSubscription, removeSubscription } from './store.js'

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PORT = 4000 } = process.env

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set (run: npm run generate-vapid-keys)')
  process.exit(1)
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const app = express()
app.use(cors())
app.use(express.json())

// Push subscription endpoints only ever come from the browsers' own push
// services. Rejecting anything else closes off using this gateway as an
// SSRF relay via a forged `subscription.endpoint`.
const ALLOWED_ENDPOINT_PREFIXES = [
  'https://fcm.googleapis.com/',
  'https://updates.push.services.mozilla.com/',
  'https://updates-autopush.stage.mozaws.net/',
  'https://wns2-',
  'https://web.push.apple.com/',
]

function isAllowedEndpoint(endpoint) {
  return typeof endpoint === 'string' && ALLOWED_ENDPOINT_PREFIXES.some((prefix) => endpoint.startsWith(prefix))
}

app.post('/register', (req, res) => {
  const { pushkey, subscription } = req.body
  if (!pushkey || !subscription) return res.status(400).json({ error: 'pushkey and subscription required' })
  if (!isAllowedEndpoint(subscription.endpoint)) return res.status(400).json({ error: 'unrecognized push endpoint' })
  setSubscription(pushkey, subscription)
  res.json({ ok: true })
})

app.post('/unregister', (req, res) => {
  const { pushkey } = req.body
  if (!pushkey) return res.status(400).json({ error: 'pushkey required' })
  removeSubscription(pushkey)
  res.json({ ok: true })
})

const MAX_BODY_LENGTH = 200

app.post('/_matrix/push/v1/notify', async (req, res) => {
  const notification = req.body?.notification || {}
  const devices = notification.devices || []
  const rejected = []

  // Synapse also calls this endpoint for badge-count-only pushes (e.g. after
  // a read receipt), which carry no event_id. Showing those as real
  // notifications produces bogus "Кто-то: Новое сообщение" alerts.
  if (!notification.event_id) {
    return res.json({ rejected: [] })
  }

  const senderName = notification.sender_display_name || notification.sender || 'Кто-то'
  let bodyText = notification.content?.body || 'Новое сообщение'
  if (bodyText.length > MAX_BODY_LENGTH) bodyText = `${bodyText.slice(0, MAX_BODY_LENGTH - 1)}…`
  const isGroupish = notification.room_name && notification.room_name !== senderName
  const title = isGroupish ? notification.room_name : senderName
  const body = isGroupish ? `${senderName}: ${bodyText}` : bodyText
  const payload = JSON.stringify({ title, body, roomId: notification.room_id, eventId: notification.event_id })

  for (const device of devices) {
    const subscription = getSubscription(device.pushkey)
    if (!subscription) {
      rejected.push(device.pushkey)
      continue
    }
    try {
      await webpush.sendNotification(subscription, payload)
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(device.pushkey)
        rejected.push(device.pushkey)
      } else {
        console.error('Push send failed for', device.pushkey, err.message)
      }
    }
  }

  res.json({ rejected })
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Push gateway listening on port ${PORT}`)
})
