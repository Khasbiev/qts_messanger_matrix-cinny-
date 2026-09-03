import { useState } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'

export default function Chat({ client, room, navMode, onNav, onLeave }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)

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
      <Header client={client} room={room} navMode={navMode} onNav={onNav} onLeave={onLeave} />
      <MessageList client={client} room={room} onEdit={handleEdit} onReply={handleReply} />
      <InputArea
        client={client}
        room={room}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
    </div>
  )
}
