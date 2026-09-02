function pickMimeType(kind) {
  const candidates = kind === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type
  }
  return ''
}

export async function startRecording(kind) {
  const constraints = kind === 'video'
    ? { audio: true, video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' } }
    : { audio: true }
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  const mimeType = pickMimeType(kind)
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start()

  const stopTracks = () => stream.getTracks().forEach(t => t.stop())

  return {
    stream,
    stop: () => new Promise(resolve => {
      recorder.onstop = () => {
        stopTracks()
        resolve(new Blob(chunks, { type: mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm') }))
      }
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve(new Blob(chunks, { type: mimeType }))
    }),
    cancel: () => {
      recorder.onstop = null
      try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* already stopped */ }
      stopTracks()
    },
  }
}
