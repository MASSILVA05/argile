import { supabase } from './supabase'
import { sha256 } from './hash'

export const USERNAMES = ['Ahcene', 'Massilva', 'Halim', 'Bureau', 'Bilal']

const SESSION_KEY = 'dpr-session'
const SESSION_HOURS = 24

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
  const session = { username, role, loginTime, expiresAt: loginTime + SESSION_HOURS * 3600 * 1000 }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// admin  : tout accès, seul rôle pouvant utiliser le code admin (déblocage 72h)
// editor : saisie + consultation + export, pas de code admin
// viewer : consultation seule, ni saisie ni export ni modification
export function useAuth() {
  const session = getSession()
  const role = session?.role ?? null
  return {
    username: session?.username ?? null,
    role,
    isAdmin: role === 'admin',
    isEditor: role === 'editor',
    isViewer: role === 'viewer',
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
