import { useState, useEffect, useRef } from 'react'
import { RoomEvent, EventTimeline } from 'matrix-js-sdk'
import { IconLoader2 } from '@tabler/icons-react'
import MessageBubble from './MessageBubble'

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

// sendReply's plain-text body carries a legacy Matrix fallback quote
// ("> <@sender> snippet\n\n<actual reply>") for clients without rich-reply
// support. Strip it so the bubble — and, for a reply-to-a-reply chain, the
// quoted-preview snippet of the original — shows only the actual text; our
// own quoted-preview block (from base.replyTo) already renders the quote.
// Known limitation: the fallback format carries no explicit boundary
// marker, so this splits on the first "\n\n". sendReply now prefixes every
// line of its own quoted snippet with "> ", so a blank line can no longer
// occur inside our own fallback block (only after it, as the intended
// separator) — the only residual risk is a reply from another, non-
// conformant Matrix client whose fallback quote embeds a blank line.
function stripReplyFallback(body) {
  const separatorIndex = body.indexOf('\n\n')
  return separatorIndex === -1 ? body : body.slice(separatorIndex + 2)
}

function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const byId = new Map()
  const order = []
  const reactionsByTarget = new Map()
  const editsByTarget = new Map()

  for (const ev of events) {
    const type = ev.getType()

    if (type === 'm.reaction') {
      if (ev.isRedacted()) continue
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

    const rel = ev.getRelation()
    if (rel?.rel_type === 'm.replace') {
      const newContent = ev.getContent()['m.new_content']
      if (newContent?.body != null) editsByTarget.set(rel.event_id, newContent.body)
      continue
    }

    const senderId = ev.getSender()
    const member = room.getMember(senderId)
    const name = member?.name || senderId.replace('@', '').split(':')[0]

    const base = {
      id: ev.getId(),
      type: 'message',
      sender: name,
      senderId,
      avatar: name.slice(0, 2).toUpperCase(),
      time: new Date(ev.getTs()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      isOwn: senderId === me,
    }

    if (ev.isRedacted()) {
      base.deleted = true
      byId.set(base.id, base)
      order.push(base.id)
      continue
    }

    const content = ev.getContent()
    if (!content?.body) continue

    if (ev.replyEventId) {
      const original = room.findEventById(ev.replyEventId)
      if (original && original.getType() === 'm.room.message' && !original.isRedacted()) {
        const originalSenderId = original.getSender()
        const originalMember = room.getMember(originalSenderId)
        // If the original message is itself a reply, its own body on the
        // wire still carries sendReply's fallback quote prefix — strip it
        // before truncating, or a reply-to-a-reply chain would show that
        // raw fallback text in the quoted-preview snippet.
        const originalBody = original.getContent().body || ''
        const cleanOriginalBody = original.replyEventId ? stripReplyFallback(originalBody) : originalBody
        base.replyTo = {
          sender: originalMember?.name || originalSenderId.replace('@', '').split(':')[0],
          snippet: cleanOriginalBody.slice(0, 120),
        }
      } else {
        base.replyTo = { sender: null, snippet: 'Исходное сообщение недоступно' }
      }
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
      base.text = base.replyTo ? stripReplyFallback(content.body) : content.body
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
    const editedBody = editsByTarget.get(msg.id)
    if (editedBody != null && msg.text != null) {
      msg.text = editedBody
      msg.edited = true
    }
  }

  return result
}

export default function MessageList({ client, room, onEdit, onReply }) {
  const [messages, setMessages] = useState(() => extractMessages(client, room))
  const bottomRef = useRef(null)
  const containerRef = useRef(null)
  const isNearBottomRef = useRef(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [reachedStart, setReachedStart] = useState(false)

  useEffect(() => {
    isNearBottomRef.current = true
    setLoadingHistory(false)
    setReachedStart(false)
    setMessages(extractMessages(client, room))
  }, [client, room])

  useEffect(() => {
    // Shared by Timeline and LocalEchoUpdated: a new message/reaction event
    // fires Timeline, but once a local-echoed event (e.g. a just-sent
    // reaction) gets its temporary "~" id swapped for the real one from the
    // server, only LocalEchoUpdated fires — no new Timeline event. Without
    // also recomputing on that, a reaction toggled again before the swap
    // would try to redact the stale local id and matrix-js-sdk throws
    // (getPendingEvents requires detached pending event ordering, which
    // this app doesn't use).
    const recomputeOnRelevantEvent = (event, eventRoom) => {
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
    client.on(RoomEvent.Timeline, recomputeOnRelevantEvent)
    client.on(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
    client.on(RoomEvent.Redaction, onRedaction)
    return () => {
      client.off(RoomEvent.Timeline, recomputeOnRelevantEvent)
      client.off(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
      client.off(RoomEvent.Redaction, onRedaction)
    }
  }, [client, room])

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView()
    }
  }, [messages])

  useEffect(() => {
    // The unread badge (Sidebar's room.getUnreadNotificationCount()) is
    // purely receipt-driven server-side — nothing clears it unless the
    // client explicitly acks the latest event. Fires on room open and every
    // time the timeline advances while this room stays open.
    const events = room.getLiveTimeline().getEvents()
    const lastEvent = events[events.length - 1]
    if (!lastEvent) return
    client.sendReadReceipt(lastEvent).catch(err => console.error('Read receipt failed:', err))
  }, [client, room, messages])

  const loadMoreHistory = async () => {
    const container = containerRef.current
    if (!container || loadingHistory || reachedStart) return
    setLoadingHistory(true)
    const prevScrollHeight = container.scrollHeight
    try {
      const updatedRoom = await client.scrollback(room, 30)
      const hasMore = updatedRoom.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS) != null
      if (!hasMore) setReachedStart(true)
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight - prevScrollHeight
        }
      })
    } catch (err) {
      console.error('History pagination failed:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120
    if (container.scrollTop < 150 && !loadingHistory && !reachedStart) {
      loadMoreHistory()
    }
  }

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Сообщений пока нет</div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}
    >
      {(loadingHistory || reachedStart) && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          {loadingHistory ? (
            <IconLoader2 size={18} className="spin" color="var(--text-muted)" />
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Начало истории</span>
          )}
        </div>
      )}
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} onReply={onReply} />
      ))}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
