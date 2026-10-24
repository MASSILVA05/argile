import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACTIVE_SESSION_ONLINE_MS, ACTIVE_SESSION_STALE_MS, getSession } from '../lib/auth'

// Sessions actives (admins uniquement) : bouton du Header avec badge (nombre
// de sessions 🟢) + modal listant toutes les connexions de la table
// active_sessions, avec déconnexion forcée (suppression de la ligne -- le
// heartbeat de l'appareil concerné le renvoie au login sous 60 s). La table
// n'est pas lisible avec la clé anon : RPC admin_list_sessions /
// admin_revoke_session, qui exigent une session admin valide.

const REFRESH_MS = 60_000

function sessionStatus(lastSeenAt, now) {
  const age = now - new Date(lastSeenAt).getTime()
  if (age < ACTIVE_SESSION_ONLINE_MS) return { icon: '🟢', label: 'Actif' }
  if (age < ACTIVE_SESSION_STALE_MS) return { icon: '🟡', label: 'Inactif' }
  return { icon: '🔴', label: 'Déconnecté' }
}

function formatDuration(fromIso, now) {
  const totalMinutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return `${hours}h ${String(minutes).padStart(2, '0')}min`
}

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatLastSeen(iso, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `Il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`
}

function countOnline(sessions, now) {
  return sessions.filter((s) => now - new Date(s.last_seen_at).getTime() < ACTIVE_SESSION_ONLINE_MS).length
}

// admin_list_sessions marque aussi is_active = false les sessions sans
// heartbeat depuis plus de 10 min et purge les sessions expirées.
function fetchSessions() {
  return supabase.rpc('admin_list_sessions', { p_session_id: getSession()?.sessionId ?? '' })
}

function UsersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

export function ActiveSessionsButton({ currentSessionId }) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState([])
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    const { data, error } = await fetchSessions()
    setNow(Date.now())
    if (!error) setSessions(data ?? [])
    return error
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const online = countOnline(sessions, now)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
        aria-label={`Sessions actives (${online})`}
        title="Sessions actives"
      >
        <UsersIcon className="h-4 w-4" />
        {online > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[10px] leading-none font-semibold text-white">
            {online}
          </span>
        )}
      </button>
      {open && (
        <ActiveSessionsModal
          sessions={sessions}
          now={now}
          currentSessionId={currentSessionId}
          onRefresh={refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export default function ActiveSessionsModal({ sessions, now, currentSessionId, onRefresh, onClose }) {
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    onRefresh().then((err) => setError(err ? `Erreur de chargement : ${err.message}` : ''))
  }, [onRefresh])

  async function disconnect(s) {
    const ok = window.confirm(`Déconnecter ${s.username} ? Il sera redirigé vers la page de login.`)
    if (!ok) return
    setBusyId(s.id)
    const { error: deleteError } = await supabase.rpc('admin_revoke_session', {
      p_session_id: getSession()?.sessionId ?? '',
      p_target_id: s.id,
    })
    setBusyId(null)
    if (deleteError) {
      setError(`Erreur : ${deleteError.message}`)
      return
    }
    setError('')
    onRefresh()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="min-h-full w-full bg-bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-4xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Sessions actives</h2>
          <button
            type="button"
            onClick={() => onRefresh().then((err) => setError(err ? `Erreur de chargement : ${err.message}` : ''))}
            className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Actualiser
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>
        )}

        {sessions.length === 0 ? (
          <p className="text-ink-muted">Aucune session.</p>
        ) : (
          <div className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] border-collapse text-[11px] sm:text-sm">
              <thead className="sticky top-0 bg-bg-soft">
                <tr className="border-b border-border text-left text-ink-muted">
                  {['Utilisateur', 'Rôle', 'Appareil', 'Connecté depuis', 'Dernière activité', 'Statut', 'Action'].map((h) => (
                    <th key={h} className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const status = sessionStatus(s.last_seen_at, now)
                  const isCurrent = s.id === currentSessionId
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">
                        {s.username}
                        {isCurrent && <span className="ml-1 text-xs text-ink-muted">(vous)</span>}
                      </td>
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{s.role ?? '—'}</td>
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{s.device_info ?? '—'}</td>
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2" title={new Date(s.logged_in_at).toLocaleString('fr-FR')}>
                        {formatDuration(s.logged_in_at, now)} <span className="text-ink-muted">(depuis {formatClock(s.logged_in_at)})</span>
                      </td>
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{formatLastSeen(s.last_seen_at, now)}</td>
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2" title={status.label}>
                        {status.icon} <span className="text-ink-muted">{status.label}</span>
                      </td>
                      <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">
                        <button
                          type="button"
                          onClick={() => disconnect(s)}
                          disabled={busyId === s.id}
                          className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10 disabled:opacity-50"
                        >
                          Déconnecter
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-4 w-full text-center text-sm text-ink-muted">
          Fermer
        </button>
      </div>
    </div>
  )
}
