import { useState } from 'react'
import ProductionForm from './ProductionForm'
import ProductionRegistry from './ProductionRegistry'
import ProductionDashboard from './ProductionDashboard'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
  { id: 'dashboard', label: 'Tableau de bord' },
]

export default function ProductionPage() {
  const [view, setView] = useState('form')

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`min-h-11 flex-1 shrink-0 rounded-lg border px-4 py-2 font-display transition-colors sm:flex-none ${
              view === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === 'form' && <ProductionForm />}
      {view === 'registry' && <ProductionRegistry />}
      {view === 'dashboard' && <ProductionDashboard />}
    </div>
  )
}
