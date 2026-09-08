import { IconShare, IconSquarePlus, IconCircleCheck } from '@tabler/icons-react'
import Modal from './Modals/Modal'

export default function InstallPrompt({ onClose }) {
  return (
    <Modal title="Установите приложение" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          В обычной вкладке Safari уведомления не работают — это ограничение iOS.
          Добавьте qts.dev на экран «Домой» — он откроется как настоящее приложение,
          со своей иконкой и рабочими push-уведомлениями.
        </div>

        <Step icon={IconShare} n={1}>
          Нажмите значок <b>«Поделиться»</b> внизу экрана Safari
        </Step>
        <Step icon={IconSquarePlus} n={2}>
          Прокрутите вниз и выберите <b>«На экран «Домой»»</b>
        </Step>
        <Step icon={IconCircleCheck} n={3}>
          Нажмите <b>«Добавить»</b> и открывайте qts.dev с новой иконки
        </Step>
      </div>
    </Modal>
  )
}

function Step({ icon: Icon, n, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', fontWeight: 700, color: 'var(--accent-teal)',
      }}>
        {n}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
        <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span>{children}</span>
      </div>
    </div>
  )
}
