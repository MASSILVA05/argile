import { isLocked, LOCK_MESSAGE } from '../lib/lock'

export default function RowActions({ entry, onEdit, onDelete, onLockedAttempt }) {
  const locked = isLocked(entry)
  const title = locked ? LOCK_MESSAGE : undefined
  const lockedClass = locked ? 'cursor-not-allowed opacity-40' : ''

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={locked ? () => onLockedAttempt('edit') : onEdit}
        title={title}
        className={`rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre ${lockedClass}`}
      >
        Modifier
      </button>
      <button
        type="button"
        onClick={locked ? () => onLockedAttempt('delete') : onDelete}
        title={title}
        className={`rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10 ${lockedClass}`}
      >
        Supprimer
      </button>
    </div>
  )
}
