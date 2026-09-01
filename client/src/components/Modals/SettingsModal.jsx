import { useState, useEffect, useRef } from 'react'
import { IconCamera, IconLoader2 } from '@tabler/icons-react'
import Modal from './Modal'
import { getOwnProfile, updateDisplayName, updateAvatar, resolveMediaUrl } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'

export default function SettingsModal({ client, onClose }) {
  const userId = client?.getUserId() || ''
  const homeserver = client?.getHomeserverUrl?.() || ''
  const deviceId = client?.getDeviceId?.() || ''
  const color = colorFor(userId)

  const [profile, setProfile] = useState(() => getOwnProfile())
  const [avatarBlobUrl, setAvatarBlobUrl] = useState(null)
  const [name, setName] = useState(profile.displayName)
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let url = null
    if (profile.avatarMxcUrl) {
      resolveMediaUrl(profile.avatarMxcUrl).then(resolved => {
        if (cancelled) { URL.revokeObjectURL(resolved); return }
        url = resolved
        setAvatarBlobUrl(resolved)
      }).catch(() => {})
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [profile.avatarMxcUrl])

  const handleAvatarClick = () => fileInputRef.current?.click()

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingAvatar(true)
    setError('')
    try {
      const mxcUrl = await updateAvatar(file)
      setProfile(p => ({ ...p, avatarMxcUrl: mxcUrl }))
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось обновить аватар')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleSaveName = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === profile.displayName) return
    setSavingName(true)
    setError('')
    setNameSaved(false)
    try {
      await updateDisplayName(trimmed)
      setProfile(p => ({ ...p, displayName: trimmed }))
      setNameSaved(true)
    } catch (err) {
      setError(err.data?.error || err.message || 'Не удалось сохранить имя')
    } finally {
      setSavingName(false)
    }
  }

  const initials = profile.displayName.slice(0, 2).toUpperCase()

  return (
    <Modal title="Настройки" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <div
              onClick={handleAvatarClick}
              style={{
                width: '76px', height: '76px', borderRadius: '50%', cursor: 'pointer',
                background: avatarBlobUrl ? `center/cover url(${avatarBlobUrl})` : color.bg,
                color: color.fg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px', fontWeight: 700, overflow: 'hidden',
              }}
            >
              {!avatarBlobUrl && initials}
            </div>
            <button
              onClick={handleAvatarClick}
              style={{
                position: 'absolute', bottom: 0, right: 0, width: '26px', height: '26px', borderRadius: '50%',
                background: 'var(--accent-teal)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid var(--bg-surface)',
              }}
            >
              {uploadingAvatar ? <IconLoader2 size={13} className="spin" /> : <IconCamera size={13} strokeWidth={2.2} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Имя
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setNameSaved(false) }}
              style={{ flex: 1, fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', outline: 'none' }}
            />
            <button
              onClick={handleSaveName}
              disabled={savingName || !name.trim() || name.trim() === profile.displayName}
              style={{
                padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600,
                background: name.trim() && name.trim() !== profile.displayName ? 'var(--accent-teal)' : 'var(--bg-card)',
                color: name.trim() && name.trim() !== profile.displayName ? '#000' : 'var(--text-muted)',
              }}
            >
              {savingName ? '...' : 'Сохранить'}
            </button>
          </div>
          {nameSaved && <div style={{ fontSize: '11px', color: 'var(--accent-teal)', marginTop: '4px' }}>Сохранено</div>}
        </div>

        <Field label="Matrix ID" value={userId} />
        <Field label="Сервер" value={homeserver} />
        <Field label="Устройство" value={deviceId} />

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}
