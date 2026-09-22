import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { IconCheck } from '@tabler/icons-react'

function MenuItem({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%',
        padding: '9px 14px', textAlign: 'left', fontSize: '13px', color: 'var(--text-primary)', background: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {children}
    </button>
  )
}

export default function ChatItemContextMenu({ room, folders, pinnedInActive, position, onClose, onTogglePin, onToggleFolder, onCreateFolder }) {
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
    document.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const run = (fn) => { fn(); onClose() }
  const realFolders = folders.filter(f => f.id !== 'all')

  return (
    <div
      ref={ref}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed', zIndex: 200, ...style,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: '200px', padding: '4px', overflow: 'hidden',
      }}
    >
      <MenuItem onClick={() => run(onTogglePin)}>
        <span>{pinnedInActive ? 'Открепить' : 'Закрепить'}</span>
      </MenuItem>
      {realFolders.length > 0 && <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />}
      {realFolders.map(folder => {
        const inFolder = folder.roomIds?.includes(room.roomId)
        return (
          <MenuItem key={folder.id} onClick={() => run(() => onToggleFolder(folder.id, !inFolder))}>
            <span>{folder.name}</span>
            {inFolder && <IconCheck size={14} color="var(--accent-teal)" />}
          </MenuItem>
        )
      })}
      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
      <MenuItem onClick={() => run(onCreateFolder)}>
        <span>Создать папку...</span>
      </MenuItem>
    </div>
  )
}
