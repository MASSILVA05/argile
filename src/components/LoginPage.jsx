import { useState } from 'react'
import { USERNAMES, requestLogin, verifyCode, saveSession } from '../lib/auth'

export default function LoginPage({ onLogin }) {
  const [step, setStep] = useState('credentials')
  const [username, setUsername] = useState(USERNAMES[0])
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCredentialsSubmit(e) {
    e.preventDefault()
    if (!password) {
      setError('Le mot de passe est obligatoire.')
      return
    }
    setError('')
    setLoading(true)
    const result = await requestLogin(username, password)
    setLoading(false)

    if (!result.success) {
      setError(result.message || 'Identifiants invalides.')
      return
    }
    if (result.requiresVerification) {
      setStep('code')
      return
    }
    onLogin(saveSession(username))
  }

  async function handleCodeSubmit(e) {
    e.preventDefault()
    if (!code) {
      setError('Le code est obligatoire.')
      return
    }
    setError('')
    setLoading(true)
    const result = await verifyCode(username, code)
    setLoading(false)

    if (!result.success) {
      setError(result.message || 'Code incorrect ou expiré.')
      return
    }
    onLogin(saveSession(username))
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-widest text-ocre uppercase">SARL DPR AXXAM</p>
        <h1 className="font-display text-2xl font-semibold text-ink">Suivi de chargement</h1>
      </div>

      <div className="rounded-xl border border-border bg-bg-card p-6">
        {step === 'credentials' ? (
          <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-4">
            <h2 className="font-display text-lg text-ink">Connexion</h2>

            <Field label="Nom d'utilisateur">
              <select value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass}>
                {USERNAMES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Mot de passe">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                autoFocus
                required
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
            <h2 className="font-display text-lg text-ink">Code de vérification</h2>
            <p className="text-sm text-ink-muted">
              Code de vérification envoyé à l'administrateur. Demande-le lui pour continuer.
            </p>

            <Field label="Code à 6 chiffres">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center tracking-[0.5em]`}
                autoFocus
                required
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
            >
              {loading ? 'Vérification…' : 'Valider'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('credentials')
                setCode('')
                setError('')
              }}
              className="text-sm text-ink-muted"
            >
              Retour
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
