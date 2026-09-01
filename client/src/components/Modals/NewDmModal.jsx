import { useState } from 'react'
import Modal from './Modal'
import UserPicker from './UserPicker'
import { createOrGetDirectMessage } from '../../lib/matrix'

export default function NewDmModal({ onClose, onCreated }) {
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (selected.length === 0) return
    setLoading(true)
    setError('')
    try {
      const roomId = await createOrGetDirectMessage(selected[0])
      onCreated(roomId)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось создать чат')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Новое личное сообщение"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
          <button
            onClick={handleSubmit}
            disabled={selected.length === 0 || loading}
            style={{ padding: '8px 14px', borderRadius: '7px', background: selected.length ? 'var(--accent-teal)' : 'var(--bg-card)', color: selected.length ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {loading ? 'Создание...' : 'Начать чат'}
          </button>
        </>
      }
    >
      <UserPicker mode="single" selectedIds={selected} onChange={setSelected} />
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
