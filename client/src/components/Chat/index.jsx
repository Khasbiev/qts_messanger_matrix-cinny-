import { useState } from 'react'
import Header from './Header'
import MessageList from './MessageList'
import InputArea from './InputArea'
import { uploadFile } from '../../lib/matrix'

export default function Chat({ client, room, navMode, onNav, onLeave, jumpToEventId }) {
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setUploadError('')
    let failed = 0
    for (let i = 0; i < files.length; i++) {
      setUploading({ current: i + 1, total: files.length })
      try {
        await uploadFile(room.roomId, files[i])
      } catch (err) {
        console.error('Upload failed:', err)
        failed++
      }
    }
    setUploading(false)
    if (failed > 0) {
      setUploadError(
        files.length === 1
          ? 'Не удалось загрузить файл'
          : `Не удалось загрузить ${failed} из ${files.length} файлов`
      )
    }
  }

  const handleEdit = (msg) => {
    setReplyingTo(null)
    setEditingMessage(msg)
  }

  const handleReply = (msg) => {
    setEditingMessage(null)
    setReplyingTo(msg)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-primary)',
      minWidth: 0,
    }}>
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
      />
    </div>
  )
}
