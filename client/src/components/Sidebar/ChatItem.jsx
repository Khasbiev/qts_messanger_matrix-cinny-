import { IconHash } from '@tabler/icons-react'

export default function ChatItem({ item, type, isActive, onSelect }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        padding: '5px 10px 5px 10px',
        margin: '1px 6px',
        borderRadius: '6px',
        cursor: 'pointer',
        borderLeft: isActive ? '2px solid var(--accent-teal)' : '2px solid transparent',
        background: isActive ? 'var(--bg-card)' : 'transparent',
        transition: 'background 0.1s',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      {type === 'channel' ? (
        <ChannelItem item={item} isActive={isActive} />
      ) : (
        <DmItem item={item} isActive={isActive} />
      )}
    </div>
  )
}

function ChannelItem({ item, isActive }) {
  return (
    <>
      <IconHash
        size={14}
        color={isActive ? 'var(--text-secondary)' : 'var(--text-muted)'}
        strokeWidth={2}
        style={{ flexShrink: 0 }}
      />
      <span style={{
        flex: 1,
        fontSize: '14px',
        color: isActive
          ? 'var(--text-primary)'
          : item.unread > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
        fontWeight: item.unread > 0 ? 500 : 400,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {item.name}
      </span>
      {item.unread > 0 && <Badge count={item.unread} />}
    </>
  )
}

function DmItem({ item, isActive }) {
  return (
    <>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: '26px',
          height: '26px',
          borderRadius: '50%',
          background: isActive ? 'var(--accent-teal)' : 'var(--bg-card)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 600,
          color: isActive ? '#000' : 'var(--text-secondary)',
        }}>
          {item.avatar}
        </div>
        {item.online && (
          <div style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#3ba55c',
            border: '1.5px solid var(--bg-surface)',
          }} />
        )}
      </div>
      <span style={{
        flex: 1,
        fontSize: '14px',
        color: isActive
          ? 'var(--text-primary)'
          : item.unread > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
        fontWeight: item.unread > 0 ? 500 : 400,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {item.name}
      </span>
      {item.unread > 0 && <Badge count={item.unread} />}
    </>
  )
}

function Badge({ count }) {
  return (
    <span style={{
      background: 'var(--accent-orange)',
      color: '#fff',
      borderRadius: '10px',
      padding: '1px 5px',
      fontSize: '11px',
      fontWeight: 700,
      minWidth: '18px',
      textAlign: 'center',
      flexShrink: 0,
    }}>
      {count}
    </span>
  )
}
