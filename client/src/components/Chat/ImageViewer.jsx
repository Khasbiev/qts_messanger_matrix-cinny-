import { useEffect } from 'react'
import { IconX, IconDownload } from '@tabler/icons-react'
import { pushModal, popModal } from '../../lib/modalStack'

export default function ImageViewer({ src, name, onClose }) {
  useEffect(() => {
    pushModal()
    return () => popModal()
  }, [])

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleDownload = (e) => {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = src
    a.download = name || 'image'
    a.click()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 250,
        background: 'rgba(0,0,0,0.9)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '40px 20px',
      }}
    >
      <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', gap: '8px' }}>
        <button
          onClick={handleDownload}
          title="Скачать"
          style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <IconDownload size={18} />
        </button>
        <button
          onClick={onClose}
          title="Закрыть"
          style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <IconX size={18} />
        </button>
      </div>
      <img
        src={src}
        alt={name}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }}
      />
    </div>
  )
}
