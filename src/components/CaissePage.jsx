import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { computeSolde, formatDA } from '../lib/caisse'
import { useAuth, salesEntityAccessForRole } from '../lib/auth'
import { ENTITIES } from '../lib/tvaPayment'
import CaisseForm from './CaisseForm'
import CaisseRegistry from './CaisseRegistry'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
]

export default function CaissePage() {
  const [view, setView] = useState('form')
  const [solde, setSolde] = useState(null)
  const { role } = useAuth()
  const { fixedEntity, canSeeAllEntities } = salesEntityAccessForRole(role)
  const canChooseEntity = fixedEntity == null
  const [selectedEntity, setSelectedEntity] = useState(fixedEntity ?? 'Briqueterie')

  const entityFilter = fixedEntity ?? (selectedEntity === 'Tout' ? null : selectedEntity)
  const formEntity = fixedEntity ?? (selectedEntity === 'Tout' ? 'Briqueterie' : selectedEntity)

  useEffect(() => {
    let active = true

    async function loadSolde() {
      let query = supabase.from('caisse_entries').select('operation_type, amount')
      if (entityFilter) query = query.eq('entity', entityFilter)
      const { data } = await query
      if (active && data) setSolde(computeSolde(data))
    }

    loadSolde()

    const channel = supabase
      .channel(`caisse-solde-${entityFilter ?? 'all'}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'caisse_entries',
        ...(entityFilter ? { filter: `entity=eq.${entityFilter}` } : {}),
      }, loadSolde)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [entityFilter])

  const positive = solde == null || solde >= 0

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

      <div
        className={`rounded-lg border p-4 ${
          positive ? 'border-green-500/50 bg-green-500/10' : 'border-terracotta/60 bg-terracotta/10'
        }`}
      >
        <p className="text-sm text-ink-muted">Solde caisse</p>
        <p className={`font-display text-2xl ${positive ? 'text-green-500' : 'text-terracotta'}`}>
          {solde == null ? '…' : `${formatDA(solde)} DA`}
        </p>
      </div>

      <nav className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`min-h-11 flex-1 rounded-full border px-4 py-2 font-display transition-colors sm:flex-none ${
              view === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === 'form' ? (
        <CaisseForm entity={formEntity} canChooseEntity={canChooseEntity} />
      ) : (
        <CaisseRegistry entityFilter={entityFilter} />
      )}
    </div>
  )
}
