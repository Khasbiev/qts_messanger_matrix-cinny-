import { useState } from 'react'
import Modal from './Modal'
import UserPicker from './UserPicker'
import { createChannel } from '../../lib/matrix'

export default function NewChannelModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = name.trim().length > 0 && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      const roomId = await createChannel({ name: name.trim(), topic: topic.trim(), inviteUserIds: selected })
      onCreated(roomId)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось создать канал')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Новый канал"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ padding: '8px 14px', borderRadius: '7px', background: canSubmit ? 'var(--accent-teal)' : 'var(--bg-card)', color: canSubmit ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Название канала"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
        />
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Тема (необязательно)"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
        />
        <UserPicker mode="multi" selectedIds={selected} onChange={setSelected} />
      </div>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
