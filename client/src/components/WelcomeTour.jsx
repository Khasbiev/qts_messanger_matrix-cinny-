import { useState } from 'react'
import { IconX } from '@tabler/icons-react'

const STEPS = [
  {
    img: '/onboarding/1-chats.png',
    title: 'Все чаты в одном месте',
    text: 'Каналы и личные сообщения, быстрый поиск по номеру или юзернейму.',
  },
  {
    img: '/onboarding/2-messages.png',
    title: 'Общайтесь как привыкли',
    text: 'Реакции, ответы, пересылка и редактирование — зажмите сообщение, чтобы увидеть все действия.',
  },
  {
    img: '/onboarding/3-video-note.png',
    title: 'Голосовые и видео-кружочки',
    text: 'Как в Telegram — запишите короткое видео или голосовое прямо из чата.',
  },
  {
    img: '/onboarding/4-settings.png',
    title: 'Настройте под себя',
    text: 'Тёмная или светлая тема, юзернейм для поиска, push-уведомления — всё в Настройках.',
  },
]

export default function WelcomeTour({ onClose }) {
  const [step, setStep] = useState(0)
  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '340px', maxWidth: '100%', background: 'var(--bg-surface)',
          border: '1px solid var(--border)', borderRadius: '16px',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ position: 'relative', background: 'var(--bg-primary)' }}>
          <img
            src={current.img}
            alt=""
            style={{ width: '100%', display: 'block', maxHeight: '340px', objectFit: 'cover', objectPosition: 'top' }}
          />
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: '10px', right: '10px', width: '28px', height: '28px',
              borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <IconX size={15} />
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
            {current.title}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '18px' }}>
            {current.text}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '18px' }}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{ width: '6px', height: '6px', borderRadius: '50%', background: i === step ? 'var(--accent-teal)' : 'var(--border)' }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {!isLast && (
              <button
                onClick={onClose}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              >
                Пропустить
              </button>
            )}
            <button
              onClick={() => (isLast ? onClose() : setStep(s => s + 1))}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, color: '#000', background: 'var(--accent-teal)' }}
            >
              {isLast ? 'Начать' : 'Далее'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
