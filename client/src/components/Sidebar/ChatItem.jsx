import { colorFor } from '../../lib/avatarColor'

export default function ChatItem({ item, type, isActive, onSelect }) {
  const color = colorFor(item.id)
  const avatarLabel = type === 'channel' ? `#${item.name.slice(0, 1).toUpperCase()}` : item.avatar

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        margin: '1px 6px',
        borderRadius: '8px',
        cursor: 'pointer',
        borderLeft: isActive ? '2px solid var(--accent-teal)' : '2px solid transparent',
        background: isActive ? 'var(--bg-card)' : 'transparent',
        transition: 'background 0.1s',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Avatar */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: color.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 600,
          color: color.fg,
        }}>
          {avatarLabel}
        </div>
        {type === 'dm' && item.online && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '9px',
            height: '9px',
            borderRadius: '50%',
            background: '#3ba55c',
            border: '1.5px solid var(--bg-surface)',
          }} />
        )}
      </div>

      {/* Name + preview */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px',
          color: isActive ? 'var(--text-primary)' : item.unread > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: item.unread > 0 ? 600 : 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.name}
        </div>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginTop: '2px',
        }}>
          {item.preview || ' '}
        </div>
      </div>

      {/* Time + badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>
        {item.time && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</span>
        )}
        {item.unread > 0 && <Badge count={item.unread} />}
      </div>
    </div>
  )
}

function Badge({ count }) {
  return (
    <span style={{
      background: 'var(--accent-orange)',
      color: '#fff',
      borderRadius: '10px',
      padding: '1px 6px',
      fontSize: '11px',
      fontWeight: 700,
      minWidth: '18px',
      textAlign: 'center',
    }}>
      {count}
    </span>
  )
}
