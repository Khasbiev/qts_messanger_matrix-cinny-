import { useState, useEffect, useRef } from 'react'
import { RoomEvent } from 'matrix-js-sdk'
import MessageBubble from './MessageBubble'

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const byId = new Map()
  const order = []
  const reactionsByTarget = new Map()

  for (const ev of events) {
    const type = ev.getType()

    if (type === 'm.reaction') {
      const rel = ev.getRelation()
      if (!rel || rel.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) continue
      let emojiMap = reactionsByTarget.get(rel.event_id)
      if (!emojiMap) { emojiMap = new Map(); reactionsByTarget.set(rel.event_id, emojiMap) }
      const entry = emojiMap.get(rel.key) || { count: 0, reactedByMe: false, myEventId: null }
      entry.count += 1
      if (ev.getSender() === me) { entry.reactedByMe = true; entry.myEventId = ev.getId() }
      emojiMap.set(rel.key, entry)
      continue
    }

    if (type !== 'm.room.message') continue

    const content = ev.getContent()
    if (!content?.body) continue

    const senderId = ev.getSender()
    const member = room.getMember(senderId)
    const name = member?.name || senderId.replace('@', '').split(':')[0]

    const base = {
      id: ev.getId(),
      type: 'message',
      sender: name,
      avatar: name.slice(0, 2).toUpperCase(),
      time: new Date(ev.getTs()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      isOwn: senderId === me,
    }

    if (content.msgtype === 'm.image' && content.url) {
      base.image = { mxcUrl: content.url, name: content.body }
    } else if (content.msgtype === 'm.audio' && content.url && content['org.matrix.msc3245.voice']) {
      base.voice = { mxcUrl: content.url, durationMs: content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0 }
    } else if (content.msgtype === 'm.video' && content.url && content['dev.qts.round_video']) {
      base.roundVideo = { mxcUrl: content.url, durationMs: content.info?.duration || 0 }
    } else if (content.msgtype === 'm.file' && content.url) {
      base.file = { mxcUrl: content.url, name: content.body, ext: (content.body.split('.').pop() || '').toLowerCase(), size: formatFileSize(content.info?.size) }
    } else {
      base.text = content.body
    }

    byId.set(base.id, base)
    order.push(base.id)
  }

  const result = order.map(id => byId.get(id))

  for (const msg of result) {
    const emojiMap = reactionsByTarget.get(msg.id)
    if (emojiMap) {
      msg.reactions = Array.from(emojiMap.entries()).map(([emoji, entry]) => ({
        emoji, count: entry.count, reactedByMe: entry.reactedByMe, myEventId: entry.myEventId,
      }))
    }
  }

  return result
}

export default function MessageList({ client, room }) {
  const [messages, setMessages] = useState(() => extractMessages(client, room))
  const bottomRef = useRef(null)

  useEffect(() => {
    setMessages(extractMessages(client, room))
  }, [client, room])

  useEffect(() => {
    const onTimeline = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      const type = event.getType()
      if (type !== 'm.room.message' && type !== 'm.reaction') return
      setMessages(extractMessages(client, room))
    }
    // Local-echoed events (e.g. a just-sent reaction) get a temporary "~"
    // event id that's swapped for the real one once the server confirms it,
    // without a new Timeline event firing. Without this listener, a reaction
    // toggled again before that swap would try to redact the stale local id
    // and matrix-js-sdk throws (getPendingEvents requires detached pending
    // event ordering, which this app doesn't use).
    const onLocalEchoUpdated = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      const type = event.getType()
      if (type !== 'm.room.message' && type !== 'm.reaction') return
      setMessages(extractMessages(client, room))
    }
    // A redacted reaction (toggle-off) never gets a new 'm.reaction' Timeline
    // event — the room only emits Redaction once the target event's content
    // is cleared (fired for both the local echo and the server-confirmed
    // redaction). Without this, an unreacted pill would never disappear.
    const onRedaction = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    client.on(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated)
    client.on(RoomEvent.Redaction, onRedaction)
    return () => {
      client.off(RoomEvent.Timeline, onTimeline)
      client.off(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated)
      client.off(RoomEvent.Redaction, onRedaction)
    }
  }, [client, room])

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages])

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Сообщений пока нет</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} />
      ))}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
