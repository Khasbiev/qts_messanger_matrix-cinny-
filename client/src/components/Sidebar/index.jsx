import { useState, useEffect, useCallback } from 'react'
import { IconSearch, IconPlus } from '@tabler/icons-react'
import { ClientEvent, RoomEvent } from 'matrix-js-sdk'
import ChatItem from './ChatItem'
import UserFooter from './UserFooter'

function categorize(client, rooms) {
  const directRoomIds = new Set(
    Object.values(client.getAccountData('m.direct')?.getContent() || {}).flat()
  )
  const channels = []
  const dms = []
  for (const room of rooms) {
    if (directRoomIds.has(room.roomId)) {
      dms.push(room)
    } else {
      channels.push(room)
    }
  }
  return { channels, dms }
}

export default function Sidebar({ client, activeRoom, onRoomSelect, onLogout }) {
  const [rooms, setRooms] = useState(() => categorize(client, client.getRooms()))

  const refresh = useCallback(() => {
    setRooms(categorize(client, client.getRooms()))
  }, [client])

  useEffect(() => {
    client.on(ClientEvent.Sync, refresh)
    client.on(RoomEvent.MyMembership, refresh)
    client.on(ClientEvent.AccountData, refresh)
    return () => {
      client.off(ClientEvent.Sync, refresh)
      client.off(RoomEvent.MyMembership, refresh)
      client.off(ClientEvent.AccountData, refresh)
    }
  }, [client, refresh])

  return (
    <div style={{
      width: '240px',
      flexShrink: 0,
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      borderRight: '1px solid var(--border)',
    }}>
      {/* Logo */}
      <div style={{ height: '52px', padding: '0 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '17px', fontWeight: 700, color: 'var(--accent-teal)', marginRight: '1px' }}>{'>'}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>qts.dev</span>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 10px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px' }}>
          <IconSearch size={13} color="var(--text-muted)" strokeWidth={2} />
          <input placeholder="Поиск..." style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '13px' }} />
        </div>
      </div>

      {/* Room list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        {rooms.channels.length > 0 && (
          <>
            <SectionHeader label="КАНАЛЫ" />
            {rooms.channels.map(room => (
              <ChatItem
                key={room.roomId}
                item={{ id: room.roomId, name: room.name, unread: room.getUnreadNotificationCount() }}
                type="channel"
                isActive={activeRoom?.roomId === room.roomId}
                onSelect={() => onRoomSelect(room)}
              />
            ))}
          </>
        )}

        {rooms.dms.length > 0 && (
          <>
            <SectionHeader label="ЛИЧНЫЕ СООБЩЕНИЯ" style={{ marginTop: '8px' }} />
            {rooms.dms.map(room => {
              const other = room.getJoinedMembers().find(m => m.userId !== client.getUserId())
              const name = other?.name || room.name
              return (
                <ChatItem
                  key={room.roomId}
                  item={{ id: room.roomId, name, avatar: name.slice(0, 2).toUpperCase(), online: false, unread: room.getUnreadNotificationCount() }}
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

      <UserFooter client={client} onLogout={onLogout} />
    </div>
  )
}

function SectionHeader({ label, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 4px', ...style }}>
      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', userSelect: 'none' }}>{label}</span>
      <button
        style={{ color: 'var(--text-muted)', display: 'flex', padding: '2px', borderRadius: '3px' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <IconPlus size={13} />
      </button>
    </div>
  )
}
