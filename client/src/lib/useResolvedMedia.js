import { useState, useEffect } from 'react'
import { resolveMediaUrl } from './matrix'

export default function useResolvedMedia(mxcUrl) {
  const [blobUrl, setBlobUrl] = useState(null)
  useEffect(() => {
    if (!mxcUrl) { setBlobUrl(null); return }
    let cancelled = false
    let url = null
    resolveMediaUrl(mxcUrl).then(resolved => {
      if (cancelled) { URL.revokeObjectURL(resolved); return }
      url = resolved
      setBlobUrl(resolved)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [mxcUrl])
  return blobUrl
}
