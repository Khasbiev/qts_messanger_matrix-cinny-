import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { QUICK_REACTIONS } from './MessageActions'

function MenuItem({ onClick, children, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '9px 14px', textAlign: 'left', fontSize: '13px',
        color: danger ? '#ff6b6b' : 'var(--text-primary)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {children}
    </button>
  )
}

export default function MessageContextMenu({ position, onClose, onReact, onReply, onForward, onCopy, onEdit, onDeleteClick }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ top: position.y, left: position.x, visibility: 'hidden' })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    setStyle({ top, left, visibility: 'visible' })
  }, [position])

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const run = (fn) => { fn(); onClose() }

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', zIndex: 200, ...style,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: '180px', padding: '4px', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 4px 8px' }}>
        {QUICK_REACTIONS.map(e => (
          <button
            key={e}
            onClick={() => run(() => onReact(e))}
            style={{ width: '30px', height: '30px', borderRadius: '6px', fontSize: '17px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
            onMouseLeave={ev => { ev.currentTarget.style.background = 'none' }}
          >
            {e}
          </button>
        ))}
      </div>
      <MenuItem onClick={() => run(onReply)}>↩ Ответить</MenuItem>
      <MenuItem onClick={() => run(onForward)}>➦ Переслать</MenuItem>
      {onCopy && <MenuItem onClick={() => run(onCopy)}>📋 Копировать текст</MenuItem>}
      {onEdit && <MenuItem onClick={() => run(onEdit)}>✎ Редактировать</MenuItem>}
      {onDeleteClick && <MenuItem danger onClick={() => run(onDeleteClick)}>🗑 Удалить</MenuItem>}
    </div>
  )
}
