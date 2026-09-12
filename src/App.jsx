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
import ResidencePage from './components/ResidencePage'
import StationPage from './components/StationPage'
import ChequesPage from './components/ChequesPage'
import Header from './components/Header'
import SideNav from './components/SideNav'
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
  residence: 'Résidence',
  station: 'Station',
  cheques: 'Suivi Chèques',
}

const SESSION_CHECK_MS = 60_000

function App() {
  const [session, setSession] = useState(() => getSession())
  // Initialisé directement sur la première page autorisée pour ce rôle, pour
  // éviter tout flash d'une page interdite avant qu'un effet ne redirige.
  const [tab, setTab] = useState(() => allowedTabsForRole(getSession()?.role)[0] ?? 'form')
  const [menuOpen, setMenuOpen] = useState(false)
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
    <div className="flex min-h-svh flex-col">
      <Header
        title={TITLES[tab]}
        onMenuClick={() => setMenuOpen(true)}
        session={session}
        now={now}
        pending={pending}
        onLogout={handleLogout}
      />

      <SideNav
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        active={tab}
        onChange={setTab}
        allowedTabs={allowedTabs}
      />

      <div key={tab} className="fade-in mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <main className="rounded-xl border border-border bg-bg-card p-4 shadow-[0_4px_6px_rgba(0,0,0,0.3)]">
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
          {tab === 'residence' && <ResidencePage />}
          {tab === 'station' && <StationPage />}
          {tab === 'cheques' && <ChequesPage />}
        </main>
      </div>

      <InstallPrompt />
    </div>
  )
}

export default App
