import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA, formatQty } from '../lib/prodnet'
import MatiereHistory from './MatiereHistory'

export default function ProdnetHistorique() {
  const [matieres, setMatieres] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('prodnet_matieres')
        .select('id, designation, quantite, prix_moyen, valeur_totale, unite')
        .order('designation')
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setMatieres(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const selected = useMemo(
    () => matieres.find((m) => m.id === selectedId) ?? null,
    [matieres, selectedId]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return matieres.slice(0, 30)
    return matieres.filter((m) => m.designation.toLowerCase().includes(q)).slice(0, 30)
  }, [matieres, search])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Choisir une matière première</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par désignation…"
          className="min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta"
        />

        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : error ? (
          <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-bg-soft">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">Aucune matière première ne correspond.</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-bg ${
                    m.id === selectedId ? 'bg-terracotta/10' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={m.designation}>{m.designation}</span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    stock {formatQty(m.quantite)} {m.unite || ''} · {formatDA(m.prix_moyen)} DA
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {selected ? (
        <MatiereHistory key={selected.id} matiere={selected} showInfoLine />
      ) : (
        <p className="text-ink-muted">Sélectionnez une matière première pour voir son historique d'utilisation.</p>
      )}
    </div>
  )
}
