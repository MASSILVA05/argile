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

function SunIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
    </svg>
  )
}

function MoonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  )
}

export default function Header({ title, onMenuClick, session, now, pending, onLogout, theme, onToggleTheme }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-[var(--color-header-bg)] px-3 sm:gap-3 sm:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
          aria-label="Ouvrir le menu"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <img src="/logo.svg" alt="AXXAM ERP" className="hidden h-8 w-auto sm:block" />
      </div>

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
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
            aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          >
            {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </button>
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
