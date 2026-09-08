import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { IconArrowBackUp, IconArrowForward, IconCopy, IconPencil, IconTrash } from '@tabler/icons-react'
import { QUICK_REACTIONS } from './MessageActions'

function MenuItem({ icon: Icon, onClick, children, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '9px 14px', textAlign: 'left', fontSize: '13px',
        color: danger ? '#ff6b6b' : 'var(--text-primary)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--overlay)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      <Icon size={16} strokeWidth={1.8} style={{ flexShrink: 0 }} />
      {children}
    </button>
  )
}

export default function MessageContextMenu({ position, onClose, onReact, onReply, onForward, onCopy, onEdit, onDeleteClick }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ top: 0, left: 0, visibility: 'hidden' })

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
    document.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const run = (fn) => { fn(); onClose() }

  return (
    <div
      ref={ref}
      onContextMenu={e => e.preventDefault()}
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
            onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--overlay)' }}
            onMouseLeave={ev => { ev.currentTarget.style.background = 'none' }}
          >
            {e}
          </button>
        ))}
      </div>
      <MenuItem icon={IconArrowBackUp} onClick={() => run(onReply)}>Ответить</MenuItem>
      <MenuItem icon={IconArrowForward} onClick={() => run(onForward)}>Переслать</MenuItem>
      {onCopy && <MenuItem icon={IconCopy} onClick={() => run(onCopy)}>Копировать текст</MenuItem>}
      {onEdit && <MenuItem icon={IconPencil} onClick={() => run(onEdit)}>Редактировать</MenuItem>}
      {onDeleteClick && <MenuItem icon={IconTrash} danger onClick={() => run(onDeleteClick)}>Удалить</MenuItem>}
    </div>
  )
}
