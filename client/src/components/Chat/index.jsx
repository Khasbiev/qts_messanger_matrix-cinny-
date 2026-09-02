import { useState, useEffect } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'

export default function Chat({ client, room, navMode, onNav }) {
  const [editingMessage, setEditingMessage] = useState(null)

  useEffect(() => {
    setEditingMessage(null)
  }, [room.roomId])

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
      <MessageList client={client} room={room} onEdit={setEditingMessage} />
      <InputArea room={room} editingMessage={editingMessage} onCancelEdit={() => setEditingMessage(null)} />
    </div>
  )
}
