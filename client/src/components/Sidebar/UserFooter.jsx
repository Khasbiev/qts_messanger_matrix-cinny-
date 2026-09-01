import { IconMicrophone, IconHeadphones, IconLogout } from '@tabler/icons-react'

export default function UserFooter({ client, onLogout }) {
  const userId = client?.getUserId() || ''
  const displayName = userId.replace('@', '').split(':')[0]
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div style={{
      padding: '8px 10px',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0,
      background: 'var(--bg-card)',
    }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'var(--accent-teal)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', fontWeight: 700, color: '#000',
        }}>
          {initials}
        </div>
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: '9px', height: '9px', borderRadius: '50%',
          background: '#3ba55c', border: '1.5px solid var(--bg-surface)',
        }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1.3' }}>
          {displayName}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.3' }}>В сети</div>
      </div>

      <div style={{ display: 'flex', gap: '2px' }}>
        {[IconMicrophone, IconHeadphones].map((Icon, i) => (
          <FooterBtn key={i}><Icon size={15} strokeWidth={1.8} /></FooterBtn>
        ))}
        <FooterBtn title="Выйти" onClick={onLogout}><IconLogout size={15} strokeWidth={1.8} /></FooterBtn>
      </div>
    </div>
  )
}

function FooterBtn({ title, onClick, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{ width: '26px', height: '26px', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'all 0.12s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </button>
  )
}
