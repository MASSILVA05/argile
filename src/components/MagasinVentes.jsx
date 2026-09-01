import { useState } from 'react'
import MagasinVenteForm from './MagasinVenteForm'
import MagasinVentesRegistry from './MagasinVentesRegistry'

const TABS = [
  { id: 'form', label: 'Nouvelle vente' },
  { id: 'registry', label: 'Registre des ventes' },
]

export default function MagasinVentes() {
  const [view, setView] = useState('form')

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2">
        {TABS.map((t) => (
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

      {view === 'form' ? <MagasinVenteForm /> : <MagasinVentesRegistry />}
    </div>
  )
}
