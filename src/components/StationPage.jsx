import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA } from '../lib/station'
import StationCarburant from './StationCarburant'
import StationLubrifiants from './StationLubrifiants'
import StationGaz from './StationGaz'
import StationCompteurs from './StationCompteurs'
import StationRecap from './StationRecap'
import StationSalaires from './StationSalaires'
import StationImport from './StationImport'

const TABS = [
  { id: 'carburant', label: 'Carburant' },
  { id: 'lubrifiants', label: 'Lubrifiants' },
  { id: 'gaz', label: 'Gaz' },
  { id: 'compteurs', label: 'Compteurs' },
  { id: 'recap', label: 'Récapitulatif' },
  { id: 'salaires', label: 'Salaires' },
  { id: 'import', label: 'Import' },
]

export default function StationPage() {
  const [view, setView] = useState('carburant')
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    let active = true

    async function loadSummary() {
      const { data: clients } = await supabase
        .from('station_clients')
        .select('total_carburant, total_lubrifiants, total_gaz, balance')
      if (!active) return
      const sum = (key) => (clients ?? []).reduce((s, c) => s + (Number(c[key]) || 0), 0)
      setSummary({
        carburant: sum('total_carburant'),
        lubrifiants: sum('total_lubrifiants'),
        gaz: sum('total_gaz'),
        creances: sum('balance'),
      })
    }

    loadSummary()

    const channel = supabase
      .channel('station-summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_clients' }, loadSummary)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Ventes carburant" value={summary == null ? '…' : `${formatDA(summary.carburant)} DA`} />
        <Card label="Ventes lubrifiants" value={summary == null ? '…' : `${formatDA(summary.lubrifiants)} DA`} />
        <Card label="Ventes gaz" value={summary == null ? '…' : `${formatDA(summary.gaz)} DA`} />
        <Card
          label="Créances clients"
          value={summary == null ? '…' : `${formatDA(summary.creances)} DA`}
          danger={summary != null && summary.creances > 0}
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

      {view === 'carburant' && <StationCarburant />}
      {view === 'lubrifiants' && <StationLubrifiants />}
      {view === 'gaz' && <StationGaz />}
      {view === 'compteurs' && <StationCompteurs />}
      {view === 'recap' && <StationRecap />}
      {view === 'salaires' && <StationSalaires />}
      {view === 'import' && <StationImport />}
    </div>
  )
}

function Card({ label, value, danger }) {
  return (
    <div className={`rounded-lg border p-4 ${danger ? 'border-terracotta/60 bg-terracotta/10' : 'border-border bg-bg-soft'}`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`font-display text-2xl ${danger ? 'text-terracotta' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
