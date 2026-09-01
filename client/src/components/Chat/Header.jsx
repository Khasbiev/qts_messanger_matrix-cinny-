import { IconSearch, IconBell } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import { isDirectRoom } from '../../lib/matrix'

export default function Header({ client, room }) {
  const memberCount = room.getJoinedMemberCount()
  const isDM = isDirectRoom(client, room.roomId)
  const color = colorFor(room.roomId)
  const avatarLabel = isDM ? room.name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`

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
          {isDM ? 'в сети' : `${memberCount} участник${memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов'}`}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        {[IconSearch, IconBell].map((Icon, i) => (
          <button
            key={i}
            style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', transition: 'all 0.12s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <Icon size={18} strokeWidth={1.8} />
          </button>
        ))}
      </div>
    </div>
  )
}
