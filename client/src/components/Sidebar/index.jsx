import { useState, useEffect, useCallback, useRef } from 'react'
import { IconSearch, IconPlus, IconMenu2, IconMessageCircle, IconAddressBook, IconSettings } from '@tabler/icons-react'
import { ClientEvent, RoomEvent } from 'matrix-js-sdk'
import ChatItem from './ChatItem'
import SearchResults from './SearchResults'
import UserMenu from './UserMenu'
import NewDmModal from '../Modals/NewDmModal'
import NewChannelModal from '../Modals/NewChannelModal'
import SettingsModal from '../Modals/SettingsModal'
import ContactsModal from '../Modals/ContactsModal'
import { waitForRoom, isDirectRoom, getFolders, roomsForFolder, setRoomInFolder, setRoomPinned } from '../../lib/matrix'
import ChatItemContextMenu from './ChatItemContextMenu'
import { formatChatTime } from '../../lib/formatTime'
import FolderTabs from './FolderTabs'
import FoldersModal from '../Modals/FoldersModal'

function getPreview(room) {
  const events = room.getLiveTimeline().getEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.getType() !== 'm.room.message') continue
    const content = ev.getContent()
    if (!content?.body) continue

    let text = content.body
    if (content.msgtype === 'm.image') text = '📷 Изображение'
    else if (content.msgtype === 'm.file') text = '📎 Файл'

    return { text, time: formatChatTime(ev.getTs()) }
  }
  return { text: '', time: '' }
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
  const [folders, setFolders] = useState(() => getFolders())
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [query, setQuery] = useState('')

  // getFolders() always returns fresh array/object references, so storing
  // its result is enough to force a re-render on every relevant client
  // event below - no separate "tick" state needed.
  const refresh = useCallback(() => {
    setFolders(getFolders())
  }, [])

  // Falls back to folders[0] (always "all") if the active folder was just
  // deleted elsewhere (e.g. via FoldersModal) - see FoldersModal Step 1.
  const activeFolder = folders.find(f => f.id === activeFolderId) || folders[0]
  const rooms = roomsForFolder(client, activeFolder)

  const [showNewDm, setShowNewDm] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewChatMenu, setShowNewChatMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [foldersModal, setFoldersModal] = useState(null) // null | { seedRoomId?: string }
  const [contextMenu, setContextMenu] = useState(null) // null | { room, x, y }

  const handleTogglePin = () => {
    if (!contextMenu) return
    const { room } = contextMenu
    const alreadyPinned = activeFolder.pinnedRoomIds?.includes(room.roomId)
    setRoomPinned(activeFolderId, room.roomId, !alreadyPinned).then(refresh).catch(err => console.error('Pin toggle failed:', err))
  }

  const handleToggleFolder = (folderId, inFolder) => {
    if (!contextMenu) return
    setRoomInFolder(folderId, contextMenu.room.roomId, inFolder).then(refresh).catch(err => console.error('Folder toggle failed:', err))
  }

  const handleSearchSelect = (room, opts) => {
    onRoomSelect(room, opts)
    setQuery('')
  }

  const handleCreated = async (roomId) => {
    setShowNewDm(false)
    setShowNewChannel(false)
    setShowContacts(false)
    try {
      const room = await waitForRoom(roomId)
      refresh()
      onRoomSelect(room)
    } catch {
      refresh()
    }
  }

  useEffect(() => {
    client.on(ClientEvent.Sync, refresh)
    client.on(RoomEvent.MyMembership, refresh)
    client.on(ClientEvent.AccountData, refresh)
    client.on(RoomEvent.Timeline, refresh)
    return () => {
      client.off(ClientEvent.Sync, refresh)
      client.off(RoomEvent.MyMembership, refresh)
      client.off(ClientEvent.AccountData, refresh)
      client.off(RoomEvent.Timeline, refresh)
    }
  }, [client, refresh])

  return (
    <div style={{
      width: fullWidth ? '100%' : '240px',
      flexShrink: 0,
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      borderRight: fullWidth ? 'none' : '1px solid var(--border)',
      position: 'relative',
    }}>
      {/* Top bar: hamburger menu + search */}
      <div style={{ height: '52px', padding: '0 10px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={() => setShowUserMenu(v => !v)}
          style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0, transition: 'all 0.12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <IconMenu2 size={19} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', minWidth: 0 }}>
          <IconSearch size={13} color="var(--text-muted)" strokeWidth={2} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск..."
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '13px' }}
          />
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowNewChatMenu(v => !v)}
            style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <IconPlus size={17} strokeWidth={2} />
          </button>
          {showNewChatMenu && (
            <NewChatMenu
              onClose={() => setShowNewChatMenu(false)}
              onNewDm={() => { setShowNewChatMenu(false); setShowNewDm(true) }}
              onNewChannel={() => { setShowNewChatMenu(false); setShowNewChannel(true) }}
            />
          )}
        </div>
      </div>

      {showUserMenu && (
        <UserMenu
          client={client}
          onClose={() => setShowUserMenu(false)}
          onOpenContacts={() => setShowContacts(true)}
          onOpenSettings={() => setShowSettings(true)}
          onLogout={onLogout}
        />
      )}

      {/* Folder rail (left, vertical) + room list / search results */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!query.trim() && (
          <FolderTabs
            folders={folders}
            activeFolderId={activeFolderId}
            onSelect={setActiveFolderId}
            onCreateClick={() => setFoldersModal({})}
          />
        )}

        {query.trim() ? (
          <SearchResults client={client} query={query} onRoomSelect={handleSearchSelect} />
        ) : (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '8px 0' }}>
            {rooms.map(({ room, pinned }) => {
              const isDm = isDirectRoom(client, room.roomId)
              const other = isDm ? room.getJoinedMembers().find(m => m.userId !== client.getUserId()) : null
              const name = isDm ? (other?.name || room.name) : room.name
              const preview = getPreview(room)
              return (
                <ChatItem
                  key={room.roomId}
                  item={{
                    id: room.roomId,
                    name,
                    avatar: isDm ? name.slice(0, 2).toUpperCase() : undefined,
                    avatarMxcUrl: isDm ? other?.getMxcAvatarUrl() : room.getMxcAvatarUrl(),
                    online: false,
                    unread: room.getUnreadNotificationCount(),
                    preview: preview.text,
                    time: preview.time,
                  }}
                  type={isDm ? 'dm' : 'channel'}
                  isActive={activeRoom?.roomId === room.roomId}
                  pinned={pinned}
                  onSelect={() => onRoomSelect(room)}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ room, x: e.clientX, y: e.clientY }) }}
                />
              )
            })}
            {rooms.length === 0 && (
              <div style={{ padding: '24px 14px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
                Нет доступных комнат
              </div>
            )}
          </div>
        )}
      </div>

      {showNewDm && (
        <NewDmModal onClose={() => setShowNewDm(false)} onCreated={handleCreated} />
      )}
      {showNewChannel && (
        <NewChannelModal onClose={() => setShowNewChannel(false)} onCreated={handleCreated} />
      )}
      {showSettings && (
        <SettingsModal client={client} onClose={() => setShowSettings(false)} />
      )}
      {showContacts && (
        <ContactsModal onClose={() => setShowContacts(false)} onOpenChat={handleCreated} />
      )}
      {foldersModal && (
        <FoldersModal
          client={client}
          folders={folders}
          seedRoomId={foldersModal.seedRoomId}
          onClose={() => setFoldersModal(null)}
          onChanged={refresh}
        />
      )}
      {contextMenu && (
        <ChatItemContextMenu
          room={contextMenu.room}
          folders={folders}
          pinnedInActive={activeFolder.pinnedRoomIds?.includes(contextMenu.room.roomId)}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onTogglePin={handleTogglePin}
          onToggleFolder={handleToggleFolder}
          onCreateFolder={() => setFoldersModal({ seedRoomId: contextMenu.room.roomId })}
        />
      )}

      {/* Mobile-only bottom nav — on desktop these live in the hamburger menu */}
      {fullWidth && (
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <TabButton icon={IconMessageCircle} label="Чаты" active onClick={() => setQuery('')} />
          <TabButton icon={IconAddressBook} label="Контакты" onClick={() => setShowContacts(true)} />
          <TabButton icon={IconSettings} label="Настройки" onClick={() => setShowSettings(true)} />
        </div>
      )}
    </div>
  )
}

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        padding: '8px 0 10px', color: active ? 'var(--accent-teal)' : 'var(--text-muted)',
      }}
    >
      <Icon size={20} strokeWidth={1.8} />
      <span style={{ fontSize: '10px', fontWeight: 500 }}>{label}</span>
    </button>
  )
}

function NewChatMenu({ onClose, onNewDm, onNewChannel }) {
  const ref = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '38px', right: 0, width: '180px', zIndex: 200,
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}
    >
      <button
        onClick={onNewDm}
        style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-subtle)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        Новый чат
      </button>
      <button
        onClick={onNewChannel}
        style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-subtle)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        Новый канал
      </button>
    </div>
  )
}
