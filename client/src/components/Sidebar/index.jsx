import { useState, useEffect, useCallback } from 'react'
import { IconSearch, IconPlus, IconMenu2 } from '@tabler/icons-react'
import { ClientEvent, RoomEvent } from 'matrix-js-sdk'
import ChatItem from './ChatItem'
import UserMenu from './UserMenu'
import NewDmModal from '../Modals/NewDmModal'
import NewChannelModal from '../Modals/NewChannelModal'
import SettingsModal from '../Modals/SettingsModal'
import { waitForRoom, isDirectRoom } from '../../lib/matrix'

function formatChatTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'вчера'
  return date.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })
}

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

function categorize(client, rooms) {
  const channels = []
  const dms = []
  for (const room of rooms) {
    if (isDirectRoom(client, room.roomId)) {
      dms.push(room)
    } else {
      channels.push(room)
    }
  }
  return { channels, dms }
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout, fullWidth }) {
  const [rooms, setRooms] = useState(() => categorize(client, client.getRooms()))

  const refresh = useCallback(() => {
    setRooms(categorize(client, client.getRooms()))
  }, [client])

  const [showNewDm, setShowNewDm] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const handleCreated = async (roomId) => {
    setShowNewDm(false)
    setShowNewChannel(false)
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
          <input placeholder="Поиск..." style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '13px' }} />
        </div>
      </div>

      {showUserMenu && (
        <UserMenu
          client={client}
          onClose={() => setShowUserMenu(false)}
          onOpenSettings={() => setShowSettings(true)}
          onLogout={onLogout}
        />
      )}

      {/* Room list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        <SectionHeader label="КАНАЛЫ" onClick={() => setShowNewChannel(true)} />
        {rooms.channels.length > 0 && (
          <>
            {rooms.channels.map(room => {
              const preview = getPreview(room)
              return (
                <ChatItem
                  key={room.roomId}
                  item={{ id: room.roomId, name: room.name, unread: room.getUnreadNotificationCount(), preview: preview.text, time: preview.time }}
                  type="channel"
                  isActive={activeRoom?.roomId === room.roomId}
                  onSelect={() => onRoomSelect(room)}
                />
              )
            })}
          </>
        )}

        <SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} onClick={() => setShowNewDm(true)} />
        {rooms.dms.length > 0 && (
          <>
            {rooms.dms.map(room => {
              const other = room.getJoinedMembers().find(m => m.userId !== client.getUserId())
              const name = other?.name || room.name
              const preview = getPreview(room)
              return (
                <ChatItem
                  key={room.roomId}
                  item={{ id: room.roomId, name, avatar: name.slice(0, 2).toUpperCase(), online: false, unread: room.getUnreadNotificationCount(), preview: preview.text, time: preview.time }}
                  type="dm"
                  isActive={activeRoom?.roomId === room.roomId}
                  onSelect={() => onRoomSelect(room)}
                />
              )
            })}
          </>
        )}

        {rooms.channels.length === 0 && rooms.dms.length === 0 && (
          <div style={{ padding: '24px 14px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
            Нет доступных комнат
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
    </div>
  )
}

function SectionHeader({ label, style, onClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 4px', ...style }}>
      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', userSelect: 'none' }}>{label}</span>
      <button
        onClick={onClick}
        style={{ color: 'var(--text-muted)', display: 'flex', padding: '2px', borderRadius: '3px' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <IconPlus size={13} />
      </button>
    </div>
  )
}
