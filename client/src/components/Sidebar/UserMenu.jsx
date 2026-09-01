import { useEffect, useRef } from 'react'
import { IconAddressBook, IconSettings, IconLogout } from '@tabler/icons-react'

export default function UserMenu({ client, onClose, onOpenContacts, onOpenSettings, onLogout }) {
  const ref = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const userId = client?.getUserId() || ''
  const displayName = userId.replace('@', '').split(':')[0]
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '48px',
        left: '10px',
        width: '220px',
        zIndex: 200,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: '#000', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userId}</div>
        </div>
      </div>

      <MenuItem icon={IconAddressBook} label="Контакты" onClick={() => { onClose(); onOpenContacts() }} />
      <MenuItem icon={IconSettings} label="Настройки" onClick={() => { onClose(); onOpenSettings() }} />
      <MenuItem icon={IconLogout} label="Выйти" onClick={() => { onClose(); onLogout() }} danger />
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', color: danger ? '#ff6b6b' : 'var(--text-primary)', fontSize: '13px', textAlign: 'left' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <Icon size={16} strokeWidth={2} />
      {label}
    </button>
  )
}
