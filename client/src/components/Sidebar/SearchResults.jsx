import { useState, useEffect, useRef } from 'react'
import ChatItem from './ChatItem'
import { formatChatTime } from '../../lib/formatTime'
import { isDirectRoom, searchMessages } from '../../lib/matrix'

function buildChatMatches(client, query) {
  const me = client.getUserId()
  const q = query.trim().toLowerCase()
  if (!q) return []
  const matches = []
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== 'join') continue
    const isDM = isDirectRoom(client, room.roomId)
    const other = isDM ? room.getJoinedMembers().find(m => m.userId !== me) : null
    const name = isDM ? (other?.name || room.name) : room.name
    if (!name.toLowerCase().includes(q)) continue
    matches.push({ room, type: isDM ? 'dm' : 'channel', name })
  }
  return matches
}

function SectionLabel({ label }) {
  return (
    <div style={{ padding: '12px 10px 4px' }}>
      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', userSelect: 'none' }}>
        {label}
      </span>
    </div>
  )
}

export default function SearchResults({ client, query, onRoomSelect }) {
  const chatMatches = buildChatMatches(client, query)

  const [messageResults, setMessageResults] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageError, setMessageError] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    const term = query.trim()
    if (!term) {
      setMessageResults([])
      setMessageError('')
      setLoadingMessages(false)
      return
    }
    // Set immediately (not inside the debounced callback below) so the
    // "Ничего не найдено" empty state never flashes during the debounce
    // window before a search has actually run.
    setLoadingMessages(true)
    let cancelled = false
    debounceRef.current = setTimeout(async () => {
      setMessageError('')
      try {
        const results = await searchMessages(term)
        if (!cancelled) setMessageResults(results)
      } catch (err) {
        if (!cancelled) {
          setMessageResults([])
          setMessageError(err.data?.error || err.message || 'Поиск сообщений недоступен')
        }
      } finally {
        if (!cancelled) setLoadingMessages(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(debounceRef.current) }
  }, [client, query])

  const showMessagesSection = loadingMessages || !!messageError || messageResults.length > 0
  const nothingFound = chatMatches.length === 0 && !showMessagesSection

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
      {chatMatches.length > 0 && (
        <>
          <SectionLabel label="ЧАТЫ" />
          {chatMatches.map(({ room, type, name }) => (
            <ChatItem
              key={room.roomId}
              item={{ id: room.roomId, name, avatar: name.slice(0, 2).toUpperCase() }}
              type={type}
              isActive={false}
              onSelect={() => onRoomSelect(room)}
            />
          ))}
        </>
      )}

      {showMessagesSection && (
        <>
          <SectionLabel label="СООБЩЕНИЯ" />
          {loadingMessages && (
            <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '12px' }}>Поиск...</div>
          )}
          {!loadingMessages && messageError && (
            <div style={{ padding: '10px 14px', color: '#ff4d4d', fontSize: '12px' }}>{messageError}</div>
          )}
          {!loadingMessages && !messageError && messageResults.map(result => (
            <div
              key={result.id}
              onClick={() => {
                const room = client.getRoom(result.roomId)
                if (room) onRoomSelect(room, { jumpToEventId: result.id })
              }}
              style={{ padding: '8px 14px', margin: '1px 6px', borderRadius: '8px', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {result.senderName}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {formatChatTime(result.ts)}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {result.body}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {result.roomName}
              </div>
            </div>
          ))}
        </>
      )}

      {nothingFound && (
        <div style={{ padding: '24px 14px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
          Ничего не найдено
        </div>
      )}
    </div>
  )
}
