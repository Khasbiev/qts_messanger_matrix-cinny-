import { IconPlus } from '@tabler/icons-react'

export default function FolderTabs({ folders, activeFolderId, onSelect, onCreateClick }) {
  return (
    <div style={{ width: '56px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '8px 0', overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
      {folders.map(folder => {
        const active = folder.id === activeFolderId
        const label = folder.id === 'all' ? 'Вс' : folder.name.trim().slice(0, 2)
        return (
          <button
            key={folder.id}
            onClick={() => onSelect(folder.id)}
            title={folder.name}
            style={{
              width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 700, textTransform: 'uppercase',
              background: active ? 'var(--accent-teal)' : 'var(--bg-card)',
              color: active ? '#000' : 'var(--text-secondary)',
              border: `1px solid ${active ? 'var(--accent-teal)' : 'var(--border)'}`,
            }}
          >
            {label}
          </button>
        )
      })}
      <button
        onClick={onCreateClick}
        title="Создать папку"
        style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <IconPlus size={16} />
      </button>
    </div>
  )
}
