import { useState, useEffect } from 'react'
import { UserEvent } from 'matrix-js-sdk'
import Modal from './Modal'
import { isDirectRoom, leaveRoom } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'

export default function ChatInfoModal({ client, room, onClose, onLeave }) {
  const isDM = isDirectRoom(client, room.roomId)
  const me = client.getUserId()
  const color = colorFor(room.roomId)

  const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
  const name = isDM ? (other?.name || room.name) : room.name
  const avatarLabel = isDM ? name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const members = isDM ? [] : room.getJoinedMembers()

  const [presence, setPresence] = useState(null)
  useEffect(() => {
    if (!isDM || !other) return
    let cancelled = false
    client.getPresence(other.userId)
      .then(status => { if (!cancelled) setPresence(status.presence) })
      .catch(err => console.error('Presence fetch failed:', err))
    const onPresence = (event, user) => {
      if (user.userId !== other.userId) return
      setPresence(user.presence)
    }
    client.on(UserEvent.Presence, onPresence)
    return () => { cancelled = true; client.off(UserEvent.Presence, onPresence) }
  }, [client, isDM, other?.userId])

  const presenceText = presence === 'online' ? 'в сети' : presence === 'unavailable' ? 'отошёл' : 'не в сети'

  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  const handleLeave = async () => {
    setLeaving(true)
    setError('')
    try {
      await leaveRoom(room.roomId)
      onLeave()
      onClose()
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось выйти из чата')
      setLeaving(false)
    }
  }

  return (
    <Modal title={isDM ? 'Информация' : 'О канале'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: color.bg, color: color.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', fontWeight: 700,
          }}>
            {avatarLabel}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
          {isDM && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{presenceText}</div>}
        </div>

        {!isDM && (
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Тема
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px' }}>
              {room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || 'Нет темы'}
            </div>
          </div>
        )}

        {!isDM && (
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Участники ({members.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
              {members.map(m => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                    {m.name}{m.userId === me ? ' (вы)' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleLeave}
          disabled={leaving}
          style={{ padding: '10px 14px', borderRadius: '7px', background: 'rgba(255,77,77,0.1)', color: '#ff4d4d', fontSize: '13px', fontWeight: 600, border: '1px solid rgba(255,77,77,0.3)' }}
        >
          {leaving ? 'Выход...' : 'Выйти из чата'}
        </button>

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
  )
}
