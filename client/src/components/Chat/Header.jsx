import { useState, useEffect } from 'react'
import { RoomMemberEvent, UserEvent } from 'matrix-js-sdk'
import { IconArrowLeft, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import { isDirectRoom } from '../../lib/matrix'

const NAV_ICON = {
  back: IconArrowLeft,
  collapse: IconLayoutSidebarLeftCollapse,
  expand: IconLayoutSidebarLeftExpand,
}

function pluralizePeople(count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'человек'
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'человека'
  return 'человек'
}

export default function Header({ client, room, navMode, onNav }) {
  const memberCount = room.getJoinedMemberCount()
  const isDM = isDirectRoom(client, room.roomId)
  const color = colorFor(room.roomId)
  const avatarLabel = isDM ? room.name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const NavIcon = NAV_ICON[navMode]

  const [typingNames, setTypingNames] = useState([])

  useEffect(() => {
    const me = client.getUserId()
    const computeTyping = () => {
      const names = room.getJoinedMembers()
        .filter(m => m.userId !== me && m.typing)
        .map(m => m.name)
      setTypingNames(names)
    }
    computeTyping()
    const onTyping = (event, member) => {
      if (member.roomId !== room.roomId) return
      computeTyping()
    }
    client.on(RoomMemberEvent.Typing, onTyping)
    return () => client.off(RoomMemberEvent.Typing, onTyping)
  }, [client, room])

  const [presence, setPresence] = useState(null)

  useEffect(() => {
    if (!isDM) {
      setPresence(null)
      return
    }
    const me = client.getUserId()
    const other = room.getJoinedMembers().find(m => m.userId !== me)
    if (!other) {
      setPresence(null)
      return
    }
    const otherUserId = other.userId
    let cancelled = false

    setPresence(null)
    client.getPresence(otherUserId)
      .then(status => { if (!cancelled) setPresence(status.presence) })
      .catch(err => console.error('Presence fetch failed:', err))

    const onPresence = (event, user) => {
      if (user.userId !== otherUserId) return
      setPresence(user.presence)
    }
    client.on(UserEvent.Presence, onPresence)
    return () => {
      cancelled = true
      client.off(UserEvent.Presence, onPresence)
    }
  }, [client, room, isDM])

  const presenceText = presence === 'online' ? 'в сети' : presence === 'unavailable' ? 'отошёл' : 'не в сети'

  const subtitle = typingNames.length > 0
    ? (typingNames.length === 1 ? 'печатает…' : `${typingNames.length} ${pluralizePeople(typingNames.length)} печатают…`)
    : (isDM ? presenceText : `${memberCount} участник${memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов'}`)

  return (
    <div style={{
      height: '58px',
      padding: '0 16px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexShrink: 0,
    }}>
      {NavIcon && (
        <button
          onClick={onNav}
          title={navMode === 'back' ? 'Назад к чатам' : navMode === 'collapse' ? 'Свернуть список чатов' : 'Показать список чатов'}
          style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0, transition: 'all 0.12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <NavIcon size={19} strokeWidth={2} />
        </button>
      )}

      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: color.bg,
        color: color.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 600,
        flexShrink: 0,
      }}>
        {avatarLabel}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {room.name}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--accent-teal)', marginTop: '1px' }}>
          {subtitle}
        </div>
      </div>

    </div>
  )
}
