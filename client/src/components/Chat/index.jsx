import { useState, useEffect } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'

export default function Chat({ client, room, navMode, onNav }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)

  useEffect(() => {
    setEditingMessage(null)
    setReplyingTo(null)
  }, [room.roomId])

  const handleEdit = (msg) => {
    setReplyingTo(null)
    setEditingMessage(msg)
  }

  const handleReply = (msg) => {
    setEditingMessage(null)
    setReplyingTo(msg)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-primary)',
      minWidth: 0,
    }}>
      <Header client={client} room={room} navMode={navMode} onNav={onNav} />
      <MessageList client={client} room={room} onEdit={handleEdit} onReply={handleReply} />
      <InputArea
        room={room}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
    </div>
  )
}
