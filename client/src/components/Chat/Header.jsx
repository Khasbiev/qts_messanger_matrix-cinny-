import { IconHash, IconAt, IconUsers, IconSearch, IconBell } from '@tabler/icons-react'

export default function Header({ room }) {
  const memberCount = room.getJoinedMemberCount()
  const isDM = memberCount === 2

  return (
    <div style={{
      height: '52px',
      padding: '0 16px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0,
    }}>
      {isDM
        ? <IconAt size={17} color="var(--text-secondary)" strokeWidth={2} />
        : <IconHash size={17} color="var(--text-secondary)" strokeWidth={2} />
      }

      <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>
        {room.name}
      </span>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', marginRight: '4px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          <IconUsers size={15} strokeWidth={2} />
          <span>{memberCount}</span>
        </div>
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
