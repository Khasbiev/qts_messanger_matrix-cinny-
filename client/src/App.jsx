import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import LoginScreen from './components/Auth/LoginScreen'
import { restoreSession, startSync, logout } from './lib/matrix'

export default function App() {
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeRoom, setActiveRoom] = useState(null)

  useEffect(() => {
    restoreSession().then(async (c) => {
      if (c) {
        try {
          await startSync(c)
          const rooms = c.getRooms()
          setClient(c)
          if (rooms.length > 0) setActiveRoom(rooms[0])
        } catch {
          await logout()
        }
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleLogin = (newClient) => {
    const rooms = newClient.getRooms()
    setClient(newClient)
    if (rooms.length > 0) setActiveRoom(rooms[0])
  }

  const handleLogout = async () => {
    await logout()
    setClient(null)
    setActiveRoom(null)
  }

  if (loading) {
    return (
      <div style={{ height: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Подключение...</div>
      </div>
    )
  }

  if (!client) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar client={client} activeRoom={activeRoom} onRoomSelect={setActiveRoom} onLogout={handleLogout} />
      {activeRoom
        ? <Chat client={client} room={activeRoom} />
        : <NoRoom />
      }
    </div>
  )
}

function NoRoom() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Выберите канал</div>
    </div>
  )
}
