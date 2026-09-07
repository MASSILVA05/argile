import { useState } from 'react'
import { formatDA, formatQty, toNum } from '../lib/prodnet'

// Sélecteur de matières premières réutilisable (formulaire de fabrication,
// édition de constitution, édition des matières d'une fabrication).
//
// - la liste COMPLÈTE est toujours visible avec cases à cocher
// - la recherche FILTRE la partie non cochée (ne la remplace pas)
// - les matières déjà cochées restent épinglées EN HAUT, même en filtrant
// - liste scrollable (max-height 300px)
// - chaque ligne : checkbox + désignation + stock disponible + prix moyen
//
// props :
//   catalogue   : [{ id, designation, quantite, prix_moyen, unite }]
//   isSelected  : (id) => boolean
//   onToggle    : (id, checked) => void
//   stockOf     : (matiere) => number   (optionnel ; défaut matiere.quantite)
export default function MatieresPicker({ catalogue = [], isSelected, onToggle, stockOf }) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const stock = stockOf || ((m) => m.quantite)

  const checked = []
  const unchecked = []
  for (const m of catalogue) {
    if (isSelected(m.id)) checked.push(m)
    else if (!q || m.designation.toLowerCase().includes(q)) unchecked.push(m)
  }

  function Row(m) {
    const sel = isSelected(m.id)
    return (
      <label
        key={m.id}
        className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-bg ${
          sel ? 'bg-terracotta/10' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={sel}
          onChange={(e) => onToggle(m.id, e.target.checked)}
          className="h-4 w-4 shrink-0 accent-terracotta"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-ink" title={m.designation}>
          {m.designation}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          stock {formatQty(toNum(stock(m)))}{m.unite ? ` ${m.unite}` : ''} · {formatDA(m.prix_moyen)} DA
        </span>
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher une matière…"
        className="min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta"
      />
      <div className="overflow-y-auto rounded-lg border border-border bg-bg-soft" style={{ maxHeight: 300 }}>
        {checked.length > 0 && (
          <>
            <p className="sticky top-0 z-10 border-b border-border bg-bg-soft px-3 py-1 text-xs font-medium text-ink-muted">
              Sélectionnées ({checked.length})
            </p>
            {checked.map(Row)}
          </>
        )}
        {checked.length === 0 && unchecked.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-muted">Aucune matière première ne correspond.</p>
        ) : (
          <>
            {checked.length > 0 && unchecked.length > 0 && (
              <p className="border-b border-border bg-bg-soft px-3 py-1 text-xs font-medium text-ink-muted">Autres</p>
            )}
            {unchecked.map(Row)}
          </>
        )}
      </div>
    </div>
  )
}
