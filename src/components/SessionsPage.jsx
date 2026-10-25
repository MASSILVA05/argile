import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACTIVE_SESSION_ONLINE_MS, ACTIVE_SESSION_STALE_MS, USERNAMES, getSession } from '../lib/auth'

// Page « Appareils connectés » (admins uniquement, onglet 'sessions') : TOUS
// les comptes, avec leurs sessions de la table active_sessions regroupées par
// utilisateur, la déconnexion forcée (suppression de la ligne -- le heartbeat
// de l'appareil concerné le renvoie au login sous 60 s), l'historique des
// sessions terminées (session_history) et la suppression des comptes
// désactivés. Ces tables ne sont pas lisibles avec la clé anon : RPC
// admin_list_sessions / admin_list_users / admin_session_history /
// admin_revoke_session / admin_delete_user, qui exigent une session admin
// valide (voir SECURITY.md).

const REFRESH_MS = 30_000
const HISTORY_LIMIT = 20

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

function formatMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.floor(totalMinutes))
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes} min`
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}min`
}

function formatDuration(fromIso, toMs) {
  return formatMinutes((toMs - new Date(fromIso).getTime()) / 60_000)
}

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(iso) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('fr-FR')} ${formatClock(iso)}`
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

function DeviceIcon({ deviceInfo, className }) {
  const Icon = isMobileDevice(deviceInfo) ? PhoneIcon : DesktopIcon
  return <Icon className={className} />
}

// 0 = au moins une session en ligne, 1 = sessions inactives / déconnectées,
// 2 = aucune session (hors ligne).
function userRank(user) {
  if (user.online) return 0
  if (user.sessions.length > 0) return 1
  return 2
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState([])
  // Comptes et rôles (admin_list_users) ; null si le RPC est indisponible
  // (repli sur USERNAMES, rôles déduits des sessions).
  const [accounts, setAccounts] = useState(null)
  const [deletedUsers, setDeletedUsers] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [busyId, setBusyId] = useState(null)
  // username -> { open, loading, rows, error }
  const [history, setHistory] = useState({})
  const currentSessionId = getSession()?.sessionId ?? null

  const refresh = useCallback(async () => {
    const token = getSession()?.sessionId ?? ''
    const [sessionsRes, usersRes] = await Promise.all([
      supabase.rpc('admin_list_sessions', { p_session_id: token }),
      supabase.rpc('admin_list_users', { p_session_id: token }),
    ])
    setNow(Date.now())
    if (sessionsRes.error) {
      setError(`Erreur de chargement : ${sessionsRes.error.message}`)
    } else {
      setSessions(sessionsRes.data ?? [])
      setError('')
    }
    if (!usersRes.error) setAccounts(usersRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Tous les comptes (USERNAMES + comptes en base + éventuels comptes vus
  // uniquement dans les sessions), avec leurs sessions regroupées. Tri : en
  // ligne, puis avec sessions inactives, puis hors ligne ; ensuite activité
  // la plus récente, puis ordre de USERNAMES.
  const users = useMemo(() => {
    const grouped = {}
    for (const s of sessions) {
      if (!grouped[s.username]) grouped[s.username] = []
      grouped[s.username].push(s)
    }
    const rolesByName = new Map((accounts ?? []).map((a) => [a.username, a.role]))
    const names = [...new Set([...USERNAMES, ...rolesByName.keys(), ...Object.keys(grouped)])].filter(
      (name) => !deletedUsers.has(name)
    )
    const order = (name) => {
      const i = USERNAMES.indexOf(name)
      return i === -1 ? USERNAMES.length : i
    }

    return names
      .map((username) => {
        const list = [...(grouped[username] ?? [])].sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))
        return {
          username,
          role: rolesByName.get(username) ?? list[0]?.role ?? null,
          sessions: list,
          online: list.some((s) => isOnline(s, now)),
          lastSeen: list[0]?.last_seen_at ?? null,
        }
      })
      .sort((a, b) => {
        const rank = userRank(a) - userRank(b)
        if (rank !== 0) return rank
        if (a.lastSeen && b.lastSeen && a.lastSeen !== b.lastSeen) return a.lastSeen < b.lastSeen ? 1 : -1
        return order(a.username) - order(b.username)
      })
  }, [sessions, accounts, deletedUsers, now])

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
    // La session révoquée part dans l'historique : le recharger s'il est ouvert.
    if (history[s.username]?.open) loadHistory(s.username)
  }

  async function loadHistory(username) {
    setHistory((h) => ({ ...h, [username]: { ...h[username], open: true, loading: true, error: '' } }))
    const { data, error: rpcError } = await supabase.rpc('admin_session_history', {
      p_session_id: getSession()?.sessionId ?? '',
      p_username: username,
      p_limit: HISTORY_LIMIT,
    })
    setHistory((h) => ({
      ...h,
      [username]: {
        open: true,
        loading: false,
        rows: rpcError ? [] : data ?? [],
        error: rpcError ? `Erreur : ${rpcError.message}` : '',
      },
    }))
  }

  function toggleHistory(username) {
    if (history[username]?.open) {
      setHistory((h) => ({ ...h, [username]: { ...h[username], open: false } }))
      return
    }
    loadHistory(username)
  }

  async function deleteUser(user) {
    const ok = window.confirm(
      `Supprimer définitivement le compte ${user.username} ?\n\nSes sessions, son historique et ses tentatives de connexion seront effacés. Ses saisies sont conservées. Action irréversible.`
    )
    if (!ok) return
    setBusyId(`user:${user.username}`)
    const { error: rpcError } = await supabase.rpc('admin_delete_user', {
      p_session_id: getSession()?.sessionId ?? '',
      p_username: user.username,
    })
    setBusyId(null)
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    setError('')
    setDeletedUsers((current) => new Set(current).add(user.username))
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
      ) : (
        <div className="flex flex-col gap-3">
          {users.map((user) => {
            const offline = user.sessions.length === 0
            const userHistory = history[user.username]
            return (
              <section
                key={user.username}
                className={`rounded-lg border border-border bg-bg-soft ${offline ? 'opacity-70' : ''}`}
              >
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-lg ${
                      offline ? 'bg-border/40 text-ink-muted' : 'bg-terracotta/15 text-terracotta'
                    }`}
                  >
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-ink">{user.username}</span>
                      {user.role && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            user.role === 'disabled'
                              ? 'border-terracotta/50 text-terracotta'
                              : 'border-border text-ink-muted'
                          }`}
                        >
                          {user.role === 'disabled' ? 'désactivé' : user.role}
                        </span>
                      )}
                      {user.online ? (
                        <span className="rounded-full border border-green-500/50 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-500">
                          En ligne
                        </span>
                      ) : offline ? (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-ink-muted">Hors ligne</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-ink-muted">
                      {offline
                        ? 'Aucune session active'
                        : `${user.sessions.length} appareil${user.sessions.length > 1 ? 's' : ''}`}
                    </span>
                  </div>
                  {user.role === 'disabled' && (
                    <button
                      type="button"
                      onClick={() => deleteUser(user)}
                      disabled={busyId === `user:${user.username}`}
                      className="min-h-9 rounded border border-terracotta bg-terracotta/10 px-3 py-1 text-sm text-terracotta hover:bg-terracotta/20 disabled:opacity-50"
                    >
                      Supprimer le compte
                    </button>
                  )}
                </header>

                {!offline && (
                  <ul className="flex flex-col">
                    {user.sessions.map((s) => {
                      const status = sessionStatus(s, now)
                      const isCurrent = s.id === currentSessionId
                      return (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                        >
                          <DeviceIcon deviceInfo={s.device_info} className="h-6 w-6 shrink-0 text-ink-muted" />
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
                )}

                <div className="border-t border-border px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleHistory(user.username)}
                    className="text-sm text-ocre underline-offset-2 hover:underline"
                    aria-expanded={Boolean(userHistory?.open)}
                  >
                    {userHistory?.open ? "Masquer l'historique" : "Voir l'historique"}
                  </button>

                  {userHistory?.open && (
                    <div className="mt-2">
                      {userHistory.loading ? (
                        <p className="text-sm text-ink-muted">Chargement…</p>
                      ) : userHistory.error ? (
                        <p className="text-sm text-terracotta">{userHistory.error}</p>
                      ) : userHistory.rows.length === 0 ? (
                        <p className="text-sm text-ink-muted">Aucune session terminée.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full min-w-[560px] border-collapse text-[11px] sm:text-sm">
                            <thead className="bg-bg-card">
                              <tr className="border-b border-border text-left text-ink-muted">
                                {['Connexion', 'Déconnexion', 'Durée', 'Appareil'].map((h) => (
                                  <th key={h} className="px-2 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {userHistory.rows.map((h) => (
                                <tr key={h.id} className="border-b border-border last:border-0">
                                  <td className="px-2 py-1 whitespace-nowrap sm:px-3 sm:py-2">{formatDateTime(h.logged_in_at)}</td>
                                  <td className="px-2 py-1 whitespace-nowrap sm:px-3 sm:py-2">{formatDateTime(h.ended_at)}</td>
                                  <td className="px-2 py-1 whitespace-nowrap sm:px-3 sm:py-2">
                                    {formatDuration(h.logged_in_at, new Date(h.ended_at).getTime())}
                                  </td>
                                  <td className="px-2 py-1 whitespace-nowrap sm:px-3 sm:py-2">
                                    <span className="inline-flex items-center gap-1.5">
                                      <DeviceIcon deviceInfo={h.device_info} className="h-4 w-4 shrink-0 text-ink-muted" />
                                      {h.device_info ?? 'Appareil inconnu'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
