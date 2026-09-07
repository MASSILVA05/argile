import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA } from '../lib/residence'
import ResidenceDisponibilite from './ResidenceDisponibilite'
import ResidenceReservations from './ResidenceReservations'
import ResidenceClients from './ResidenceClients'
import ResidenceCaisse from './ResidenceCaisse'

const TABS = [
  { id: 'dispo', label: 'Disponibilité' },
  { id: 'reservations', label: 'Réservations' },
  { id: 'clients', label: 'Clients' },
  { id: 'caisse', label: 'Caisse Résidence' },
]

export default function ResidencePage() {
  const [view, setView] = useState('dispo')
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    let active = true

    async function loadSummary() {
      const [{ data: units }, { data: caisse }] = await Promise.all([
        supabase.from('residence_units').select('statut'),
        supabase.from('residence_caisse').select('operation_type, amount'),
      ])
      if (!active) return
      const total = units?.length ?? 0
      const libres = (units ?? []).filter((u) => u.statut === 'Disponible').length
      const occupes = (units ?? []).filter((u) => u.statut === 'Occupé').length
      const solde = (caisse ?? []).reduce(
        (s, e) => s + (e.operation_type === 'Encaissement' ? 1 : -1) * (Number(e.amount) || 0),
        0
      )
      setSummary({ total, libres, occupes, solde })
    }

    // Rafraîchit les statuts (séjours terminés -> logement libéré, séjour en
    // cours -> Occupé) une fois à l'ouverture de la page, puis charge le résumé.
    supabase.rpc('residence_refresh_statuses').finally(loadSummary)

    const channel = supabase
      .channel('residence-summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_units' }, loadSummary)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_reservations' }, loadSummary)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_caisse' }, loadSummary)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Logements" value={summary == null ? '…' : summary.total} />
        <Card
          label="Disponibles"
          value={summary == null ? '…' : summary.libres}
          tone={summary != null && summary.libres > 0 ? 'good' : null}
        />
        <Card
          label="Occupés"
          value={summary == null ? '…' : summary.occupes}
          tone={summary != null && summary.occupes > 0 ? 'warn' : null}
        />
        <Card
          label="Solde caisse résidence"
          value={summary == null ? '…' : `${formatDA(summary.solde)} DA`}
          tone={summary != null && summary.solde < 0 ? 'warn' : 'good'}
        />
      </div>

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

      {view === 'dispo' && <ResidenceDisponibilite />}
      {view === 'reservations' && <ResidenceReservations />}
      {view === 'clients' && <ResidenceClients />}
      {view === 'caisse' && <ResidenceCaisse />}
    </div>
  )
}

function Card({ label, value, tone }) {
  const cls =
    tone === 'warn'
      ? 'border-terracotta/60 bg-terracotta/10'
      : tone === 'good'
        ? 'border-green-500/50 bg-green-500/10'
        : 'border-border bg-bg-soft'
  const valueCls =
    tone === 'warn' ? 'text-terracotta' : tone === 'good' ? 'text-green-500' : 'text-ink'
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`font-display text-2xl ${valueCls}`}>{value}</p>
    </div>
  )
}
