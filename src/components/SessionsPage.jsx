import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACTIVE_SESSION_ONLINE_MS, ACTIVE_SESSION_STALE_MS, getSession } from '../lib/auth'

// Page « Appareils connectés » (admins uniquement, onglet 'sessions') : les
// sessions de la table active_sessions regroupées par utilisateur, avec
// déconnexion forcée (suppression de la ligne -- le heartbeat de l'appareil
// concerné le renvoie au login sous 60 s). La table n'est pas lisible avec la
// clé anon : RPC admin_list_sessions / admin_revoke_session, qui exigent une
// session admin valide (voir SECURITY.md).

const REFRESH_MS = 30_000

function sessionAge(s, now) {
  return now - new Date(s.last_seen_at).getTime()
}

function sessionStatus(s, now) {
  const age = sessionAge(s, now)
  if (age < ACTIVE_SESSION_ONLINE_MS) return { icon: '🟢', label: 'En ligne', className: 'text-green-500' }
  if (age < ACTIVE_SESSION_STALE_MS) return { icon: '🟡', label: 'Inactif', className: 'text-ocre' }
  return { icon: '🔴', label: 'Déconnecté', className: 'text-terracotta' }
}

function isOnline(s, now) {
  return sessionAge(s, now) < ACTIVE_SESSION_ONLINE_MS
}

function isMobileDevice(deviceInfo) {
  return /^mobile/i.test(deviceInfo ?? '')
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
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `il y a ${hours} heure${hours > 1 ? 's' : ''}`
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function PhoneIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  )
}

function DesktopIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </svg>
  )
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [busyId, setBusyId] = useState(null)
  const currentSessionId = getSession()?.sessionId ?? null

  const refresh = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_list_sessions', {
      p_session_id: getSession()?.sessionId ?? '',
    })
    setNow(Date.now())
    if (rpcError) {
      setError(`Erreur de chargement : ${rpcError.message}`)
    } else {
      setSessions(data ?? [])
      setError('')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Sessions regroupées par utilisateur ; utilisateurs avec au moins une
  // session en ligne d'abord, puis par activité la plus récente.
  const users = useMemo(() => {
    const grouped = {}
    for (const s of sessions) {
      if (!grouped[s.username]) grouped[s.username] = []
      grouped[s.username].push(s)
    }
    return Object.entries(grouped)
      .map(([username, list]) => {
        const sorted = [...list].sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))
        return {
          username,
          role: sorted[0].role,
          sessions: sorted,
          online: sorted.some((s) => isOnline(s, now)),
          lastSeen: sorted[0].last_seen_at,
        }
      })
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1
        return a.lastSeen < b.lastSeen ? 1 : -1
      })
  }, [sessions, now])

  const onlineCount = sessions.filter((s) => isOnline(s, now)).length

  async function disconnect(s) {
    const ok = window.confirm(
      `Déconnecter ${s.username} (${s.device_info ?? 'appareil inconnu'}) ? Il sera redirigé vers la page de login.`
    )
    if (!ok) return
    setBusyId(s.id)
    const { error: rpcError } = await supabase.rpc('admin_revoke_session', {
      p_session_id: getSession()?.sessionId ?? '',
      p_target_id: s.id,
    })
    setBusyId(null)
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted">
          <span className="font-display text-lg text-green-500">{onlineCount}</span> en ligne ·{' '}
          <span className="font-display text-lg text-ink">{sessions.length}</span> session{sessions.length > 1 ? 's' : ''} au total
        </p>
        <button
          type="button"
          onClick={refresh}
          className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
        >
          Actualiser
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : users.length === 0 ? (
        <p className="text-ink-muted">Aucune session.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {users.map((user) => (
            <section key={user.username} className="rounded-lg border border-border bg-bg-soft">
              <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-terracotta/15 font-display text-lg text-terracotta">
                  {user.username.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-ink">{user.username}</span>
                    {user.role && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-ink-muted">{user.role}</span>
                    )}
                    {user.online && (
                      <span className="rounded-full border border-green-500/50 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-500">
                        En ligne
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-ink-muted">
                    {user.sessions.length} appareil{user.sessions.length > 1 ? 's' : ''}
                  </span>
                </div>
              </header>

              <ul className="flex flex-col">
                {user.sessions.map((s) => {
                  const status = sessionStatus(s, now)
                  const isCurrent = s.id === currentSessionId
                  const DeviceIcon = isMobileDevice(s.device_info) ? PhoneIcon : DesktopIcon
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                    >
                      <DeviceIcon className="h-6 w-6 shrink-0 text-ink-muted" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm text-ink">
                          {s.device_info ?? 'Appareil inconnu'}
                          {isCurrent && <span className="ml-1 text-xs text-ink-muted">(cet appareil)</span>}
                        </span>
                        <span className="text-xs text-ink-muted">
                          Connecté depuis {formatDuration(s.logged_in_at, now)} (à {formatClock(s.logged_in_at)}) · dernière
                          activité {formatLastSeen(s.last_seen_at, now)}
                        </span>
                      </div>
                      <span className={`text-sm whitespace-nowrap ${status.className}`}>
                        {status.icon} {status.label}
                      </span>
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => disconnect(s)}
                          disabled={busyId === s.id}
                          className="min-h-9 rounded border border-terracotta/50 px-3 py-1 text-sm text-terracotta hover:bg-terracotta/10 disabled:opacity-50"
                        >
                          Déconnecter
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
