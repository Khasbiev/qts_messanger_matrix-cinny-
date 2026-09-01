import { useState } from 'react'
import { IconPinned, IconX } from '@tabler/icons-react'

export default function PinnedBar() {
  const [visible, setVisible] = useState(true)
  if (!visible) return null

  return (
    <div style={{
      padding: '7px 16px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0,
    }}>
      <IconPinned size={13} color="var(--accent-teal)" strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>Закреплено: </span>
        Сегодня в 15:00 созвон по новому дизайну. Ссылка на встречу в описании канала.
      </span>
      <button
        onClick={() => setVisible(false)}
        style={{ color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <IconX size={14} />
      </button>
    </div>
  )
}
