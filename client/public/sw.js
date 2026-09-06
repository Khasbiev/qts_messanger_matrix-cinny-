self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data.json() } catch { /* payload stays {} */ }
  const title = payload.title || 'Новое сообщение'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.roomId || undefined,
    renotify: true,
    data: { roomId: payload.roomId, eventId: payload.eventId },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const roomId = event.notification.data?.roomId
  const targetUrl = roomId ? `/?room=${encodeURIComponent(roomId)}` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const c of clientsArr) {
        if ('focus' in c) {
          c.postMessage({ type: 'open-room', roomId })
          return c.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
