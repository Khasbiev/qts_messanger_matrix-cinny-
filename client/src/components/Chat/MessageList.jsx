import { useState, useEffect, useRef } from 'react'
import { RoomEvent } from 'matrix-js-sdk'
import MessageBubble from './MessageBubble'

function extractMessages(client, room) {
  const me = client.getUserId()
  const events = room.getLiveTimeline().getEvents()
  const result = []

  for (const ev of events) {
    if (ev.getType() !== 'm.room.message') continue
    const content = ev.getContent()
    if (!content?.body) continue

    const senderId = ev.getSender()
    const member = room.getMember(senderId)
    const name = member?.name || senderId.replace('@', '').split(':')[0]

    result.push({
      id: ev.getId(),
      type: 'message',
      sender: name,
      avatar: name.slice(0, 2).toUpperCase(),
      time: new Date(ev.getTs()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      text: content.body,
      isOwn: senderId === me,
    })
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
      if (event.getType() !== 'm.room.message') return
      setMessages(extractMessages(client, room))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => client.off(RoomEvent.Timeline, onTimeline)
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
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} style={{ height: '4px' }} />
    </div>
  )
}
