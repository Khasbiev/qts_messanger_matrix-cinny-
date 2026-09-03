import { useState, useEffect, useRef } from 'react'
import { IconCamera, IconLoader2, IconPencil, IconPlus } from '@tabler/icons-react'
import Modal from './Modal'
import UserPicker from './UserPicker'
import {
  isDirectRoom, leaveRoom, resolveMediaUrl,
  updateRoomTopic, updateRoomAvatar, inviteToRoom, kickFromRoom,
} from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'

export default function ChatInfoModal({ client, room, onClose, onLeave, presenceText }) {
  const isDM = isDirectRoom(client, room.roomId)
  const me = client.getUserId()
  const color = colorFor(room.roomId)

  const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
  const name = isDM ? (other?.name || room.name) : room.name
  const avatarLabel = isDM ? name.slice(0, 2).toUpperCase() : `#${room.name.slice(0, 1).toUpperCase()}`
  const members = isDM ? [] : room.getJoinedMembers()

  const myPowerLevel = room.getMember(me)?.powerLevel || 0
  const canEditTopic = !isDM && room.currentState.maySendStateEvent('m.room.topic', me)
  const canEditAvatar = !isDM && room.currentState.maySendStateEvent('m.room.avatar', me)
  const canInvite = !isDM && room.currentState.hasSufficientPowerLevelFor('invite', myPowerLevel)
  const canKick = !isDM && room.currentState.hasSufficientPowerLevelFor('kick', myPowerLevel)

  const [error, setError] = useState('')

  const [leaving, setLeaving] = useState(false)
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

  const [avatarMxcUrl, setAvatarMxcUrl] = useState(() => room.getMxcAvatarUrl())
  const [avatarBlobUrl, setAvatarBlobUrl] = useState(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!avatarMxcUrl) { setAvatarBlobUrl(null); return }
    let cancelled = false
    let url = null
    resolveMediaUrl(avatarMxcUrl).then(resolved => {
      if (cancelled) { URL.revokeObjectURL(resolved); return }
      url = resolved
      setAvatarBlobUrl(resolved)
    }).catch(() => {})
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [avatarMxcUrl])

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingAvatar(true)
    setError('')
    try {
      const mxcUrl = await updateRoomAvatar(room.roomId, file)
      setAvatarMxcUrl(mxcUrl)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось обновить аватар')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const [editingTopic, setEditingTopic] = useState(false)
  const [topicValue, setTopicValue] = useState(() => room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '')
  const [savingTopic, setSavingTopic] = useState(false)

  const handleSaveTopic = async () => {
    setSavingTopic(true)
    setError('')
    try {
      await updateRoomTopic(room.roomId, topicValue.trim())
      setEditingTopic(false)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось обновить тему')
    } finally {
      setSavingTopic(false)
    }
  }

  const [addingMember, setAddingMember] = useState(false)
  const [inviteIds, setInviteIds] = useState([])
  const [inviting, setInviting] = useState(false)

  const handleInvite = async () => {
    if (inviteIds.length === 0) return
    setInviting(true)
    setError('')
    try {
      await Promise.all(inviteIds.map(userId => inviteToRoom(room.roomId, userId)))
      setAddingMember(false)
      setInviteIds([])
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось пригласить участника')
    } finally {
      setInviting(false)
    }
  }

  const [kickTarget, setKickTarget] = useState(null)
  const [kicking, setKicking] = useState(false)
  const [kickError, setKickError] = useState('')

  const handleKick = async () => {
    if (!kickTarget) return
    setKicking(true)
    setKickError('')
    try {
      await kickFromRoom(room.roomId, kickTarget.userId)
      setKickTarget(null)
    } catch (err) {
      setKickError(err.data?.error || err.message || 'Не удалось убрать участника')
    } finally {
      setKicking(false)
    }
  }

  return (
    <>
    <Modal title={isDM ? 'Информация' : 'О канале'} onClose={() => { if (!kickTarget) onClose() }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <div
              onClick={canEditAvatar ? () => fileInputRef.current?.click() : undefined}
              style={{
                width: '64px', height: '64px', borderRadius: '50%', cursor: canEditAvatar ? 'pointer' : 'default',
                background: avatarBlobUrl ? `center/cover url(${avatarBlobUrl})` : color.bg,
                color: color.fg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', fontWeight: 700, overflow: 'hidden',
              }}
            >
              {!avatarBlobUrl && avatarLabel}
            </div>
            {canEditAvatar && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ position: 'absolute', bottom: 0, right: 0, width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent-teal)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-surface)' }}
                >
                  {uploadingAvatar ? <IconLoader2 size={12} className="spin" /> : <IconCamera size={12} strokeWidth={2.2} />}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
              </>
            )}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
          {isDM && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{presenceText}</div>}
        </div>

        {!isDM && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Тема</span>
              {canEditTopic && !editingTopic && (
                <button onClick={() => setEditingTopic(true)} style={{ color: 'var(--text-muted)', display: 'flex' }}>
                  <IconPencil size={13} />
                </button>
              )}
            </div>
            {editingTopic ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={topicValue}
                  onChange={e => setTopicValue(e.target.value)}
                  style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', outline: 'none' }}
                />
                <button
                  onClick={handleSaveTopic}
                  disabled={savingTopic}
                  style={{ padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, background: 'var(--accent-teal)', color: '#000' }}
                >
                  {savingTopic ? '...' : 'Сохранить'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: topicValue ? 'var(--text-primary)' : 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px' }}>
                {topicValue || 'Нет темы'}
              </div>
            )}
          </div>
        )}

        {!isDM && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Участники ({members.length})</span>
              {canInvite && !addingMember && (
                <button onClick={() => setAddingMember(true)} style={{ color: 'var(--text-muted)', display: 'flex' }}>
                  <IconPlus size={14} />
                </button>
              )}
            </div>

            {addingMember && (
              <div style={{ marginBottom: '10px' }}>
                <UserPicker mode="single" selectedIds={inviteIds} onChange={setInviteIds} />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    onClick={() => { setAddingMember(false); setInviteIds([]) }}
                    style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={inviteIds.length === 0 || inviting}
                    style={{ padding: '8px 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, background: inviteIds.length > 0 ? 'var(--accent-teal)' : 'var(--bg-card)', color: inviteIds.length > 0 ? '#000' : 'var(--text-muted)' }}
                  >
                    {inviting ? 'Отправка...' : 'Пригласить'}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
              {members.map(m => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                    {m.name}{m.userId === me ? ' (вы)' : ''}
                  </span>
                  {canKick && m.userId !== me && m.powerLevel < myPowerLevel && (
                    <button onClick={() => { setKickError(''); setKickTarget(m) }} style={{ fontSize: '11px', color: '#ff4d4d' }}>Убрать</button>
                  )}
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
    {kickTarget && (
      <Modal
        title="Убрать участника?"
        onClose={() => { setKickTarget(null); setKickError('') }}
        footer={
          <>
            <button onClick={() => { setKickTarget(null); setKickError('') }} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
            <button onClick={handleKick} disabled={kicking} style={{ padding: '8px 14px', borderRadius: '7px', background: '#ff4d4d', color: '#fff', fontSize: '13px', fontWeight: 600, border: 'none' }}>
              {kicking ? '...' : 'Убрать'}
            </button>
          </>
        }
      >
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Убрать {kickTarget.name} из канала?
        </div>
        {kickError && <div style={{ fontSize: '12px', color: '#ff4d4d', marginTop: '10px' }}>{kickError}</div>}
      </Modal>
    )}
    </>
  )
}
