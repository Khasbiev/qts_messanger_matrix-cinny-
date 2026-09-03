import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import LoginScreen from './components/Auth/LoginScreen'
import { restoreSession, startSync, logout } from './lib/matrix'

const NARROW_BREAKPOINT = 780

export default function App() {
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeRoom, setActiveRoom] = useState(null)
  const [listVisible, setListVisible] = useState(true)
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT)

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    restoreSession().then(async (c) => {
      if (c) {
        try {
          await startSync(c)
          setClient(c)
        } catch {
          await logout()
        }
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleLogin = (newClient) => {
    setClient(newClient)
  }

  const handleLogout = async () => {
    await logout()
    setClient(null)
    setActiveRoom(null)
  }

  const handleRoomSelect = (room) => {
    setActiveRoom(room)
    if (isNarrow) setListVisible(false)
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

  // On narrow (mobile-width) screens only one pane is ever visible; on wide
  // screens the list can still be manually collapsed to give the chat the
  // full window width. Without an active room there's nowhere useful for
  // the chat pane to point, so the list always wins in that case.
  const effectiveListVisible = activeRoom ? listVisible : true
  const showSidebar = effectiveListVisible
  const showChatPane = !!activeRoom && (!isNarrow || !effectiveListVisible)
  const showNoRoomPlaceholder = !isNarrow && !activeRoom

  const navMode = isNarrow ? 'back' : (listVisible ? 'collapse' : 'expand')
  const handleNav = () => setListVisible(navMode === 'collapse' ? false : true)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {showSidebar && (
        <Sidebar
          client={client}
          activeRoom={activeRoom}
          onRoomSelect={handleRoomSelect}
          onLogout={handleLogout}
          fullWidth={isNarrow}
        />
      )}
      {showChatPane && (
        <Chat key={activeRoom.roomId} client={client} room={activeRoom} navMode={navMode} onNav={handleNav} />
      )}
      {showNoRoomPlaceholder && <NoRoom />}
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
