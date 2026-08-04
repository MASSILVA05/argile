import { useState } from 'react'
import MaintenanceForm from './MaintenanceForm'
import MaintenanceRegistry from './MaintenanceRegistry'
import { useAuth } from '../lib/auth'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
]

export default function MaintenancePage() {
  const { isViewer } = useAuth()
  const [view, setView] = useState(isViewer ? 'registry' : 'form')
  const tabs = isViewer ? TABS.filter((t) => t.id !== 'form') : TABS

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`min-h-11 flex-1 rounded-lg border px-4 py-2 font-display transition-colors sm:flex-none ${
              view === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === 'form' && !isViewer ? <MaintenanceForm /> : <MaintenanceRegistry />}
    </div>
  )
}
