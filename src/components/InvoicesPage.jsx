import { useState } from 'react'
import InvoiceForm from './InvoiceForm'
import InvoiceRegistry from './InvoiceRegistry'
import AdvancesTab from './AdvancesTab'
import StockTab from './StockTab'
import StockMovementsTab from './StockMovementsTab'
import ClientBalancesModal from './ClientBalancesModal'
import ImportG50Tab from './ImportG50Tab'
import GenerateG50Tab from './GenerateG50Tab'
import { useAuth, salesEntityAccessForRole } from '../lib/auth'
import { ENTITIES } from '../lib/tvaPayment'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
  { id: 'advances', label: 'Avances' },
  { id: 'stock', label: 'Stock' },
  { id: 'movements', label: 'Mouvements' },
  { id: 'import-g50', label: 'Import G50' },
  { id: 'generate-g50', label: 'Générer G50' },
]

// Youcef (youcef_role) n'a accès qu'à Factures parmi les pages "avancées" de
// ce module, et seulement pour la saisie + consultation -- pas Avances/Stock/
// Mouvements/G50 (voir ROLE_TABS dans src/lib/auth.js).
const RESTRICTED_TABS = TABS.filter((t) => t.id === 'form' || t.id === 'registry')

export default function InvoicesPage() {
  const { isYoucefRole, role } = useAuth()
  const tabs = isYoucefRole ? RESTRICTED_TABS : TABS
  const [view, setView] = useState('form')
  const [balancesOpen, setBalancesOpen] = useState(false)
  const { fixedEntity, canSeeAllEntities } = salesEntityAccessForRole(role)
  const canChooseEntity = fixedEntity == null
  const [selectedEntity, setSelectedEntity] = useState(fixedEntity ?? 'Briqueterie')

  // entityFilter : entité appliquée au registre/export -- NULL = pas de
  // filtre (admin ayant choisi "Tout"). formEntity : entité utilisée comme
  // valeur par défaut/fixe dans le formulaire de saisie (jamais "Tout").
  const entityFilter = fixedEntity ?? (selectedEntity === 'Tout' ? null : selectedEntity)
  const formEntity = fixedEntity ?? (selectedEntity === 'Tout' ? 'Briqueterie' : selectedEntity)

  return (
    <div className="flex flex-col gap-4">
      {canChooseEntity && (
        <div className="no-print flex items-center gap-2">
          <span className="text-sm text-ink-muted">Entité :</span>
          <select
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            {ENTITIES.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
            {canSeeAllEntities && <option value="Tout">Tout</option>}
          </select>
        </div>
      )}

      <div className="no-print flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex gap-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`min-h-11 flex-1 shrink-0 rounded-full border px-4 py-2 font-display transition-colors sm:flex-none ${
                view === t.id
                  ? 'border-terracotta bg-terracotta text-ink'
                  : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {!isYoucefRole && (
          <button
            type="button"
            onClick={() => setBalancesOpen(true)}
            className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Voir tous les soldes
          </button>
        )}
      </div>

      {view === 'form' && <InvoiceForm entity={formEntity} canChooseEntity={canChooseEntity} />}
      {view === 'registry' && <InvoiceRegistry entityFilter={entityFilter} />}
      {!isYoucefRole && view === 'advances' && <AdvancesTab />}
      {!isYoucefRole && view === 'stock' && <StockTab />}
      {!isYoucefRole && view === 'movements' && <StockMovementsTab />}
      {!isYoucefRole && view === 'import-g50' && <ImportG50Tab />}
      {!isYoucefRole && view === 'generate-g50' && <GenerateG50Tab />}

      {!isYoucefRole && <ClientBalancesModal open={balancesOpen} onClose={() => setBalancesOpen(false)} />}
    </div>
  )
}
