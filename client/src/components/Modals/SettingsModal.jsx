import { useState, useEffect, useRef } from 'react'
import { IconCamera, IconLoader2, IconBell, IconBellOff, IconDeviceMobile, IconSun, IconMoon, IconSparkles } from '@tabler/icons-react'
import Modal from './Modal'
import InstallPrompt from '../InstallPrompt'
import WelcomeTour from '../WelcomeTour'
import { getOwnProfile, updateDisplayName, updateAvatar, resolveMediaUrl } from '../../lib/matrix'
import { colorFor } from '../../lib/avatarColor'
import { isPushSubscribed, enablePush, disablePush } from '../../lib/push'
import { getMyUsername, setMyUsername } from '../../lib/username'
import { needsIOSInstallPrompt } from '../../lib/platform'
import { getTheme, setTheme } from '../../lib/theme'

export default function SettingsModal({ client, onClose }) {
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [theme, setThemeField] = useState(getTheme)

  const handleSetTheme = (t) => {
    setTheme(t)
    setThemeField(t)
  }
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
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const fileInputRef = useRef(null)

  const [username, setUsernameField] = useState('')
  const [savedUsername, setSavedUsername] = useState(null)
  const [savingUsername, setSavingUsername] = useState(false)
  const [usernameSaved, setUsernameSaved] = useState(false)
  const [usernameError, setUsernameError] = useState('')

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

  useEffect(() => {
    isPushSubscribed().then(setPushSubscribed).catch(() => {})
  }, [])

  useEffect(() => {
    getMyUsername(client).then(u => { setSavedUsername(u); setUsernameField(u || '') }).catch(() => {})
  }, [client])

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

  const handleSaveUsername = async () => {
    const trimmed = username.trim()
    if (!trimmed || trimmed === savedUsername) return
    setSavingUsername(true)
    setUsernameError('')
    setUsernameSaved(false)
    try {
      const saved = await setMyUsername(client, trimmed)
      setSavedUsername(saved)
      setUsernameField(saved)
      setUsernameSaved(true)
    } catch (err) {
      setUsernameError(err.message || 'Не удалось сохранить юзернейм')
    } finally {
      setSavingUsername(false)
    }
  }

  const handleTogglePush = async () => {
    setPushBusy(true)
    setPushError('')
    try {
      if (pushSubscribed) {
        await disablePush(client)
        setPushSubscribed(false)
      } else {
        await enablePush(client)
        setPushSubscribed(true)
      }
    } catch (err) {
      setPushError(err.message || 'Не удалось изменить настройку уведомлений')
    } finally {
      setPushBusy(false)
    }
  }

  const initials = profile.displayName.slice(0, 2).toUpperCase()

  return (
    <>
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

        <div style={{ display: 'flex', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '3px' }}>
          <ThemeButton icon={IconMoon} label="Тёмная" active={theme === 'dark'} onClick={() => handleSetTheme('dark')} />
          <ThemeButton icon={IconSun} label="Светлая" active={theme === 'light'} onClick={() => handleSetTheme('light')} />
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

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Юзернейм
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '0 12px' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>@</span>
              <input
                value={username}
                onChange={e => { setUsernameField(e.target.value.replace(/\s/g, '')); setUsernameSaved(false); setUsernameError('') }}
                placeholder="не задан"
                style={{ flex: 1, fontSize: '14px', color: 'var(--text-primary)', background: 'none', border: 'none', outline: 'none', padding: '9px 0' }}
              />
            </div>
            <button
              onClick={handleSaveUsername}
              disabled={savingUsername || !username.trim() || username.trim() === savedUsername}
              style={{
                padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600,
                background: username.trim() && username.trim() !== savedUsername ? 'var(--accent-teal)' : 'var(--bg-card)',
                color: username.trim() && username.trim() !== savedUsername ? '#000' : 'var(--text-muted)',
              }}
            >
              {savingUsername ? '...' : 'Сохранить'}
            </button>
          </div>
          <div style={{ fontSize: '11px', color: usernameError ? '#ff4d4d' : 'var(--text-muted)', marginTop: '4px' }}>
            {usernameError || (usernameSaved ? 'Сохранено' : 'По нему тоже можно найти в поиске — не только по номеру')}
          </div>
        </div>

        <Field label="Matrix ID" value={userId} />
        <Field label="Сервер" value={homeserver} />
        <Field label="Устройство" value={deviceId} />

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Уведомления
          </div>
          <button
            onClick={handleTogglePush}
            disabled={pushBusy}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
              fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px',
            }}
          >
            {pushBusy ? <IconLoader2 size={16} className="spin" /> : (pushSubscribed ? <IconBell size={16} color="var(--accent-teal)" /> : <IconBellOff size={16} />)}
            {pushSubscribed ? 'Push-уведомления включены' : 'Включить push-уведомления'}
          </button>
          {pushError && <div style={{ fontSize: '11px', color: '#ff4d4d', marginTop: '4px' }}>{pushError}</div>}
        </div>

        {needsIOSInstallPrompt() && (
          <button
            onClick={() => setShowInstallHelp(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
              fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px',
            }}
          >
            <IconDeviceMobile size={16} />
            Как установить на iPhone
          </button>
        )}

        <button
          onClick={() => setShowTour(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
            fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px',
          }}
        >
          <IconSparkles size={16} />
          Как пользоваться мессенджером
        </button>

        {error && <div style={{ fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
      </div>
    </Modal>
    {showInstallHelp && <InstallPrompt onClose={() => setShowInstallHelp(false)} />}
    {showTour && <WelcomeTour onClose={() => setShowTour(false)} />}
    </>
  )
}

function ThemeButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        padding: '8px 0', borderRadius: '5px', fontSize: '13px', fontWeight: 600,
        background: active ? 'var(--accent-teal)' : 'transparent',
        color: active ? '#000' : 'var(--text-secondary)',
      }}
    >
      <Icon size={15} strokeWidth={2} />
      {label}
    </button>
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
