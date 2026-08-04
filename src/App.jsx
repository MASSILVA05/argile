import { useEffect, useState } from 'react'
import EntryForm from './components/EntryForm'
import Registry from './components/Registry'
import MaintenancePage from './components/MaintenancePage'
import FuelPage from './components/FuelPage'
import BottomNav from './components/BottomNav'
import InstallPrompt from './components/InstallPrompt'
import LoginPage from './components/LoginPage'
import Watermark from './components/Watermark'
import { getSession, clearSession, useAuth } from './lib/auth'
import { getQueue, onQueueChange, flushQueue } from './lib/offlineQueue'

const TITLES = {
  form: 'Suivi de chargement',
  registry: 'Registre de chargement',
  maintenance: 'Maintenance',
  fuel: 'Carburant',
}

function App() {
  const [session, setSession] = useState(() => getSession())
  const [tab, setTab] = useState(() => (getSession()?.role === 'viewer' ? 'registry' : 'form'))
  const [pending, setPending] = useState(getQueue().length)
  const { isViewer } = useAuth()

  useEffect(() => {
    if (!session) return
    flushQueue()
    return onQueueChange((queue) => setPending(queue.length))
  }, [session])

  useEffect(() => {
    document.body.classList.toggle('viewer-mode', isViewer)
    return () => document.body.classList.remove('viewer-mode')
  }, [isViewer])

  useEffect(() => {
    if (isViewer && tab === 'form') setTab('registry')
  }, [isViewer, tab])

  if (!session) {
    return <LoginPage onLogin={setSession} />
  }

  function handleLogout() {
    clearSession()
    setSession(null)
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-6 pb-24">
      {isViewer && <Watermark username={session.username} />}

      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-ocre uppercase">SARL DPR AXXAM</p>
          <h1 className="font-display text-2xl font-semibold text-ink">{TITLES[tab]}</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          {pending > 0 && (
            <span className="rounded-full border border-ocre px-3 py-1 text-xs whitespace-nowrap text-ocre">
              {pending} en attente de synchro
            </span>
          )}
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span>{session.username}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded border border-border px-2 py-1 hover:border-terracotta hover:text-terracotta"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="rounded-xl border border-border bg-bg-card p-4">
        {tab === 'form' && !isViewer && <EntryForm />}
        {tab === 'registry' && <Registry />}
        {tab === 'maintenance' && <MaintenancePage />}
        {tab === 'fuel' && <FuelPage />}
      </main>

      <BottomNav active={tab} onChange={setTab} hideForm={isViewer} />
      <InstallPrompt />
    </div>
  )
}

export default App
