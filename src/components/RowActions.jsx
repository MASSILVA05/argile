import { isLocked, LOCK_MESSAGE } from '../lib/lock'

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function EditIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function DeleteIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

// Icônes seules sur mobile (peu de place dans le registre), texte affiché à
// partir de sm: -- l'attribut title reste le filet de secours au survol/tap
// sur tous les écrans.
export default function RowActions({ entry, onEdit, onDelete, onLockedAttempt }) {
  const locked = isLocked(entry)
  const lockedTitle = locked ? LOCK_MESSAGE : undefined
  const lockedClass = locked ? 'cursor-not-allowed opacity-40' : ''

  return (
    <div className="no-print flex gap-2">
      <button
        type="button"
        onClick={locked ? () => onLockedAttempt('edit') : onEdit}
        title={lockedTitle ?? 'Modifier'}
        className={`flex items-center gap-1 rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre ${lockedClass}`}
      >
        <EditIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Modifier</span>
      </button>
      <button
        type="button"
        onClick={locked ? () => onLockedAttempt('delete') : onDelete}
        title={lockedTitle ?? 'Supprimer'}
        className={`flex items-center gap-1 rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10 ${lockedClass}`}
      >
        <DeleteIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Supprimer</span>
      </button>
    </div>
  )
}
