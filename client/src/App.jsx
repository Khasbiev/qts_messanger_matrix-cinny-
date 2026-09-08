import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import LoginScreen from './components/Auth/LoginScreen'
import InstallPrompt from './components/InstallPrompt'
import WelcomeTour from './components/WelcomeTour'
import { restoreSession, startSync, logout } from './lib/matrix'
import { isModalOpen } from './lib/modalStack'
import { needsIOSInstallPrompt } from './lib/platform'

const NARROW_BREAKPOINT = 780
const INSTALL_PROMPT_DISMISSED_KEY = 'qts_install_prompt_dismissed'
const WELCOME_TOUR_SEEN_KEY = 'qts_welcome_tour_seen'

export default function App() {
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeRoom, setActiveRoom] = useState(null)
  const [jumpToEventId, setJumpToEventId] = useState(null)
  const [listVisible, setListVisible] = useState(true)
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT)
  const [showInstallPrompt, setShowInstallPrompt] = useState(false)
  const [showWelcomeTour, setShowWelcomeTour] = useState(false)

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const preventStrayFileDrop = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', preventStrayFileDrop)
    window.addEventListener('drop', preventStrayFileDrop)
    return () => {
      window.removeEventListener('dragover', preventStrayFileDrop)
      window.removeEventListener('drop', preventStrayFileDrop)
    }
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

  const maybeShowInstallPrompt = () => {
    if (needsIOSInstallPrompt() && !localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)) {
      setShowInstallPrompt(true)
    }
  }

  // Covers both a fresh login and a restored session on reload - client
  // becomes non-null either way. The welcome tour takes priority on a
  // first-ever login; the install prompt (if relevant) follows once it's
  // dismissed, rather than stacking both overlays at once.
  useEffect(() => {
    if (!client) return
    if (!localStorage.getItem(WELCOME_TOUR_SEEN_KEY)) {
      setShowWelcomeTour(true)
    } else {
      maybeShowInstallPrompt()
    }
  }, [client])

  const dismissWelcomeTour = () => {
    localStorage.setItem(WELCOME_TOUR_SEEN_KEY, '1')
    setShowWelcomeTour(false)
    maybeShowInstallPrompt()
  }

  const dismissInstallPrompt = () => {
    localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, '1')
    setShowInstallPrompt(false)
  }

  const handleLogout = async () => {
    await logout()
    setClient(null)
    setActiveRoom(null)
  }

  const handleRoomSelect = (room, opts) => {
    setActiveRoom(room)
    setJumpToEventId(opts?.jumpToEventId || null)
    if (isNarrow) setListVisible(false)
  }

  // Just deselects the open chat (back to the room list) - there is no
  // "leave the room" action in this app, on purpose.
  const handleDeselectRoom = () => {
    setActiveRoom(null)
    setJumpToEventId(null)
  }

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (isModalOpen()) return // let the topmost modal/popup close itself
      if (activeRoom) handleDeselectRoom()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeRoom])

  useEffect(() => {
    if (!client) return
    const openFromRoomId = (roomId) => {
      if (!roomId) return
      const room = client.getRoom(roomId)
      if (room) handleRoomSelect(room)
    }
    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('room')
    if (roomId) {
      openFromRoomId(roomId)
      window.history.replaceState({}, '', window.location.pathname)
    }
    const onMessage = (event) => {
      if (event.data?.type === 'open-room') openFromRoomId(event.data.roomId)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [client])

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
        <Chat
          key={activeRoom.roomId + (jumpToEventId ? `:${jumpToEventId}` : '')}
          client={client}
          room={activeRoom}
          navMode={navMode}
          onNav={handleNav}
          jumpToEventId={jumpToEventId}
          isNarrow={isNarrow}
        />
      )}
      {showNoRoomPlaceholder && <NoRoom />}
      {showWelcomeTour && <WelcomeTour onClose={dismissWelcomeTour} />}
      {showInstallPrompt && <InstallPrompt onClose={dismissInstallPrompt} />}
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
