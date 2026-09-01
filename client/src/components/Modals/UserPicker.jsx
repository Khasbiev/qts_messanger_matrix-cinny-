import { useState, useEffect, useRef } from 'react'
import { searchUsers } from '../../lib/matrix'

export default function UserPicker({ mode = 'single', selectedIds, onChange }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!term.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const users = await searchUsers(term)
        setResults(users)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [term])

  const toggle = (userId) => {
    if (mode === 'single') {
      onChange([userId])
      return
    }
    const isSelected = selectedIds.includes(userId)
    onChange(isSelected ? selectedIds.filter(id => id !== userId) : [...selectedIds, userId])
  }

  return (
    <div>
      <input
        value={term}
        onChange={e => setTerm(e.target.value)}
        placeholder="Поиск пользователя..."
        style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ marginTop: '10px', maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {loading && <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Поиск...</div>}
        {!loading && term.trim() && results.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Никого не найдено</div>
        )}
        {results.map(u => {
          const isSelected = selectedIds.includes(u.user_id)
          const label = u.display_name || u.user_id
          return (
            <div
              key={u.user_id}
              onClick={() => toggle(u.user_id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer', background: isSelected ? 'var(--bg-card)' : 'transparent' }}
            >
              <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: isSelected ? 'var(--accent-teal)' : 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: isSelected ? '#000' : 'var(--text-secondary)', flexShrink: 0 }}>
                {label.replace('@', '').slice(0, 2).toUpperCase()}
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              {isSelected && <span style={{ color: 'var(--accent-teal)', fontSize: '13px' }}>✓</span>}
            </div>
          )
        })}
      </div>
      {mode === 'multi' && selectedIds.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Выбрано: {selectedIds.length}
        </div>
      )}
    </div>
  )
}
