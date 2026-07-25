import { useEffect, useState } from 'react'

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    function handler(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!deferredPrompt || dismissed) return null

  async function handleInstall() {
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-ocre bg-bg-card px-4 py-3 shadow-lg">
      <p className="text-sm text-ink">Installer l'application DPR Chargement sur cet appareil ?</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={handleInstall}
          className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover"
        >
          Installer
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted"
        >
          Plus tard
        </button>
      </div>
    </div>
  )
}
