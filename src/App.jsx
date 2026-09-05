import { useEffect, useMemo, useState } from 'react'
import EntryForm from './components/EntryForm'
import Registry from './components/Registry'
import MaintenancePage from './components/MaintenancePage'
import ProductionPage from './components/ProductionPage'
import ProdnetPage from './components/ProdnetPage'
import FuelPage from './components/FuelPage'
import SandPage from './components/SandPage'
import InvoicesPage from './components/InvoicesPage'
import TVAPage from './components/TVAPage'
import TVAPayerPage from './components/TVAPayerPage'
import CaissePage from './components/CaissePage'
import MagasinPage from './components/MagasinPage'
import BottomNav from './components/BottomNav'
import InstallPrompt from './components/InstallPrompt'
import LoginPage from './components/LoginPage'
import { getSession, clearSession, allowedTabsForRole } from './lib/auth'
import { getQueue, onQueueChange, flushQueue } from './lib/offlineQueue'

const TITLES = {
  form: 'Suivi de chargement',
  registry: 'Registre de chargement',
  maintenance: 'Maintenance',
  production: 'Production',
  prodnet: 'Prodnet',
  fuel: 'Carburant',
  sand: 'Sable',
  invoices: 'Factures',
  tva: 'Récupération TVA',
  'tva-payer': 'TVA à payer',
  caisse: 'Caisse',
  magasin: 'Magasin Bejaia',
}

const SESSION_CHECK_MS = 60_000

function formatRemaining(expiresAt, now) {
  const ms = expiresAt - now
  if (ms <= 0) return 'expirée'
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h${String(minutes).padStart(2, '0')}`
}

function App() {
  const [session, setSession] = useState(() => getSession())
  // Initialisé directement sur la première page autorisée pour ce rôle, pour
  // éviter tout flash d'une page interdite avant qu'un effet ne redirige.
  const [tab, setTab] = useState(() => allowedTabsForRole(getSession()?.role)[0] ?? 'form')
  const [pending, setPending] = useState(getQueue().length)
  const [now, setNow] = useState(() => Date.now())

  const allowedTabs = useMemo(() => allowedTabsForRole(session?.role), [session?.role])

  // Filet de sécurité : si le rôle change (nouvelle connexion) ou si `tab`
  // pointe vers une page non autorisée, revient à la première page accessible.
  useEffect(() => {
    if (session && !allowedTabs.includes(tab)) {
      setTab(allowedTabs[0])
    }
  }, [session, allowedTabs, tab])

  useEffect(() => {
    if (!session) return
    flushQueue()
    return onQueueChange((queue) => setPending(queue.length))
  }, [session])

  // Session valable jusqu'à 17h (Algérie) du jour en cours : à chaque tick, si
  // la session en localStorage a expiré (getSession() la supprime elle-même
  // dans ce cas), on déconnecte et on revient à l'écran de login.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
      if (!getSession()) setSession(null)
    }, SESSION_CHECK_MS)
    return () => clearInterval(id)
  }, [])

  if (!session) {
    return <LoginPage onLogin={setSession} />
  }

  function handleLogout() {
    clearSession()
    setSession(null)
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-6 pb-24">
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
            <span className="whitespace-nowrap">Session : {formatRemaining(session.expiresAt, now)}</span>
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
        {tab === 'form' && <EntryForm />}
        {tab === 'registry' && <Registry />}
        {tab === 'maintenance' && <MaintenancePage />}
        {tab === 'production' && <ProductionPage />}
        {tab === 'prodnet' && <ProdnetPage />}
        {tab === 'fuel' && <FuelPage />}
        {tab === 'sand' && <SandPage />}
        {tab === 'invoices' && <InvoicesPage />}
        {tab === 'tva' && <TVAPage />}
        {tab === 'tva-payer' && <TVAPayerPage />}
        {tab === 'caisse' && <CaissePage />}
        {tab === 'magasin' && <MagasinPage />}
      </main>

      <BottomNav active={tab} onChange={setTab} allowedTabs={allowedTabs} />
      <InstallPrompt />
    </div>
  )
}

export default App
