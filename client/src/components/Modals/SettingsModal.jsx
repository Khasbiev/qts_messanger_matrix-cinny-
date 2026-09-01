import Modal from './Modal'

export default function SettingsModal({ client, onClose }) {
  const userId = client?.getUserId() || ''
  const homeserver = client?.getHomeserverUrl?.() || ''
  const deviceId = client?.getDeviceId?.() || ''

  return (
    <Modal title="Настройки" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Field label="Matrix ID" value={userId} />
        <Field label="Сервер" value={homeserver} />
        <Field label="Устройство" value={deviceId} />
      </div>
    </Modal>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}
