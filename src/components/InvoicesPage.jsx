import { useState } from 'react'
import InvoiceForm from './InvoiceForm'
import InvoiceRegistry from './InvoiceRegistry'
import AdvancesTab from './AdvancesTab'
import StockTab from './StockTab'
import StockMovementsTab from './StockMovementsTab'
import ClientBalancesModal from './ClientBalancesModal'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
  { id: 'advances', label: 'Avances' },
  { id: 'stock', label: 'Stock' },
  { id: 'movements', label: 'Mouvements' },
]

export default function InvoicesPage() {
  const [view, setView] = useState('form')
  const [balancesOpen, setBalancesOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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

        <button
          type="button"
          onClick={() => setBalancesOpen(true)}
          className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
        >
          Voir tous les soldes
        </button>
      </div>

      {view === 'form' && <InvoiceForm />}
      {view === 'registry' && <InvoiceRegistry />}
      {view === 'advances' && <AdvancesTab />}
      {view === 'stock' && <StockTab />}
      {view === 'movements' && <StockMovementsTab />}

      <ClientBalancesModal open={balancesOpen} onClose={() => setBalancesOpen(false)} />
    </div>
  )
}
