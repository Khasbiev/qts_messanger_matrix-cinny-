import { useState, useEffect } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import { getLinkPreview } from '../../lib/matrix'
import useResolvedMedia from '../../lib/useResolvedMedia'

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export default function LinkPreview({ url, spaced }) {
  const [preview, setPreview] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setPreview(null)
    getLinkPreview(url).then(data => {
      if (!cancelled) { setPreview(data); setLoaded(true) }
    }).catch(() => {
      if (!cancelled) { setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [url])

  const title = preview?.['og:title']
  const description = preview?.['og:description']
  const imageMxc = preview?.['og:image']
  const blobUrl = useResolvedMedia(imageMxc)

  if (!loaded || (!title && !description && !imageMxc)) return null

  const siteName = preview['og:site_name'] || hostnameOf(url)

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', gap: '10px', textDecoration: 'none',
        border: '1px solid var(--border)', borderRadius: '10px',
        padding: '8px', background: 'rgba(255,255,255,0.02)',
        marginTop: spaced ? '8px' : '0',
      }}
    >
      {imageMxc && (
        <div style={{ width: '64px', height: '64px', flexShrink: 0, borderRadius: '6px', overflow: 'hidden', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {blobUrl
            ? <img src={blobUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <IconLoader2 size={16} className="spin" color="var(--text-muted)" />}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{siteName}</div>
        {title && (
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
        )}
        {description && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {description}
          </div>
        )}
      </div>
    </a>
  )
}
