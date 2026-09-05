export default function MentionAutocomplete({ members, selectedIndex, onSelect, onHover }) {
  if (members.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '54px',
        left: '8px',
        width: '220px',
        maxHeight: '220px',
        overflowY: 'auto',
        zIndex: 200,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        padding: '4px',
      }}
    >
      {members.map((member, i) => (
        <div
          key={member.userId}
          onMouseDown={e => { e.preventDefault(); onSelect(member) }}
          onMouseEnter={() => onHover(i)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 8px',
            borderRadius: '6px',
            cursor: 'pointer',
            background: i === selectedIndex ? 'rgba(255,255,255,0.07)' : 'transparent',
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {member.name.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member.name}
          </span>
        </div>
      ))}
    </div>
  )
}
