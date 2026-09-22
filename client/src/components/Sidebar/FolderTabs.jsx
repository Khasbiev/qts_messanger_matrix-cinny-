import { IconPlus } from '@tabler/icons-react'

export default function FolderTabs({ folders, activeFolderId, onSelect, onCreateClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px 4px', overflowX: 'auto', flexShrink: 0 }}>
      {folders.map(folder => {
        const active = folder.id === activeFolderId
        return (
          <button
            key={folder.id}
            onClick={() => onSelect(folder.id)}
            style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: '14px', fontSize: '12px', fontWeight: 600,
              whiteSpace: 'nowrap',
              background: active ? 'var(--accent-teal)' : 'var(--bg-card)',
              color: active ? '#000' : 'var(--text-secondary)',
              border: `1px solid ${active ? 'var(--accent-teal)' : 'var(--border)'}`,
            }}
          >
            {folder.name}
          </button>
        )
      })}
      <button
        onClick={onCreateClick}
        style={{ flexShrink: 0, width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <IconPlus size={14} />
      </button>
    </div>
  )
}
