import { useState, useRef, useEffect } from 'react'
import {
  IconPaperclip, IconMoodSmile, IconSend,
  IconMicrophone, IconVideo, IconTrash, IconX,
} from '@tabler/icons-react'
import { sendMessage, uploadFile, uploadVoiceMessage, uploadVideoNote, editMessage, sendReply } from '../../lib/matrix'
import { startRecording } from '../../lib/mediaRecorder'
import EmojiPicker from './EmojiPicker'
import MentionAutocomplete from './MentionAutocomplete'

const MAX_MENTION_SUGGESTIONS = 8

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function InputArea({ client, room, editingMessage, onCancelEdit, replyingTo, onCancelReply }) {
  const [value, setValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [recording, setRecording] = useState(null) // { kind, controller, startedAt }
  const [now, setNow] = useState(0)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const videoPreviewRef = useRef(null)
  const isTypingRef = useRef(false)
  const typingTimeoutRef = useRef(null)
  const lastTypingSentAtRef = useRef(0)

  const placeholder = `Написать в ${room.name}...`
  const canSend = value.trim().length > 0

  useEffect(() => {
    if (!recording) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [recording])

  useEffect(() => {
    if (recording?.kind === 'video' && videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = recording.controller.stream
    }
  }, [recording])

  // A mount-once effect's cleanup only ever sees the `recording` value from
  // its first render (stale closure) — so track the live value in a ref and
  // read that at unmount time instead. This is what actually releases the
  // mic/camera (getUserMedia stream) if the component unmounts mid-recording
  // — e.g. Chat now remounts on every room switch (see App.jsx), or the user
  // navigates back on a narrow screen, or logs out.
  const recordingRef = useRef(null)
  useEffect(() => {
    recordingRef.current = recording
  }, [recording])
  useEffect(() => {
    return () => {
      recordingRef.current?.controller.cancel()
    }
  }, [])

  const wasEditingRef = useRef(false)
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.text || '')
      wasEditingRef.current = true
      textareaRef.current?.focus()
    } else if (wasEditingRef.current) {
      setValue('')
      wasEditingRef.current = false
    }
  }, [editingMessage])

  const draftTimeoutRef = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`qts_draft_${room.roomId}`)
      setValue(saved || '')
    } catch (err) {
      console.error('Draft load failed:', err)
    }
  }, [room])

  const saveDraft = (text) => {
    clearTimeout(draftTimeoutRef.current)
    draftTimeoutRef.current = setTimeout(() => {
      try {
        const key = `qts_draft_${room.roomId}`
        if (text.trim()) localStorage.setItem(key, text)
        else localStorage.removeItem(key)
      } catch (err) {
        console.error('Draft save failed:', err)
      }
    }, 400)
  }

  const clearDraft = () => {
    clearTimeout(draftTimeoutRef.current)
    try {
      localStorage.removeItem(`qts_draft_${room.roomId}`)
    } catch (err) {
      console.error('Draft clear failed:', err)
    }
  }

  const notifyTyping = () => {
    if (!isTypingRef.current || Date.now() - lastTypingSentAtRef.current > 8000) {
      isTypingRef.current = true
      lastTypingSentAtRef.current = Date.now()
      client.sendTyping(room.roomId, true, 20000).catch(err => console.error('Typing indicator failed:', err))
    }
    clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false
      client.sendTyping(room.roomId, false, 10000).catch(err => console.error('Typing indicator failed:', err))
    }, 4000)
  }

  const stopTyping = () => {
    clearTimeout(typingTimeoutRef.current)
    lastTypingSentAtRef.current = 0
    if (isTypingRef.current) {
      isTypingRef.current = false
      client.sendTyping(room.roomId, false, 10000).catch(err => console.error('Typing indicator failed:', err))
    }
  }

  useEffect(() => {
    return () => stopTyping()
  }, [room])

  const handleKeyDown = (e) => {
    if (mentionQuery != null && mentionMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % mentionMembers.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + mentionMembers.length) % mentionMembers.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionMembers[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    const text = value.trim()
    if (!text) return
    const isPlainSend = !editingMessage && !replyingTo
    setValue('')
    stopTyping()
    if (isPlainSend) clearDraft()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    try {
      if (editingMessage) {
        await editMessage(room.roomId, editingMessage.id, text)
        onCancelEdit()
      } else if (replyingTo) {
        await sendReply(room.roomId, text, replyingTo)
        onCancelReply()
      } else {
        await sendMessage(room.roomId, text)
      }
    } catch (err) {
      console.error('Send failed:', err)
    }
  }

  const handleInput = (e) => {
    const val = e.target.value
    setValue(val)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    if (val.trim()) {
      notifyTyping()
    } else {
      stopTyping()
    }
    if (!editingMessage && !replyingTo) {
      saveDraft(val)
    }

    const uptoCaret = val.slice(0, e.target.selectionStart)
    const match = uptoCaret.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionStart(e.target.selectionStart - match[1].length - 1)
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  const mentionMembers = mentionQuery == null ? [] : room.getJoinedMembers()
    .filter(m => m.userId !== client.getUserId() && m.name)
    .filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, MAX_MENTION_SUGGESTIONS)

  const selectMention = (member) => {
    const caret = textareaRef.current?.selectionStart ?? value.length
    const before = value.slice(0, mentionStart)
    const after = value.slice(caret)
    const insertion = `@${member.name} `
    const newValue = before + insertion + after
    setValue(newValue)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  const insertEmoji = (emoji) => {
    setValue(v => v + emoji)
    textareaRef.current?.focus()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      await uploadFile(room.roomId, file)
    } catch (err) {
      setUploadError(err.data?.error || err.message || 'Не удалось загрузить файл')
    } finally {
      setUploading(false)
    }
  }

  const handleStartRecording = async (kind) => {
    setUploadError('')
    try {
      const controller = await startRecording(kind)
      setRecording({ kind, controller, startedAt: Date.now() })
      setNow(Date.now())
    } catch {
      setUploadError(kind === 'video' ? 'Нет доступа к камере' : 'Нет доступа к микрофону')
    }
  }

  const handleCancelRecording = () => {
    recording?.controller.cancel()
    setRecording(null)
  }

  const handleSendRecording = async () => {
    if (!recording) return
    const { kind, controller, startedAt } = recording
    const durationMs = Date.now() - startedAt
    setRecording(null)
    if (durationMs < 500) return // too short to be intentional
    setUploading(true)
    try {
      const blob = await controller.stop()
      if (kind === 'voice') await uploadVoiceMessage(room.roomId, blob, durationMs)
      else await uploadVideoNote(room.roomId, blob, durationMs)
    } catch (err) {
      setUploadError(err.data?.error || err.message || 'Не удалось отправить запись')
    } finally {
      setUploading(false)
    }
  }

  const elapsedMs = recording ? now - recording.startedAt : 0

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0, position: 'relative' }}>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />

      {showEmoji && <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />}

      {mentionQuery != null && mentionMembers.length > 0 && (
        <MentionAutocomplete
          members={mentionMembers}
          selectedIndex={mentionIndex}
          onSelect={selectMention}
          onHover={setMentionIndex}
        />
      )}

      {(editingMessage || replyingTo) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', marginBottom: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', borderLeft: '3px solid var(--accent-teal)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingMessage ? (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Редактирование сообщения</div>
            ) : (
              <>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-teal)' }}>Ответ {replyingTo.sender}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {replyingTo.text || 'Медиа-сообщение'}
                </div>
              </>
            )}
          </div>
          <button onClick={editingMessage ? onCancelEdit : onCancelReply} style={{ color: 'var(--text-muted)', display: 'flex' }}>
            <IconX size={14} />
          </button>
        </div>
      )}

      <div
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '24px', overflow: 'hidden', transition: 'border-color 0.15s' }}
        onFocusCapture={e => e.currentTarget.style.borderColor = '#2a2a2c'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        {recording ? (
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', gap: '10px', height: '40px' }}>
            <RoundIconButton onClick={handleCancelRecording} title="Отменить">
              <IconTrash size={17} strokeWidth={2} color="#ff6b6b" />
            </RoundIconButton>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff4d4d', flexShrink: 0, animation: 'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatTimer(elapsedMs)}</span>
              {recording.kind === 'video' && (
                <video ref={videoPreviewRef} autoPlay muted playsInline style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', marginLeft: '4px' }} />
              )}
            </div>

            <RoundIconButton onClick={handleSendRecording} title="Отправить" accent>
              <IconSend size={16} strokeWidth={2.2} color="#000" />
            </RoundIconButton>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', padding: '6px 8px', gap: '4px' }}>
            <RoundIconButton onClick={() => fileInputRef.current?.click()} title="Прикрепить файл">
              <IconPaperclip size={18} strokeWidth={1.8} />
            </RoundIconButton>

            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5', overflowY: 'hidden', minHeight: '22px', maxHeight: '120px', padding: '8px 4px' }}
            />

            <RoundIconButton onClick={() => setShowEmoji(v => !v)} title="Эмодзи">
              <IconMoodSmile size={18} strokeWidth={1.8} />
            </RoundIconButton>

            {canSend ? (
              <RoundIconButton onClick={handleSend} title="Отправить" accent>
                <IconSend size={16} strokeWidth={2.2} color="#000" />
              </RoundIconButton>
            ) : (
              <>
                <RoundIconButton onClick={() => handleStartRecording('video')} title="Видеосообщение">
                  <IconVideo size={18} strokeWidth={1.8} />
                </RoundIconButton>
                <RoundIconButton onClick={() => handleStartRecording('voice')} title="Голосовое сообщение">
                  <IconMicrophone size={18} strokeWidth={1.8} />
                </RoundIconButton>
              </>
            )}
          </div>
        )}
      </div>

      {(uploadError || uploading) && (
        <div style={{ fontSize: '11px', color: uploadError ? '#ff4d4d' : 'var(--text-muted)', padding: '4px 2px 0', textAlign: 'right' }}>
          {uploadError || 'Загрузка...'}
        </div>
      )}

      <style>{'@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }'}</style>
    </div>
  )
}

function RoundIconButton({ onClick, title, children, accent }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: accent ? 'var(--accent-teal)' : 'transparent',
        color: accent ? '#000' : 'var(--text-muted)',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => { if (!accent) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--text-primary)' } else { e.currentTarget.style.opacity = '0.85' } }}
      onMouseLeave={e => { if (!accent) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } else { e.currentTarget.style.opacity = '1' } }}
    >
      {children}
    </button>
  )
}
