import { useEffect, useRef } from 'react'

const EMOJI = [
  '😀', '😂', '😅', '😉', '😊', '😍', '🤔', '😎', '😢', '😭',
  '😡', '👍', '👎', '🙏', '👏', '🔥', '🎉', '❤️', '💯', '✅',
  '❌', '⚡', '👋', '🤝', '🙌', '😴', '🤯', '🥳', '😱', '🚀',
]

export default function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null)

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

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: '54px',
        right: '0',
        width: '236px',
        zIndex: 200,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        padding: '8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '2px',
      }}
    >
      {EMOJI.map(e => (
        <button
          key={e}
          onClick={() => { onPick(e); onClose() }}
          style={{ width: '34px', height: '34px', borderRadius: '6px', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
          onMouseLeave={ev => ev.currentTarget.style.background = 'none'}
        >
          {e}
        </button>
      ))}
    </div>
  )
}
