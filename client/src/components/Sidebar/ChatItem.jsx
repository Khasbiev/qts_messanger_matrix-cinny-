import { useRef } from 'react'
import { IconPinFilled } from '@tabler/icons-react'
import { colorFor } from '../../lib/avatarColor'
import Avatar from '../Avatar'

const LONG_PRESS_MS = 500

export default function ChatItem({ item, type, isActive, pinned, onSelect, onContextMenu }) {
  const color = colorFor(item.id)
  const avatarLabel = type === 'channel' ? `#${item.name.slice(0, 1).toUpperCase()}` : item.avatar
  const longPressTimer = useRef(null)
  const longPressFired = useRef(false)

  const handleTouchStart = (e) => {
    if (!onContextMenu) return
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      onContextMenu({ preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY })
    }, LONG_PRESS_MS)
  }
  const cancelLongPress = () => clearTimeout(longPressTimer.current)
  const handleClick = (e) => {
    // Swallow the click mobile browsers fire right after the touchend that
    // follows a long-press - otherwise the just-opened context menu's
    // target chat would also get selected/navigated to underneath it.
    if (longPressFired.current) { longPressFired.current = false; return }
    onSelect(e)
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
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
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--overlay-subtle)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Avatar */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar mxcUrl={item.avatarMxcUrl} label={avatarLabel} size={36} bg={color.bg} fg={color.fg} style={{ fontSize: '12px' }} />
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
        {pinned ? (
          <IconPinFilled size={13} color="var(--text-muted)" />
        ) : item.time && (
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
