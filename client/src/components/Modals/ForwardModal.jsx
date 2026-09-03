import { useState } from 'react'
import Modal from './Modal'
import { getClient, isDirectRoom, forwardMessage } from '../../lib/matrix'

function buildRoomList(client) {
  const me = client.getUserId()
  return client.getRooms()
    .filter(room => room.getMyMembership() === 'join')
    .map(room => {
      const isDM = isDirectRoom(client, room.roomId)
      const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
      const name = isDM ? (other?.name || room.name) : room.name
      return { id: room.roomId, name, isDM }
    })
}

export default function ForwardModal({ message, roomId, onClose }) {
  const client = getClient()
  const [rooms] = useState(() => buildRoomList(client))
  const [selectedIds, setSelectedIds] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const toggle = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const canSend = selectedIds.length > 0 && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setError('')
    try {
      await forwardMessage(roomId, message, selectedIds)
      onClose()
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось переслать сообщение')
      setSending(false)
    }
  }

  return (
    <Modal
      title="Переслать сообщение"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{ padding: '8px 14px', borderRadius: '7px', background: canSend ? 'var(--accent-teal)' : 'var(--bg-card)', color: canSend ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {sending ? 'Отправка...' : 'Переслать'}
          </button>
        </>
      }
    >
      <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {rooms.map(room => {
          const isSelected = selectedIds.includes(room.id)
          return (
            <div
              key={room.id}
              onClick={() => toggle(room.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', borderRadius: '6px', cursor: 'pointer', background: isSelected ? 'var(--bg-card)' : 'transparent' }}
            >
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isSelected ? 'var(--accent-teal)' : 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: isSelected ? '#000' : 'var(--text-secondary)', flexShrink: 0 }}>
                {room.isDM ? room.name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`}
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</span>
              {isSelected && <span style={{ color: 'var(--accent-teal)', fontSize: '13px' }}>✓</span>}
            </div>
          )
        })}
        {rooms.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Нет доступных чатов</div>
        )}
      </div>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
