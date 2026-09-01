import { supabase } from './supabase'
import { sha256 } from './hash'

export const USERNAMES = ['Ahcene', 'Massilva', 'Halim', 'Bureau', 'Bilal', 'Karim', 'AVADOU', 'Tahar', 'Youcef', 'Aziz']

// Ahcene et Massilva (admin) n'ont aucune restriction d'horaire ni de jour.
export const ADMIN_USERNAMES = ['Ahcene', 'Massilva']

// Comptes non soumis à la plage horaire 8h-17h : les admins (déjà exemptés
// de toute restriction) + Karim, qui peut se connecter à toute heure de la
// journée. Karim reste soumis au jour de repos (vendredi) et au code OTP du
// samedi (requires_verification en base, inchangé), et n'a pas le code admin.
export const UNRESTRICTED_HOURS_USERS = ['Ahcene', 'Massilva', 'Karim']

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
// Les admins (Ahcene, Massilva) n'ont aucune restriction. Karim est exempté de
// la plage 8h-17h (accès à toute heure) mais reste soumis au jour de repos.
// Les autres comptes (Halim, Bureau, Bilal) : accès uniquement 8h-17h, du
// dimanche au samedi (vendredi = jour de repos, pas d'accès).
export function getLoginAccessStatus(username, date = new Date()) {
  if (ADMIN_USERNAMES.includes(username)) return { allowed: true }

  const { dayOfWeek, hour } = getAlgeriaParts(date)

  if (dayOfWeek === 5) {
    return { allowed: false, message: 'Jour de repos — accès indisponible' }
  }
  if (
    !UNRESTRICTED_HOURS_USERS.includes(username) &&
    (hour < WORK_START_HOUR || hour >= WORK_END_HOUR)
  ) {
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

const DAY_MS = 24 * 60 * 60 * 1000

export function saveSession(username, role, entity = null) {
  const loginTime = Date.now()
  // Comptes sans restriction d'horaire (admins + Karim) : session de 24h à
  // partir de la connexion, au lieu d'expirer à 17h le jour même.
  const expiresAt = UNRESTRICTED_HOURS_USERS.includes(username)
    ? loginTime + DAY_MS
    : nextWorkEndTimestamp(new Date(loginTime))
  const session = { username, role, entity, loginTime, expiresAt }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// admin            : tout accès, seul rôle pouvant utiliser le code admin (déblocage 72h)
// editor (Halim, Bureau) : saisie + consultation + export, pas de code admin
//                    -- NOTE : Halim et Bureau partagent ce même rôle, donc
//                    Bureau a techniquement accès aux pages TVA comme Halim
//                    (contrairement à ce que documentait ce commentaire
//                    avant l'ajout du cloisonnement par entité ci-dessous).
//                    Seul Halim est cloisonné sur l'entité 'Briqueterie'
//                    (voir request_login_code dans schema.sql) ; Bureau,
//                    n'ayant pas d'entité fixe, verrait un choix libre
//                    Briqueterie/AVADOU comme Tahar s'il ouvrait ces pages.
// viewer (Bilal)   : Chargement (saisie + registre) + Maintenance (saisie +
//                    registre), aucune autre page, pas d'export Excel
// maintenance_only (Karim) : uniquement Maintenance (saisie + registre),
//                    export Excel autorisé
// tva_only (AVADOU, Tahar) : uniquement TVA récupération + TVA à payer,
//                    aucune autre page, export Excel autorisé, pas de code
//                    admin. AVADOU est cloisonné sur l'entité 'AVADOU',
//                    Tahar choisit librement (Briqueterie/AVADOU) --
//                    voir TVAPage.jsx / TVAPayerPage.jsx.
// youcef_role (Youcef) : uniquement Carburant + Sable + Factures, export
//                    Excel autorisé, modification/suppression dans les 72h,
//                    pas de code admin. Dans Factures, limité aux sous-onglets
//                    Saisie + Registre (pas Avances/Stock/Mouvements/G50) --
//                    voir InvoicesPage.jsx.
// magasin_only (Aziz) : uniquement la page Magasin (Bejaia) -- stock, ventes,
//                    crédits clients, import. Aucune autre page, pas de code
//                    admin. Les admins y ont aussi accès ; personne d'autre.
//
// Onglets (App.jsx / BottomNav.jsx) visibles par rôle. Un rôle absent de
// cette table (ne devrait pas arriver) retombe sur le plus restrictif.
// La page Caisse (saisie + registre) est réservée aux rôles admin, editor et
// youcef_role -> concrètement Youcef, Halim, Bureau et les admins (Massilva,
// Ahcene). Les autres (Bilal/viewer, Karim/maintenance_only, AVADOU + Tahar/
// tva_only) n'y ont pas accès.
export const ROLE_TABS = {
  admin: ['form', 'registry', 'maintenance', 'fuel', 'sand', 'invoices', 'tva', 'tva-payer', 'caisse', 'magasin'],
  editor: ['form', 'registry', 'maintenance', 'fuel', 'sand', 'invoices', 'tva', 'tva-payer', 'caisse'],
  viewer: ['form', 'registry', 'maintenance'],
  maintenance_only: ['maintenance'],
  tva_only: ['tva', 'tva-payer'],
  youcef_role: ['fuel', 'sand', 'invoices', 'caisse'],
  magasin_only: ['magasin'],
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
    isTvaOnly: role === 'tva_only',
    isYoucefRole: role === 'youcef_role',
    isMagasinOnly: role === 'magasin_only',
    // Entité TVA fixe de l'utilisateur (Halim -> 'Briqueterie', AVADOU ->
    // 'AVADOU'), NULL si l'utilisateur choisit librement (Tahar, admins).
    entity: session?.entity ?? null,
    canSeeAllEntities: role === 'admin',
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
    entity: data?.entity ?? null,
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

// Changement de mot de passe, étape 1 : envoie une demande. Le nouveau mot
// de passe est hashé côté client (comme pour la connexion) avant d'être
// transmis, mais est AUSSI envoyé en clair (newPassword) -- uniquement pour
// que la fonction serveur puisse l'inclure dans la notification ntfy lue
// par l'admin ; il n'est jamais stocké tel quel en base (voir schema.sql).
export async function requestPasswordChange(username, newPassword) {
  const passwordHash = await sha256(newPassword)
  const { data, error } = await supabase.rpc('request_password_change', {
    p_username: username,
    p_new_password_hash: passwordHash,
    p_new_password_plain: newPassword,
  })
  if (error) return { success: false, message: error.message }
  return { success: !!data?.success, message: data?.message ?? '' }
}

// Changement de mot de passe, étape 2 : valide le code donné par l'admin,
// ce qui applique le nouveau mot de passe (stocké en attente depuis l'étape 1).
export async function confirmPasswordChange(username, code) {
  const { data, error } = await supabase.rpc('confirm_password_change', {
    p_username: username,
    p_code: code,
  })
  if (error) return { success: false, message: error.message }
  return { success: !!data?.success, message: data?.message ?? '' }
}
