import { IconDownload } from '@tabler/icons-react'

const EXT_COLOR = {
  pdf:  '#ff5252',
  fig:  '#00E5B0',
  doc:  '#4285f4',
  docx: '#4285f4',
  xls:  '#34a853',
  xlsx: '#34a853',
  zip:  '#ff9800',
  png:  '#ab47bc',
  jpg:  '#ab47bc',
}

export default function MessageBubble({ message }) {
  if (message.type === 'date') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 16px 8px' }}>
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {message.date}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
      </div>
    )
  }

  if (message.type === 'system') {
    return (
      <div style={{ textAlign: 'center', padding: '3px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
        {message.text}
      </div>
    )
  }

  const { isOwn, sender, avatar, time, text, file, reactions, readBy } = message

  return (
    <div style={{
      display: 'flex',
      flexDirection: isOwn ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: '8px',
      padding: '2px 16px',
    }}>
      {/* Avatar (others only) */}
      {!isOwn && (
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          flexShrink: 0,
          marginBottom: reactions ? '22px' : '0',
        }}>
          {avatar}
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: '65%', minWidth: 0 }}>
        {/* Sender name */}
        {!isOwn && (
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--accent-teal)',
            marginBottom: '3px',
            paddingLeft: '1px',
          }}>
            {sender}
          </div>
        )}

        {/* Bubble */}
        <div style={{
          background: isOwn ? '#0d3326' : 'var(--bg-card)',
          border: '1px solid ' + (isOwn ? '#1c4535' : 'var(--border)'),
          borderRadius: isOwn ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
          padding: '8px 12px',
        }}>
          {text && (
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: '1.5', margin: 0 }}>
              {text}
            </p>
          )}

          {file && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              paddingTop: text ? '8px' : '0',
            }}>
              {/* File icon */}
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: (EXT_COLOR[file.ext] || '#888') + '18',
                border: '1px solid ' + (EXT_COLOR[file.ext] || '#888') + '40',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: EXT_COLOR[file.ext] || '#888',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}>
                  {file.ext || 'file'}
                </span>
              </div>

              {/* File info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {file.name}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {file.size}
                </div>
              </div>

              {/* Download */}
              <button
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <IconDownload size={15} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        {/* Footer: reactions + time + read receipts */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '5px',
          marginTop: '3px',
          justifyContent: isOwn ? 'flex-end' : 'flex-start',
        }}>
          {reactions?.map((r, i) => (
            <span
              key={i}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '2px 7px',
                fontSize: '12px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              {r.emoji}{' '}
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{r.count}</span>
            </span>
          ))}

          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{time}</span>

          {isOwn && readBy != null && (
            <span style={{
              fontSize: '13px',
              color: readBy > 0 ? 'var(--accent-teal)' : 'var(--text-muted)',
              letterSpacing: '-3px',
              lineHeight: 1,
            }}>
              ✓✓
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
