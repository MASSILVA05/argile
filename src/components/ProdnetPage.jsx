import { useState } from 'react'
import ProdnetProducts from './ProdnetProducts'
import ProdnetMatieres from './ProdnetMatieres'
import ProdnetFabrication from './ProdnetFabrication'
import ProdnetImport from './ProdnetImport'

const TABS = [
  { id: 'products', label: 'Produits Finis' },
  { id: 'matieres', label: 'Matières Premières' },
  { id: 'fabrication', label: 'Fabrication' },
  { id: 'import', label: 'Import' },
]

export default function ProdnetPage() {
  const [view, setView] = useState('products')

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

      {view === 'products' && <ProdnetProducts />}
      {view === 'matieres' && <ProdnetMatieres />}
      {view === 'fabrication' && <ProdnetFabrication />}
      {view === 'import' && <ProdnetImport />}
    </div>
  )
}
