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

// forwardMessage's plain-text body carries a "Переслано от X:\n<text>"
// fallback for clients that don't understand dev.qts.forwarded_from. Strip
// it so the bubble shows only the actual text — the forwarded-from label
// itself is rendered separately, from message.forwardedFrom.
function stripForwardFallback(body) {
  if (!body.startsWith('Переслано от ')) return body
  const separatorIndex = body.indexOf(':\n')
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

    const forwardedFrom = content['dev.qts.forwarded_from']
    if (forwardedFrom?.sender && forwardedFrom?.displayName) {
      base.forwardedFrom = { sender: forwardedFrom.sender, displayName: forwardedFrom.displayName }
    }

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
        let cleanOriginalBody = original.replyEventId ? stripReplyFallback(originalBody) : originalBody
        if (original.getContent()['dev.qts.forwarded_from']) cleanOriginalBody = stripForwardFallback(cleanOriginalBody)
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
      let bodyText = content.body
      if (base.replyTo) bodyText = stripReplyFallback(bodyText)
      if (base.forwardedFrom) bodyText = stripForwardFallback(bodyText)
      base.text = bodyText
    }

    byId.set(base.id, base)
    order.push(base.id)
  }

  const result = order.map(id => byId.get(id))
  const others = room.getJoinedMembers().filter(m => m.userId !== me)

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
    if (msg.isOwn) {
      msg.readBy = others.filter(m => room.hasUserReadEvent(m.userId, msg.id)).length
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
  // MessageList is rendered without a `key` in Chat/index.jsx, so switching
  // rooms reuses this component instance — only the `room` prop changes, it
  // doesn't remount. loadMoreHistory's async continuation below closes over
  // the room it was called for; this ref lets it detect a room switch that
  // happened while its scrollback() call was in flight, so it can bail out
  // instead of applying a stale room's result to the now-current room.
  const roomRef = useRef(room)
  roomRef.current = room
  // Tracks the last event ID we've already sent a read receipt for, per
  // room, so the effect below doesn't resend once a room's receipt is
  // already up to date.
  const lastSentReceiptRef = useRef({ roomId: null, eventId: null })

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
    // A gappy /sync (reconnect after sleep, long backgrounding) discards the
    // loaded timeline and starts a fresh one — any "reached the beginning"
    // state from before no longer applies, and older messages need to be
    // reloadable again.
    const onTimelineReset = (resetRoom) => {
      if (resetRoom?.roomId !== room.roomId) return
      setReachedStart(false)
      setMessages(extractMessages(client, room))
    }
    // A read receipt from another member doesn't change the timeline itself,
    // only whether our own sent messages now count as "read" — recompute so
    // the ✓✓ checkmark updates live.
    const onReceipt = (event, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, recomputeOnRelevantEvent)
    client.on(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
    client.on(RoomEvent.Redaction, onRedaction)
    client.on(RoomEvent.TimelineReset, onTimelineReset)
    client.on(RoomEvent.Receipt, onReceipt)
    return () => {
      client.off(RoomEvent.Timeline, recomputeOnRelevantEvent)
      client.off(RoomEvent.LocalEchoUpdated, recomputeOnRelevantEvent)
      client.off(RoomEvent.Redaction, onRedaction)
      client.off(RoomEvent.TimelineReset, onTimelineReset)
      client.off(RoomEvent.Receipt, onReceipt)
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
    //
    // Walk backward to the last event the server has actually confirmed
    // (status === null) rather than always using the literal last event —
    // a pending local echo (e.g. a message that was just sent but hasn't
    // round-tripped yet) has no real event ID server-side, and sending a
    // receipt for one gets rejected with 400. The next recompute (once the
    // echo resolves) will pick it up.
    //
    // matrix-js-sdk's sendReceipt() unconditionally applies a local-echo
    // receipt (room.addLocalEchoReceipt -> addReceipt) and unconditionally
    // emits RoomEvent.Receipt for it, even when the receipt doesn't change.
    // Since this file also listens for RoomEvent.Receipt to recompute
    // `messages` (for the ✓✓ readBy count) and this effect depends on
    // `messages`, sending the same receipt twice would re-trigger this
    // effect via that local echo and loop forever. Guard by skipping when
    // we've already sent a receipt for this exact event in this room.
    const events = room.getLiveTimeline().getEvents()
    let lastConfirmedEvent = null
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].status == null) {
        lastConfirmedEvent = events[i]
        break
      }
    }
    if (!lastConfirmedEvent) return
    const lastConfirmedEventId = lastConfirmedEvent.getId()
    const alreadySent = lastSentReceiptRef.current.roomId === room.roomId
      && lastSentReceiptRef.current.eventId === lastConfirmedEventId
    if (alreadySent) return
    lastSentReceiptRef.current = { roomId: room.roomId, eventId: lastConfirmedEventId }
    client.sendReadReceipt(lastConfirmedEvent).catch(err => {
      console.error('Read receipt failed:', err)
      // Roll back so the next recompute (new message, receipt, etc.) retries
      // this same event instead of believing forever that it was acked.
      if (lastSentReceiptRef.current.roomId === room.roomId && lastSentReceiptRef.current.eventId === lastConfirmedEventId) {
        lastSentReceiptRef.current = { roomId: null, eventId: null }
      }
    })
  }, [client, room, messages])

  const loadMoreHistory = async () => {
    const container = containerRef.current
    if (!container || loadingHistory || reachedStart) return
    const loadedRoom = room
    setLoadingHistory(true)
    const prevScrollHeight = container.scrollHeight
    const prevScrollTop = container.scrollTop
    try {
      const updatedRoom = await client.scrollback(loadedRoom, 30)
      if (roomRef.current !== loadedRoom) return
      const hasMore = updatedRoom.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS) != null
      if (!hasMore) setReachedStart(true)
      requestAnimationFrame(() => {
        if (roomRef.current !== loadedRoom) return
        if (containerRef.current) {
          containerRef.current.scrollTop = prevScrollTop + (containerRef.current.scrollHeight - prevScrollHeight)
        }
      })
    } catch (err) {
      console.error('History pagination failed:', err)
    } finally {
      if (roomRef.current === loadedRoom) setLoadingHistory(false)
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

  // handleScroll alone can't drive pagination when there's nothing to
  // scroll: if the loaded content doesn't overflow the container (including
  // the messages.length === 0 case), no scroll event ever fires. It also
  // can't recover if a fetched batch adds little rendered height (mostly
  // state events/redactions) and scrollTop stays under the trigger
  // threshold — programmatically setting an unchanged scrollTop fires no
  // scroll event either. This effect re-checks after every batch resolves
  // (loadingHistory flips back to false) and after the room's initial
  // messages populate, independent of any scroll event. It self-terminates
  // via the same reachedStart/loadingHistory guards loadMoreHistory already
  // has, so it can't loop forever.
  useEffect(() => {
    const container = containerRef.current
    if (!container || loadingHistory || reachedStart) return
    if (container.scrollHeight <= container.clientHeight || container.scrollTop < 150) {
      loadMoreHistory()
    }
  }, [messages, loadingHistory, reachedStart])

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
      {messages.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Сообщений пока нет</div>
        </div>
      ) : (
        messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} roomId={room.roomId} onEdit={onEdit} onReply={onReply} />
        ))
      )}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
