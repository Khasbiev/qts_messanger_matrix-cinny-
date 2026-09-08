import useResolvedMedia from '../lib/useResolvedMedia'

// Resolves an mxc:// avatar to a real image (authenticated fetch -> blob
// URL, same as Settings/ChatInfoModal already did for the user's own
// avatar), falling back to colored initials while loading, with none set,
// or if the fetch fails.
export default function Avatar({ mxcUrl, label, size = 36, bg, fg, style }) {
  const blobUrl = useResolvedMedia(mxcUrl)

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: blobUrl ? `center/cover url(${blobUrl})` : bg,
      color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.36), fontWeight: 600, overflow: 'hidden',
      ...style,
    }}>
      {!blobUrl && label}
    </div>
  )
}
