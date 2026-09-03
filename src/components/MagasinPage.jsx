import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA, isLowStock } from '../lib/magasin'
import MagasinStock from './MagasinStock'
import MagasinVentes from './MagasinVentes'
import MagasinAchats from './MagasinAchats'
import MagasinCredits from './MagasinCredits'
import MagasinImport from './MagasinImport'

const TABS = [
  { id: 'stock', label: 'Stock' },
  { id: 'ventes', label: 'Ventes' },
  { id: 'achats', label: 'Achats' },
  { id: 'credits', label: 'Crédits clients' },
  { id: 'import', label: 'Import' },
]

export default function MagasinPage() {
  const [view, setView] = useState('stock')
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    let active = true

    async function loadSummary() {
      const [{ data: stock }, { data: clients }] = await Promise.all([
        supabase.from('magasin_stock').select('quantite, stock_min'),
        supabase.from('magasin_clients').select('credit'),
      ])
      if (!active) return
      const articles = stock?.length ?? 0
      const alerts = (stock ?? []).filter(isLowStock).length
      const creances = (clients ?? [])
        .map((c) => Number(c.credit) || 0)
        .filter((v) => v < 0)
        .reduce((s, v) => s + v, 0)
      setSummary({ articles, alerts, creances: Math.abs(creances) })
    }

    loadSummary()

    const channel = supabase
      .channel('magasin-summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_stock' }, loadSummary)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_clients' }, loadSummary)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card label="Articles en stock" value={summary == null ? '…' : summary.articles} />
        <Card
          label="Alertes stock bas"
          value={summary == null ? '…' : summary.alerts}
          danger={summary != null && summary.alerts > 0}
        />
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

      {view === 'stock' && <MagasinStock />}
      {view === 'ventes' && <MagasinVentes />}
      {view === 'achats' && <MagasinAchats />}
      {view === 'credits' && <MagasinCredits />}
      {view === 'import' && <MagasinImport />}
    </div>
  )
}

function Card({ label, value, danger }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        danger ? 'border-terracotta/60 bg-terracotta/10' : 'border-border bg-bg-soft'
      }`}
    >
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`font-display text-2xl ${danger ? 'text-terracotta' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
