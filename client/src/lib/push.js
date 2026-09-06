const GATEWAY_URL = import.meta.env.VITE_PUSH_GATEWAY_URL
const GATEWAY_NOTIFY_URL = import.meta.env.VITE_PUSH_GATEWAY_NOTIFY_URL || GATEWAY_URL
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
const PUSH_KEY_STORAGE = 'qts_push_key'
const APP_ID = 'dev.qts.web'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function getOrCreatePushKey() {
  let key = localStorage.getItem(PUSH_KEY_STORAGE)
  if (!key) {
    key = crypto.randomUUID()
    localStorage.setItem(PUSH_KEY_STORAGE, key)
  }
  return key
}

export async function isPushSubscribed() {
  if (!('serviceWorker' in navigator)) return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function enablePush(client) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не получено')

  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const pushkey = getOrCreatePushKey()

  try {
    const registerResp = await fetch(`${GATEWAY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushkey, subscription: subscription.toJSON() }),
    })
    if (!registerResp.ok) throw new Error('Не удалось зарегистрировать подписку на сервере уведомлений')

    await client.setPusher({
      pushkey,
      kind: 'http',
      app_id: APP_ID,
      app_display_name: 'qts.dev messenger (веб)',
      device_display_name: navigator.userAgent.slice(0, 60),
      lang: 'ru',
      data: { url: `${GATEWAY_NOTIFY_URL}/_matrix/push/v1/notify` },
      append: false,
    })
  } catch (err) {
    await subscription.unsubscribe().catch(() => {})
    throw err
  }
}

export async function disablePush(client) {
  const pushkey = localStorage.getItem(PUSH_KEY_STORAGE)
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (subscription) await subscription.unsubscribe()
  if (pushkey) {
    await client.removePusher(pushkey, APP_ID).catch(() => {})
    await fetch(`${GATEWAY_URL}/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushkey }),
    }).catch(() => {})
  }
}
