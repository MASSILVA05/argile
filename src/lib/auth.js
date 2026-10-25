import { supabase } from './supabase'
import { sha256 } from './hash'

// Comptes proposés sur la page de connexion (Bilal retiré : compte désactivé,
// à supprimer depuis la page Appareils connectés).
export const USERNAMES = ['Ahcene', 'Massilva', 'Mazigh', 'Halim', 'Bureau', 'Karim', 'AVADOU', 'Tahar', 'Youcef', 'Aziz', 'Sofiane', 'Abderhmane', 'Mehdi']

// Ahcene et Massilva n'ont aucune restriction d'horaire ni de jour. Mazigh garde le
// rôle 'admin' en base mais est soumis aux horaires (8h-17h, vendredi) comme les autres.
export const ADMIN_USERNAMES = ['Ahcene', 'Massilva']

// Comptes non soumis à la plage horaire 8h-17h : les admins (déjà exemptés
// de toute restriction) + Karim, Sofiane et Abderhmane, qui peuvent se
// connecter à toute heure de la journée. Ils restent soumis au jour de repos
// (vendredi) et au code OTP du samedi (requires_verification en base,
// inchangé), et n'ont pas le code admin.
export const UNRESTRICTED_HOURS_USERS = ['Ahcene', 'Massilva', 'Karim', 'Sofiane', 'Abderhmane']

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

// sessionId / serverExpiresAt : renvoyés par request_login_code ou
// verify_login_code (session créée côté serveur dans active_sessions).
export function saveSession(username, role, entity = null, { sessionId = null, serverExpiresAt = null } = {}) {
  const loginTime = Date.now()
  // Comptes sans restriction d'horaire (admins + Karim) : session de 24h à
  // partir de la connexion, au lieu d'expirer à 17h le jour même. La date
  // d'expiration du serveur (même règle) fait foi quand elle est fournie.
  const expiresAt = serverExpiresAt
    ?? (UNRESTRICTED_HOURS_USERS.includes(username)
      ? loginTime + DAY_MS
      : nextWorkEndTimestamp(new Date(loginTime)))
  const session = { username, role, entity, loginTime, expiresAt, sessionId }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// ============================================================
// Sessions actives (table active_sessions, voir SECURITY.md) : la session
// est créée PAR LA BASE à la connexion (request_login_code /
// verify_login_code), son id sert de jeton (session.sessionId, envoyé dans
// l'en-tête x-session-token par lib/supabase.js). La table n'est pas
// lisible avec la clé anon : tout passe par des RPC.
// Heartbeat toutes les 60 s (App.jsx) : session_heartbeat renvoie le
// username / rôle faisant foi côté serveur -- un rôle modifié à la main dans
// le localStorage, une session révoquée par un admin, expirée, ou un compte
// désactivé entraînent la déconnexion.
// ============================================================
export const ACTIVE_SESSION_ONLINE_MS = 5 * 60_000
export const ACTIVE_SESSION_STALE_MS = 10 * 60_000

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function browserName() {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet'
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox'
  if (/Chrome|CriOS/.test(ua)) return 'Chrome'
  if (/Safari/.test(ua)) return 'Safari'
  return 'Navigateur inconnu'
}

export function deviceInfo() {
  return `${isMobileDevice() ? 'Mobile' : 'Desktop'} — ${browserName()}`
}

// Heartbeat : 'ok' (session confirmée, ou erreur réseau -- on ne déconnecte
// pas sur une simple coupure), 'revoked' (session invalide côté serveur ou
// username/rôle différents de ceux du localStorage), 'legacy' (session sans
// jeton serveur, antérieure au suivi).
export async function touchActiveSession() {
  const session = getSession()
  if (!session) return 'ok'
  if (!session.sessionId) return 'legacy'
  const { data, error } = await supabase.rpc('session_heartbeat', { p_session_id: session.sessionId })
  if (error) return 'ok'
  if (!data?.valid) return 'revoked'
  if (data.username !== session.username || data.role !== session.role) return 'revoked'
  return 'ok'
}

// Déconnexion : supprime la session côté serveur puis la session locale.
export async function logout(sessionId = getSession()?.sessionId) {
  clearSession()
  if (sessionId) await supabase.rpc('end_session', { p_session_id: sessionId })
}

// admin            : tout accès, seul rôle pouvant utiliser le code admin (déblocage 72h)
// editor (Halim, Bureau) : saisie + consultation + export, pas de code admin
//                    -- NOTE : Halim et Bureau partagent ce même rôle, donc
//                    Bureau a techniquement accès aux pages TVA comme Halim
//                    (contrairement à ce que documentait ce commentaire
//                    avant l'ajout du cloisonnement par entité ci-dessous).
//                    Seul Halim est cloisonné sur l'entité 'Briqueterie' pour
//                    la TVA (voir request_login_code dans schema.sql) ;
//                    Bureau, n'ayant pas d'entité TVA fixe, y verrait un choix
//                    libre Briqueterie/AVADOU comme Tahar s'il ouvrait ces
//                    pages. Sur Factures/Chèques/Caisse en revanche, editor
//                    ET youcef_role sont TOUS DEUX fixés sur 'Briqueterie'
//                    sans sélecteur (aucun accès aux données AVADOU) -- voir
//                    salesEntityAccessForRole ci-dessous, indépendant de
//                    l'entité TVA (session.entity) : Bureau garde son choix
//                    libre sur TVA tout en étant cloisonné sur Factures/
//                    Chèques/Caisse.
// viewer (Bilal)   : Chargement (saisie + registre) + Maintenance (saisie +
//                    registre), aucune autre page, pas d'export Excel
// maintenance_only (Karim, Sofiane, Abderhmane) : Maintenance (saisie +
//                    registre) + Production (saisie + registre + tableau de
//                    bord), export Excel autorisé, accès 24h, pas de code admin
// tva_only (Tahar) : uniquement TVA récupération + TVA à payer, aucune autre
//                    page (PAS Factures/Chèques/Caisse), export Excel
//                    autorisé, pas de code admin. Tahar choisit librement
//                    l'entité TVA (Briqueterie/AVADOU), sans option "Tout"
//                    (réservée à l'admin) -- voir TVAPage.jsx / TVAPayerPage.jsx.
// tva_prodnet (AVADOU) : TVA récup + TVA à payer (mêmes restrictions export /
//                    pas de code admin) + Prodnet (coût de revient produits
//                    finis) + Factures/Chèques/Caisse. AVADOU est cloisonné
//                    sur l'entité 'AVADOU' PARTOUT (TVA -- session.entity --
//                    ET Factures/Chèques/Caisse -- salesEntityAccessForRole),
//                    sans sélecteur, aucun accès aux données Briqueterie.
//                    Rôle distinct de tva_only pour que Tahar n'ait PAS Prodnet.
// youcef_role (Youcef) : uniquement Carburant + Sable + Factures/Chèques/
//                    Caisse, export Excel autorisé, modification/suppression
//                    dans les 72h, pas de code admin. Dans Factures, limité
//                    aux sous-onglets Saisie + Registre (pas Avances/Stock/
//                    Mouvements/G50) -- voir InvoicesPage.jsx. Fixé sur
//                    l'entité 'Briqueterie', sans sélecteur, aucun accès aux
//                    données AVADOU -- voir salesEntityAccessForRole.
// magasin_only (Aziz) : la page Magasin (Bejaia) -- stock, ventes, crédits
//                    clients, import -- ET la page Résidence (location
//                    saisonnière). Aucune autre page, pas de code admin. Les
//                    admins y ont aussi accès ; personne d'autre.
//
// residence : onglet "Résidence" (location saisonnière Boulimat / 4 Chemins) --
//                    disponibilité, réservations, clients, caisse résidence.
//                    Accès : rôle 'admin' (Ahcene, Massilva, Mazigh) et rôle
//                    'magasin_only' (Aziz).
//
// disabled (Bilal depuis le 2026-10-24) : connexion refusée ("Compte
//                    désactivé"), aucun onglet.
//
// station : onglet "Station" (station-service) -- ventes carburant /
//                    lubrifiants / gaz, récapitulatif par client, salaires,
//                    import. Accès : rôle 'admin' (Ahcene, Massilva, Mazigh)
//                    ET rôle 'station_only' (Mehdi).
// station_only (Mehdi) : UNIQUEMENT l'onglet Station (mêmes sous-onglets que
//                    l'admin sur cette page), aucune autre page, pas de code
//                    admin. Soumis comme les autres comptes non-admin à la
//                    plage horaire 8h-17h, au jour de repos (vendredi) et au
//                    code OTP du samedi (requires_verification en base).
//
// cheques : onglet "Chèques" -- suivi de tous les chèques émis et reçus
//                    (Saisie / Registre / Suivi). Accès : rôle 'admin'
//                    (Ahcene, Massilva, Mazigh), rôle 'editor' (Halim,
//                    Bureau) et rôle 'youcef_role' (Youcef).
//
// ppi : onglet "PPI" -- Programme Prévisionnel d'Importation (plafonds par
//                    pays, produits autorisés, importations effectuées).
//                    Sous-onglets : Saisie / Registre / Budget / Import.
//                    Accès : rôle 'admin' (Ahcene, Massilva, Mazigh), rôle
//                    'editor' (Halim, Bureau) et rôle 'tva_prodnet' (AVADOU).
//
// Onglets (App.jsx / SideNav.jsx) visibles par rôle. Un rôle absent de
// cette table (ne devrait pas arriver) retombe sur le plus restrictif.
// La page Caisse (saisie + registre) est réservée aux rôles admin, editor,
// youcef_role et tva_prodnet -> concrètement Youcef, Halim, Bureau, AVADOU et
// les admins (Massilva, Ahcene, Mazigh). Les autres (Bilal/viewer, Karim/
// maintenance_only, Tahar/tva_only) n'y ont pas accès. Même règle pour
// Factures et Chèques (voir cloisonnement par entité Briqueterie/AVADOU fixé
// par rôle dans salesEntityAccessForRole ci-dessous, utilisé par
// InvoicesPage.jsx / ChequesPage.jsx / CaissePage.jsx).
export const ROLE_TABS = {
  admin: ['form', 'registry', 'maintenance', 'production', 'prodnet', 'fuel', 'sand', 'invoices', 'tva', 'tva-payer', 'caisse', 'magasin', 'residence', 'station', 'cheques', 'ppi', 'sessions'],
  editor: ['form', 'registry', 'maintenance', 'prodnet', 'fuel', 'sand', 'invoices', 'tva', 'tva-payer', 'caisse', 'cheques', 'ppi'],
  viewer: ['form', 'registry', 'maintenance'],
  maintenance_only: ['maintenance', 'production'],
  tva_only: ['tva', 'tva-payer'],
  tva_prodnet: ['tva', 'tva-payer', 'prodnet', 'ppi', 'invoices', 'cheques', 'caisse'],
  youcef_role: ['fuel', 'sand', 'invoices', 'caisse', 'cheques'],
  magasin_only: ['magasin', 'residence'],
  station_only: ['station'],
  disabled: [],
}

export function allowedTabsForRole(role) {
  return ROLE_TABS[role] ?? ROLE_TABS.viewer
}

// Entité fixe pour les pages Factures / Chèques / Caisse -- INDÉPENDANT de
// l'entité TVA (session.entity / useAuth().entity), qui reste utilisée telle
// quelle par TVAPage.jsx / TVAPayerPage.jsx (Tahar et Bureau y gardent leur
// choix libre). Seul le rôle admin choisit librement ici (avec option
// "Tout") ; AVADOU (tva_prodnet) est fixé sur 'AVADOU' ; editor (Halim,
// Bureau) et youcef_role sont fixés sur 'Briqueterie' -- aucun accès aux
// données AVADOU pour ces deux rôles. tva_only (Tahar) n'a plus du tout accès
// à ces pages (absentes de ROLE_TABS.tva_only), donc jamais consulté pour lui.
export function salesEntityAccessForRole(role) {
  if (role === 'admin') return { fixedEntity: null, canSeeAllEntities: true }
  if (role === 'tva_prodnet') return { fixedEntity: 'AVADOU', canSeeAllEntities: false }
  return { fixedEntity: 'Briqueterie', canSeeAllEntities: false }
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
    isTvaProdnet: role === 'tva_prodnet',
    isYoucefRole: role === 'youcef_role',
    isMagasinOnly: role === 'magasin_only',
    isStationOnly: role === 'station_only',
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
    p_device_info: deviceInfo(),
  })
  // Rate limiting : "Trop de tentatives. Réessayez dans 15 minutes." arrive
  // ici comme une erreur RPC.
  if (error) return { success: false, message: error.message }
  // Compte désactivé (rôle 'disabled') : refusé aussi côté serveur par
  // request_login_code ; ce contrôle couvre une base pas encore migrée.
  if (data?.role === 'disabled') return { success: false, message: 'Compte désactivé' }
  return {
    success: !!data?.success,
    requiresVerification: !!data?.requires_verification,
    role: data?.role ?? null,
    entity: data?.entity ?? null,
    sessionId: data?.session_id ?? null,
    serverExpiresAt: data?.expires_at ?? null,
    message: data?.message ?? '',
  }
}

// Étape 2 (uniquement pour les comptes avec vérification) : valide le code reçu par l'administrateur.
export async function verifyCode(username, code) {
  const { data, error } = await supabase.rpc('verify_login_code', {
    p_username: username,
    p_code: code,
    p_device_info: deviceInfo(),
  })
  if (error) return { success: false, message: error.message }
  return {
    success: !!data?.success,
    role: data?.role ?? null,
    entity: data?.entity ?? null,
    sessionId: data?.session_id ?? null,
    serverExpiresAt: data?.expires_at ?? null,
    message: data?.message ?? '',
  }
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
