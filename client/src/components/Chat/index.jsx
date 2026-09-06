import { useState, useRef, useEffect } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'
import { uploadFile } from '../../lib/matrix'

export default function Chat({ client, room, navMode, onNav, onLeave, jumpToEventId }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const dragCounterRef = useRef(0)

  const uploadChainRef = useRef(Promise.resolve())

  const runUploadBatch = async (files) => {
    setUploadError('')
    let failed = 0
    let lastErrorMessage = ''
    for (let i = 0; i < files.length; i++) {
      setUploading({ current: i + 1, total: files.length })
      try {
        await uploadFile(room.roomId, files[i])
      } catch (err) {
        console.error('Upload failed:', err)
        failed++
        lastErrorMessage = err.data?.error || err.message || ''
      }
    }
    setUploading(false)
    if (failed > 0) {
      setUploadError(
        files.length === 1
          ? (lastErrorMessage || 'Не удалось загрузить файл')
          : `Не удалось загрузить ${failed} из ${files.length} файлов`
      )
    }
  }

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    uploadChainRef.current = uploadChainRef.current.then(() => runUploadBatch(files))
  }

  const handleEdit = (msg) => {
    setReplyingTo(null)
    setEditingMessage(msg)
  }

  const handleReply = (msg) => {
    setEditingMessage(null)
    setReplyingTo(msg)
  }

  const handleDragEnter = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current++
    setDragActive(true)
  }
  const handleDragOver = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
  }
  const handleDragLeave = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setDragActive(false)
    }
  }
  const handleDrop = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = 0
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  useEffect(() => {
    const resetDragState = () => {
      dragCounterRef.current = 0
      setDragActive(false)
    }
    window.addEventListener('drop', resetDragState)
    window.addEventListener('dragend', resetDragState)
    return () => {
      window.removeEventListener('drop', resetDragState)
      window.removeEventListener('dragend', resetDragState)
    }
  }, [])

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-primary)',
        minWidth: 0,
        position: 'relative',
      }}>
      {dragActive && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0, 229, 176, 0.08)',
          border: '2px dashed var(--accent-teal)', borderRadius: '8px',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--accent-teal)' }}>
            Отпустите файлы, чтобы отправить
          </span>
        </div>
      )}
      <Header client={client} room={room} navMode={navMode} onNav={onNav} onLeave={onLeave} />
      <MessageList client={client} room={room} onEdit={handleEdit} onReply={handleReply} jumpToEventId={jumpToEventId} />
      <InputArea
        client={client}
        room={room}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onFiles={handleFiles}
        uploading={uploading}
        uploadError={uploadError}
        onDismissUploadError={() => setUploadError('')}
      />
    </div>
  )
}
