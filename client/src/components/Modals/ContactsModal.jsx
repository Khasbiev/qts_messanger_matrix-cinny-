import { useState, useEffect, useRef } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import Modal from './Modal'
import { searchUsers, createOrGetDirectMessage } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'

export default function ContactsModal({ onClose, onOpenChat }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(null)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!term.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        setResults(await searchUsers(term))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [term])

  const handlePick = async (userId) => {
    setOpening(userId)
    setError('')
    try {
      const roomId = await createOrGetDirectMessage(userId)
      onOpenChat(roomId)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось открыть чат')
      setOpening(null)
    }
  }

  return (
    <Modal title="Контакты" onClose={onClose}>
      <input
        value={term}
        onChange={e => setTerm(e.target.value)}
        placeholder="Поиск пользователя..."
        style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
      />

      <div style={{ marginTop: '10px', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {!term.trim() && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>
            Начните вводить имя, чтобы найти человека
          </div>
        )}
        {loading && <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Поиск...</div>}
        {!loading && term.trim() && results.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Никого не найдено</div>
        )}
        {results.map(u => {
          const label = u.display_name || u.user_id
          const color = colorFor(u.user_id)
          const isOpening = opening === u.user_id
          return (
            <div
              key={u.user_id}
              onClick={() => !opening && handlePick(u.user_id)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '6px', cursor: opening ? 'default' : 'pointer', opacity: opening && !isOpening ? 0.5 : 1 }}
              onMouseEnter={e => { if (!opening) e.currentTarget.style.background = 'var(--bg-card)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            >
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: color.bg, color: color.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, flexShrink: 0 }}>
                {label.replace('@', '').slice(0, 2).toUpperCase()}
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              {isOpening && <IconLoader2 size={15} className="spin" color="var(--text-muted)" />}
            </div>
          )
        })}
      </div>

      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
