import { useEffect, useState } from 'react'
import {
  USERNAMES,
  requestLogin,
  verifyCode,
  saveSession,
  getLoginAccessStatus,
  requestPasswordChange,
  confirmPasswordChange,
} from '../lib/auth'

const ACCESS_CHECK_MS = 30_000

export default function LoginPage({ onLogin }) {
  const [step, setStep] = useState('credentials')
  const [username, setUsername] = useState(USERNAMES[0])
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingRole, setPendingRole] = useState(null)
  const [access, setAccess] = useState(() => getLoginAccessStatus(username))

  const [changeUsername, setChangeUsername] = useState(USERNAMES[0])
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changeCode, setChangeCode] = useState('')
  const [changeError, setChangeError] = useState('')
  const [changeLoading, setChangeLoading] = useState(false)

  // Horaires d'accès (8h-17h, vendredi fermé) : recalculés au changement
  // d'utilisateur et périodiquement pour couvrir le cas où l'heure bascule
  // pendant que la page de login reste ouverte.
  useEffect(() => {
    setAccess(getLoginAccessStatus(username))
    const id = setInterval(() => setAccess(getLoginAccessStatus(username)), ACCESS_CHECK_MS)
    return () => clearInterval(id)
  }, [username])

  async function handleCredentialsSubmit(e) {
    e.preventDefault()
    if (!access.allowed) return
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
      setPendingRole(result.role)
      setStep('code')
      return
    }
    onLogin(saveSession(username, result.role))
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
    onLogin(saveSession(username, pendingRole))
  }

  function openChangeRequest() {
    setChangeUsername(username)
    setNewPassword('')
    setConfirmNewPassword('')
    setChangeCode('')
    setChangeError('')
    setStep('change-request')
  }

  async function handleChangeRequestSubmit(e) {
    e.preventDefault()
    if (!newPassword || !confirmNewPassword) {
      setChangeError('Les deux champs mot de passe sont obligatoires.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setChangeError('Les mots de passe ne correspondent pas.')
      return
    }
    setChangeError('')
    setChangeLoading(true)
    const result = await requestPasswordChange(changeUsername, newPassword)
    setChangeLoading(false)

    if (!result.success) {
      setChangeError(result.message || 'Erreur lors de la demande.')
      return
    }
    setStep('change-code')
  }

  async function handleChangeCodeSubmit(e) {
    e.preventDefault()
    if (!changeCode) {
      setChangeError('Le code est obligatoire.')
      return
    }
    setChangeError('')
    setChangeLoading(true)
    const result = await confirmPasswordChange(changeUsername, changeCode)
    setChangeLoading(false)

    if (!result.success) {
      setChangeError(result.message || 'Code incorrect ou expiré.')
      return
    }
    setStep('change-done')
  }

  function backToCredentials() {
    setUsername(changeUsername)
    setPassword('')
    setError('')
    setStep('credentials')
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
                disabled={!access.allowed}
              />
            </Field>

            {!access.allowed && (
              <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
                {access.message}
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !access.allowed}
              className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>

            <button type="button" onClick={openChangeRequest} className="text-center text-sm text-ink-muted hover:text-ocre">
              Mot de passe oublié / Changer de mot de passe
            </button>
          </form>
        ) : step === 'code' ? (
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
        ) : step === 'change-request' ? (
          <form onSubmit={handleChangeRequestSubmit} className="flex flex-col gap-4">
            <h2 className="font-display text-lg text-ink">Changer de mot de passe</h2>

            <Field label="Nom d'utilisateur">
              <select value={changeUsername} onChange={(e) => setChangeUsername(e.target.value)} className={inputClass}>
                {USERNAMES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Nouveau mot de passe">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                autoFocus
                required
              />
            </Field>

            <Field label="Confirmer nouveau mot de passe">
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={inputClass}
                required
              />
            </Field>

            {changeError && (
              <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
                {changeError}
              </p>
            )}

            <button
              type="submit"
              disabled={changeLoading}
              className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
            >
              {changeLoading ? 'Envoi…' : 'Demander le changement'}
            </button>

            <button type="button" onClick={backToCredentials} className="text-sm text-ink-muted">
              Retour
            </button>
          </form>
        ) : step === 'change-code' ? (
          <form onSubmit={handleChangeCodeSubmit} className="flex flex-col gap-4">
            <h2 className="font-display text-lg text-ink">Code de validation envoyé à l'administrateur</h2>
            <p className="text-sm text-ink-muted">
              L'administrateur a reçu le mot de passe demandé pour <strong>{changeUsername}</strong>. Demande-lui le
              code de validation pour l'appliquer.
            </p>

            <Field label="Code à 6 chiffres">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={changeCode}
                onChange={(e) => setChangeCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center tracking-[0.5em]`}
                autoFocus
                required
              />
            </Field>

            {changeError && (
              <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
                {changeError}
              </p>
            )}

            <button
              type="submit"
              disabled={changeLoading}
              className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
            >
              {changeLoading ? 'Vérification…' : 'Valider'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('change-request')
                setChangeCode('')
                setChangeError('')
              }}
              className="text-sm text-ink-muted"
            >
              Retour
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg text-ink">Mot de passe mis à jour</h2>
            <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
              Le mot de passe de <strong>{changeUsername}</strong> a bien été changé. Connecte-toi avec le nouveau
              mot de passe.
            </p>
            <button
              type="button"
              onClick={backToCredentials}
              className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover"
            >
              Retour à la connexion
            </button>
          </div>
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
