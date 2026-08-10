import { supabase } from './supabase'
import { sha256 } from './hash'

export const USERNAMES = ['Ahcene', 'Massilva', 'Halim', 'Bureau', 'Bilal', 'Karim']

// Ahcene et Massilva (admin) n'ont aucune restriction d'horaire ni de jour.
export const ADMIN_USERNAMES = ['Ahcene', 'Massilva']

const SESSION_KEY = 'dpr-session'
const ALGERIA_TZ = 'Africa/Algiers'
const WORK_START_HOUR = 8
const WORK_END_HOUR = 17

// Décompose une date dans le fuseau horaire de l'Algérie (UTC+1 fixe, sans heure d'été).
function getAlgeriaParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ALGERIA_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const map = {}
  for (const part of parts) map[part.type] = part.value
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    dayOfWeek: WEEKDAYS[map.weekday],
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
}

// Prochaine échéance de 17h (Algérie) à partir de `date` : aujourd'hui si pas encore
// atteinte, sinon demain (couvre le cas d'une connexion admin après 17h, seuls les
// admins pouvant se connecter en dehors de la plage 8h-17h).
function nextWorkEndTimestamp(date) {
  const { year, month, day } = getAlgeriaParts(date)
  // Algérie = UTC+1 toute l'année -> 17h Algérie = 16h UTC.
  let expiresAt = Date.UTC(year, month - 1, day, WORK_END_HOUR - 1, 0, 0, 0)
  if (expiresAt <= date.getTime()) {
    expiresAt = Date.UTC(year, month - 1, day + 1, WORK_END_HOUR - 1, 0, 0, 0)
  }
  return expiresAt
}

// Vérifie si `username` peut accéder à la page de connexion à l'instant `date`.
// Les admins (Ahcene, Massilva) n'ont aucune restriction. Les autres comptes
// (Halim, Bureau, Bilal) : accès uniquement 8h-17h, du dimanche au samedi
// (vendredi = jour de repos, pas d'accès).
export function getLoginAccessStatus(username, date = new Date()) {
  if (ADMIN_USERNAMES.includes(username)) return { allowed: true }

  const { dayOfWeek, hour } = getAlgeriaParts(date)

  if (dayOfWeek === 5) {
    return { allowed: false, message: 'Jour de repos — accès indisponible' }
  }
  if (hour < WORK_START_HOUR || hour >= WORK_END_HOUR) {
    return { allowed: false, message: 'Accès disponible de 8h à 17h' }
  }
  return { allowed: true }
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function saveSession(username, role) {
  const loginTime = Date.now()
  const expiresAt = nextWorkEndTimestamp(new Date(loginTime))
  const session = { username, role, loginTime, expiresAt }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// admin            : tout accès, seul rôle pouvant utiliser le code admin (déblocage 72h)
// editor           : saisie + consultation + export, pas de code admin
// viewer (Bilal)   : Chargement (saisie uniquement, pas de registre) + Maintenance
//                    (saisie + registre), aucune autre page, pas d'export Excel
// maintenance_only (Karim) : uniquement Maintenance (saisie + registre)
//
// Onglets (App.jsx / BottomNav.jsx) visibles par rôle. Un rôle absent de
// cette table (ne devrait pas arriver) retombe sur le plus restrictif.
export const ROLE_TABS = {
  admin: ['form', 'registry', 'maintenance', 'fuel', 'sand', 'invoices', 'tva'],
  editor: ['form', 'registry', 'maintenance', 'fuel', 'sand', 'invoices', 'tva'],
  viewer: ['form', 'maintenance'],
  maintenance_only: ['maintenance'],
}

export function allowedTabsForRole(role) {
  return ROLE_TABS[role] ?? ROLE_TABS.viewer
}

export function useAuth() {
  const session = getSession()
  const role = session?.role ?? null
  return {
    username: session?.username ?? null,
    role,
    isAdmin: role === 'admin',
    isEditor: role === 'editor',
    isViewer: role === 'viewer',
    isMaintenanceOnly: role === 'maintenance_only',
  }
}

// Étape 1 : vérifie le mot de passe.
// - utilisateur sans vérification -> { success: true, requiresVerification: false, role }, session déjà valide
// - utilisateur avec vérification -> { success: true, requiresVerification: true, role }, code envoyé
//   à l'administrateur via ntfy côté serveur (la fonction ne renvoie jamais le code lui-même)
export async function requestLogin(username, password) {
  const passwordHash = await sha256(password)
  const { data, error } = await supabase.rpc('request_login_code', {
    p_username: username,
    p_password_hash: passwordHash,
  })
  if (error) return { success: false, message: error.message }
  return {
    success: !!data?.success,
    requiresVerification: !!data?.requires_verification,
    role: data?.role ?? null,
    message: data?.message ?? '',
  }
}

// Étape 2 (uniquement pour les comptes avec vérification) : valide le code reçu par l'administrateur.
export async function verifyCode(username, code) {
  const { data, error } = await supabase.rpc('verify_login_code', {
    p_username: username,
    p_code: code,
  })
  if (error) return { success: false, message: error.message }
  return { success: !!data?.success, message: data?.message ?? '' }
}
