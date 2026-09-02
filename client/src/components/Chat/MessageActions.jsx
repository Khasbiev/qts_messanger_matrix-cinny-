import { useState } from 'react'
import { IconMoodSmile } from '@tabler/icons-react'
import EmojiPicker from './EmojiPicker'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']

function ActionButton({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: '26px', height: '26px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </button>
  )
}

export default function MessageActions({ message, onReact, onReply, onEdit, onDeleteClick }) {
  const [quickOpen, setQuickOpen] = useState(false)
  const [fullPickerOpen, setFullPickerOpen] = useState(false)

  const pick = (emoji) => {
    onReact(emoji)
    setQuickOpen(false)
    setFullPickerOpen(false)
  }

  return (
    <div style={{ position: 'absolute', top: '-16px', right: '8px', zIndex: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '3px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <ActionButton onClick={() => setQuickOpen(v => !v)} title="Реакция">
          <IconMoodSmile size={15} strokeWidth={1.8} />
        </ActionButton>
        {onReply && (
          <ActionButton onClick={onReply} title="Ответить">↩</ActionButton>
        )}
        {onEdit && (
          <ActionButton onClick={onEdit} title="Редактировать">✎</ActionButton>
        )}
        {onDeleteClick && (
          <ActionButton onClick={onDeleteClick} title="Удалить">🗑</ActionButton>
        )}
      </div>

      {quickOpen && (
        <div style={{
          position: 'absolute', top: '32px', right: '0', zIndex: 11,
          display: 'flex', alignItems: 'center', gap: '2px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {QUICK_REACTIONS.map(e => (
            <button
              key={e}
              onClick={() => pick(e)}
              style={{ width: '28px', height: '28px', borderRadius: '6px', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              onMouseLeave={ev => ev.currentTarget.style.background = 'none'}
            >
              {e}
            </button>
          ))}
          <button
            onClick={() => { setQuickOpen(false); setFullPickerOpen(true) }}
            title="Больше эмодзи"
            style={{ width: '28px', height: '28px', borderRadius: '6px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            …
          </button>
        </div>
      )}

      {fullPickerOpen && (
        <EmojiPicker
          onPick={pick}
          onClose={() => setFullPickerOpen(false)}
          style={{ top: '32px', bottom: 'auto', right: '0' }}
        />
      )}
    </div>
  )
}
