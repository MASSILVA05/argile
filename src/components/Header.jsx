import { COMPANY_INFO } from '../lib/printRegistry'

function formatRemaining(expiresAt, now) {
  const ms = expiresAt - now
  if (ms <= 0) return 'expirée'
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h${String(minutes).padStart(2, '0')}`
}

function MenuIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  )
}

export default function Header({ title, onMenuClick, session, now, pending, onLogout }) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-bg-card px-3 py-3 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
        aria-label="Ouvrir le menu"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col items-center text-center">
        <p className="text-[10px] tracking-widest text-ocre uppercase sm:text-xs">{COMPANY_INFO.name}</p>
        <h1 className="w-full truncate font-display text-base font-semibold text-ink sm:text-xl">{title}</h1>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {pending > 0 && (
          <span className="rounded-full border border-ocre px-2 py-0.5 text-[10px] whitespace-nowrap text-ocre">
            {pending} en attente
          </span>
        )}
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="hidden sm:inline">{session.username}</span>
          <span className="whitespace-nowrap">Session : {formatRemaining(session.expiresAt, now)}</span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded border border-border px-2 py-1 whitespace-nowrap hover:border-terracotta hover:text-terracotta"
          >
            Déconnexion
          </button>
        </div>
      </div>
    </header>
  )
}
