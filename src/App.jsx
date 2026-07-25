import { useEffect, useState } from 'react'
import EntryForm from './components/EntryForm'
import Registry from './components/Registry'
import InstallPrompt from './components/InstallPrompt'
import { getQueue, onQueueChange, flushQueue } from './lib/offlineQueue'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
]

function App() {
  const [tab, setTab] = useState('form')
  const [pending, setPending] = useState(getQueue().length)

  useEffect(() => {
    flushQueue()
    return onQueueChange((queue) => setPending(queue.length))
  }, [])

  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-ocre uppercase">SARL DPR AXXAM</p>
          <h1 className="font-display text-2xl font-semibold text-ink">Suivi de chargement</h1>
        </div>
        {pending > 0 && (
          <span className="rounded-full border border-ocre px-3 py-1 text-xs whitespace-nowrap text-ocre">
            {pending} en attente de synchro
          </span>
        )}
      </header>

      <nav className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-11 flex-1 rounded-lg border px-4 py-2 font-display transition-colors sm:flex-none ${
              tab === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="rounded-xl border border-border bg-bg-card p-4">
        {tab === 'form' ? <EntryForm /> : <Registry />}
      </main>

      <InstallPrompt />
    </div>
  )
}

export default App
