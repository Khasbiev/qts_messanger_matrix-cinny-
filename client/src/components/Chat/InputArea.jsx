import { useState, useRef } from 'react'
import {
  IconBold, IconItalic, IconList,
  IconPaperclip, IconMoodSmile, IconAt, IconSend,
} from '@tabler/icons-react'
import { sendMessage, uploadFile } from '../../lib/matrix'

export default function InputArea({ room }) {
  const [value, setValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  const placeholder = `Написать в ${room.name}...`

  const TOOLBAR = [
    { Icon: IconBold,      title: 'Жирный (Ctrl+B)' },
    { Icon: IconItalic,    title: 'Курсив (Ctrl+I)'  },
    { Icon: IconList,      title: 'Список'            },
    null,
    { Icon: IconPaperclip, title: 'Прикрепить файл', onClick: () => fileInputRef.current?.click() },
    { Icon: IconMoodSmile, title: 'Эмодзи'            },
    { Icon: IconAt,        title: 'Упомянуть'         },
  ]

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
      await sendMessage(room.roomId, text)
    } catch (err) {
      console.error('Send failed:', err)
    }
  }

  const handleInput = (e) => {
    setValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      await uploadFile(room.roomId, file)
    } catch (err) {
      setUploadError(err.data?.error || err.message || 'Не удалось загрузить файл')
    } finally {
      setUploading(false)
    }
  }

  const canSend = value.trim().length > 0

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
      <div
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.15s' }}
        onFocusCapture={e => e.currentTarget.style.borderColor = '#2a2a2c'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', gap: '2px', borderBottom: '1px solid var(--border)' }}>
          {TOOLBAR.map((btn, i) =>
            btn === null ? (
              <div key={i} style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
            ) : (
              <button
                key={i}
                title={btn.title}
                onClick={btn.onClick}
                style={{ width: '28px', height: '26px', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'all 0.1s', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <btn.Icon size={15} strokeWidth={2} />
              </button>
            )
          )}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '8px 10px', gap: '8px' }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5', overflowY: 'hidden', minHeight: '22px', maxHeight: '120px', paddingTop: '1px' }}
          />
          <button
            onClick={handleSend}
            style={{
              width: '34px', height: '34px', borderRadius: '8px',
              background: canSend ? 'var(--accent-teal)' : 'rgba(255,255,255,0.05)',
              border: '1px solid ' + (canSend ? 'transparent' : 'var(--border)'),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: canSend ? '#000' : 'var(--text-muted)',
              flexShrink: 0, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (canSend) e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            <IconSend size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: uploadError ? '#ff4d4d' : 'var(--text-muted)', padding: '4px 2px 0', textAlign: 'right' }}>
        {uploadError || (uploading ? 'Загрузка файла...' : 'Enter — отправить · Shift+Enter — новая строка')}
      </div>
    </div>
  )
}
