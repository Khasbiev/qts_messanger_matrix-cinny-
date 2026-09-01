import { useState } from 'react'
import { IconEye, IconEyeOff, IconLogin } from '@tabler/icons-react'
import { login, startSync } from '../../lib/matrix'

export default function LoginScreen({ onLogin }) {
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    homeserver: 'https://matrix.messanger.qts.dev',
    username: '',
    password: '',
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const client = await login(form.homeserver, form.username, form.password)
      await startSync(client)
      onLogin(client)
    } catch (err) {
      setError(err.data?.error || err.message || 'Ошибка подключения')
      setLoading(false)
    }
  }

  const set = (key) => (val) => setForm(f => ({ ...f, [key]: val }))
  const canSubmit = !loading && form.username.trim() && form.password

  return (
    <div style={{
      height: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '380px',
        padding: '40px',
        background: 'var(--bg-surface)',
        borderRadius: '16px',
        border: '1px solid var(--border)',
      }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px', marginBottom: '4px' }}>
            <span style={{ color: 'var(--accent-teal)' }}>{'>'}</span>
            <span style={{ color: 'var(--text-primary)' }}>qts.dev</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>MESSENGER</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Сервер" value={form.homeserver} onChange={set('homeserver')} placeholder="https://matrix.example.com" />
          <Field label="Имя пользователя" value={form.username} onChange={set('username')} placeholder="имя_пользователя" autoComplete="username" />
          <Field
            label="Пароль"
            value={form.password}
            onChange={set('password')}
            type={showPass ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="current-password"
            suffix={
              <button type="button" onClick={() => setShowPass(s => !s)}
                style={{ color: 'var(--text-muted)', display: 'flex', padding: '0 2px' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                {showPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            }
          />

          {error && (
            <div style={{ fontSize: '12px', color: '#ff4d4d', padding: '8px 12px', background: 'rgba(255,77,77,0.08)', borderRadius: '6px', border: '1px solid rgba(255,77,77,0.2)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              marginTop: '8px',
              height: '42px',
              background: canSubmit ? 'var(--accent-teal)' : 'var(--bg-card)',
              color: canSubmit ? '#000' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '14px',
              borderRadius: '8px',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.opacity = '0.88' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            <IconLogin size={17} />
            {loading ? 'Подключение...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, suffix, autoComplete }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</div>
      <div
        style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '0 12px', height: '40px', transition: 'border-color 0.15s' }}
        onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px' }}
        />
        {suffix}
      </div>
    </div>
  )
}
