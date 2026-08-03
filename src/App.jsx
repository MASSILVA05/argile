import { useEffect, useState } from 'react'
import EntryForm from './components/EntryForm'
import Registry from './components/Registry'
import MaintenancePage from './components/MaintenancePage'
import FuelPage from './components/FuelPage'
import BottomNav from './components/BottomNav'
import InstallPrompt from './components/InstallPrompt'
import { getQueue, onQueueChange, flushQueue } from './lib/offlineQueue'

const TITLES = {
  form: 'Suivi de chargement',
  registry: 'Registre de chargement',
  maintenance: 'Maintenance',
  fuel: 'Carburant',
}

function App() {
  const [tab, setTab] = useState('form')
  const [pending, setPending] = useState(getQueue().length)

  useEffect(() => {
    flushQueue()
    return onQueueChange((queue) => setPending(queue.length))
  }, [])

  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-6 pb-24">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-ocre uppercase">SARL DPR AXXAM</p>
          <h1 className="font-display text-2xl font-semibold text-ink">{TITLES[tab]}</h1>
        </div>
        {pending > 0 && (
          <span className="rounded-full border border-ocre px-3 py-1 text-xs whitespace-nowrap text-ocre">
            {pending} en attente de synchro
          </span>
        )}
      </header>

      <main className="rounded-xl border border-border bg-bg-card p-4">
        {tab === 'form' && <EntryForm />}
        {tab === 'registry' && <Registry />}
        {tab === 'maintenance' && <MaintenancePage />}
        {tab === 'fuel' && <FuelPage />}
      </main>

      <BottomNav active={tab} onChange={setTab} />
      <InstallPrompt />
    </div>
  )
}

export default App
