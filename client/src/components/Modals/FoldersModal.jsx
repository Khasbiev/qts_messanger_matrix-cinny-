import { useState } from 'react'
import { IconTrash, IconChevronUp, IconChevronDown, IconCheck } from '@tabler/icons-react'
import Modal from './Modal'
import { createFolder, renameFolder, deleteFolder, reorderFolders, isDirectRoom } from '../../lib/matrix'

export default function FoldersModal({ client, folders, seedRoomId, onClose, onChanged }) {
  const [view, setView] = useState(seedRoomId ? 'create' : 'list')
  const realFolders = folders.filter(f => f.id !== 'all')

  if (view === 'create') {
    return (
      <CreateFolderView
        client={client}
        seedRoomId={seedRoomId}
        onBack={seedRoomId ? undefined : () => setView('list')}
        onClose={onClose}
        onCreated={() => { onChanged(); onClose() }}
      />
    )
  }

  return (
    <FolderListView
      realFolders={realFolders}
      onClose={onClose}
      onChanged={onChanged}
      onCreateClick={() => setView('create')}
    />
  )
}

function FolderListView({ realFolders, onClose, onChanged, onCreateClick }) {
  const [error, setError] = useState('')

  const handleReorder = async (index, dir) => {
    const ids = realFolders.map(f => f.id)
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await reorderFolders(ids)
      onChanged()
    } catch (err) {
      setError(err.message || 'Не удалось изменить порядок')
    }
  }

  const handleRename = async (folderId, name) => {
    if (!name.trim()) return
    try {
      await renameFolder(folderId, name.trim())
      onChanged()
    } catch (err) {
      setError(err.message || 'Не удалось переименовать папку')
    }
  }

  const handleDelete = async (folderId) => {
    try {
      await deleteFolder(folderId)
      onChanged()
    } catch (err) {
      setError(err.message || 'Не удалось удалить папку')
    }
  }

  return (
    <Modal title="Папки" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {realFolders.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px' }}>Папок пока нет</div>
        )}
        {realFolders.map((folder, i) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            canUp={i > 0}
            canDown={i < realFolders.length - 1}
            onUp={() => handleReorder(i, -1)}
            onDown={() => handleReorder(i, 1)}
            onRename={name => handleRename(folder.id, name)}
            onDelete={() => handleDelete(folder.id)}
          />
        ))}
      </div>
      <button
        onClick={onCreateClick}
        style={{ marginTop: '12px', width: '100%', padding: '9px', borderRadius: '7px', background: 'var(--accent-teal)', color: '#000', fontSize: '13px', fontWeight: 600, border: 'none' }}
      >
        Создать папку
      </button>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}

function FolderRow({ folder, canUp, canDown, onUp, onDown, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const commit = () => { setEditing(false); onRename(name) }

  const handleConfirmDelete = () => { setConfirmOpen(false); onDelete() }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px' }}>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setName(folder.name); setEditing(false) }
          }}
          style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
        />
      ) : (
        <span onClick={() => setEditing(true)} style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', cursor: 'text' }}>{folder.name}</span>
      )}
      <button disabled={!canUp} onClick={onUp} style={{ color: canUp ? 'var(--text-secondary)' : 'var(--border)', display: 'flex' }}>
        <IconChevronUp size={15} />
      </button>
      <button disabled={!canDown} onClick={onDown} style={{ color: canDown ? 'var(--text-secondary)' : 'var(--border)', display: 'flex' }}>
        <IconChevronDown size={15} />
      </button>
      <button
        onClick={() => setConfirmOpen(true)}
        style={{ color: 'var(--text-muted)', display: 'flex' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <IconTrash size={15} />
      </button>
      {confirmOpen && (
        <Modal
          title="Удалить папку?"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button onClick={() => setConfirmOpen(false)} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Отмена</button>
              <button onClick={handleConfirmDelete} style={{ padding: '8px 14px', borderRadius: '7px', background: '#ff4d4d', color: '#fff', fontSize: '13px', fontWeight: 600, border: 'none' }}>Удалить</button>
            </>
          }
        >
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Папка «{folder.name}» будет удалена. Это действие нельзя отменить.</div>
        </Modal>
      )}
    </div>
  )
}

function CreateFolderView({ client, seedRoomId, onBack, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(seedRoomId ? [seedRoomId] : [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const rooms = client.getRooms().filter(r => r.getMyMembership() === 'join')

  const toggle = (roomId) => {
    setSelected(sel => (sel.includes(roomId) ? sel.filter(id => id !== roomId) : [...sel, roomId]))
  }

  const handleSubmit = async () => {
    if (!name.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      await createFolder(name.trim(), selected)
      onCreated()
    } catch (err) {
      setError(err.message || 'Не удалось создать папку')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Новая папка"
      onClose={onClose}
      footer={
        <>
          {onBack && <button onClick={onBack} style={{ padding: '8px 14px', borderRadius: '7px', color: 'var(--text-secondary)', fontSize: '13px' }}>Назад</button>}
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            style={{ padding: '8px 14px', borderRadius: '7px', background: name.trim() ? 'var(--accent-teal)' : 'var(--bg-card)', color: name.trim() ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, border: 'none' }}
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </>
      }
    >
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Название папки"
        style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '7px', padding: '9px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ marginTop: '10px', maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {rooms.map(room => {
          const isDm = isDirectRoom(client, room.roomId)
          const other = isDm ? room.getJoinedMembers().find(m => m.userId !== client.getUserId()) : null
          const label = isDm ? (other?.name || room.name) : room.name
          const isSelected = selected.includes(room.roomId)
          return (
            <div
              key={room.roomId}
              onClick={() => toggle(room.roomId)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer', background: isSelected ? 'var(--bg-card)' : 'transparent' }}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              {isSelected && <IconCheck size={14} color="var(--accent-teal)" />}
            </div>
          )
        })}
      </div>
      {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#ff4d4d' }}>{error}</div>}
    </Modal>
  )
}
