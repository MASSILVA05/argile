import { useState } from 'react'
import TVAForm from './TVAForm'
import TVARegistry from './TVARegistry'
import TVAImportTab from './TVAImportTab'
import { useAuth } from '../lib/auth'
import { ENTITIES } from '../lib/tvaPayment'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
  { id: 'import', label: 'Import' },
]

export default function TVAPage() {
  const [view, setView] = useState('form')
  const { entity: userEntity, canSeeAllEntities } = useAuth()
  const canChooseEntity = userEntity == null
  const [selectedEntity, setSelectedEntity] = useState(userEntity ?? 'Briqueterie')

  // entityFilter : entité appliquée au registre/export/import -- NULL = pas
  // de filtre (admin ayant choisi "Tout"). formEntity : entité utilisée
  // comme valeur par défaut dans le formulaire de saisie, toujours une
  // valeur concrète ("Tout" n'est pas une entité saisissable).
  const entityFilter = userEntity ?? (selectedEntity === 'Tout' ? null : selectedEntity)
  const formEntity = userEntity ?? (selectedEntity === 'Tout' ? 'Briqueterie' : selectedEntity)

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
              <option key={e} value={e}>
                {e}
              </option>
            ))}
            {canSeeAllEntities && <option value="Tout">Tout</option>}
          </select>
        </div>
      )}

      <nav className="no-print flex gap-2 overflow-x-auto">
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

      {view === 'form' && <TVAForm entity={formEntity} canChooseEntity={canChooseEntity} />}
      {view === 'registry' && <TVARegistry entityFilter={entityFilter} />}
      {view === 'import' && <TVAImportTab entityFilter={entityFilter} />}
    </div>
  )
}
