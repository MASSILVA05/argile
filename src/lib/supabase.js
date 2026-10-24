import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Variables Supabase manquantes : vérifiez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env'
  )
}

// Jeton de session (active_sessions.id, généré par la base à la connexion)
// envoyé dans l'en-tête x-session-token de chaque requête : les fonctions
// SQL le lisent via current_session_token() (ex. exigence d'une session
// admin pour le code admin -- voir SECURITY.md). Lu directement dans le
// localStorage (clé 'dpr-session' de auth.js) pour éviter un import
// circulaire auth.js <-> supabase.js.
function currentSessionToken() {
  try {
    return JSON.parse(localStorage.getItem('dpr-session') ?? 'null')?.sessionId ?? null
  } catch {
    return null
  }
}

function fetchWithSessionToken(input, init = {}) {
  const token = currentSessionToken()
  if (!token) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('x-session-token', token)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithSessionToken },
})
