import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mcComputeSolde, mcFormatDA } from '../lib/magasinCaisse'
import MagasinCaisseForm from './MagasinCaisseForm'
import MagasinCaisseRegistry from './MagasinCaisseRegistry'

const TABS = [
  { id: 'form', label: 'Saisie' },
  { id: 'registry', label: 'Registre' },
]

export default function MagasinCaisse() {
  const [view, setView] = useState('form')
  const [solde, setSolde] = useState(null)

  useEffect(() => {
    let active = true

    async function loadSolde() {
      const { data } = await supabase.from('magasin_caisse').select('operation_type, amount')
      if (active && data) setSolde(mcComputeSolde(data))
    }

    loadSolde()

    const channel = supabase
      .channel('magasin-caisse-solde')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_caisse' }, loadSolde)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const positive = solde == null || solde >= 0

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`rounded-lg border p-4 ${
          positive ? 'border-green-500/50 bg-green-500/10' : 'border-terracotta/60 bg-terracotta/10'
        }`}
      >
        <p className="text-sm text-ink-muted">Solde caisse magasin</p>
        <p className={`font-display text-2xl ${positive ? 'text-green-500' : 'text-terracotta'}`}>
          {solde == null ? '…' : `${mcFormatDA(solde)} DA`}
        </p>
      </div>

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

      {view === 'form' ? <MagasinCaisseForm /> : <MagasinCaisseRegistry />}
    </div>
  )
}
