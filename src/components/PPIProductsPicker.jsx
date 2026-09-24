import { useState } from 'react'
import { formatEUR, formatQty, productQtyRestante } from '../lib/ppi'

// Sélecteur multi-produits PPI (formulaire de saisie) -- même comportement
// que MatieresPicker (Prodnet) : liste complète à cocher, recherche filtre
// la partie non cochée, sélection épinglée en haut, liste scrollable.
//
// props :
//   catalogue  : [ppi_products du pays sélectionné]
//   isSelected : (id) => boolean
//   onToggle   : (id, checked) => void
export default function PPIProductsPicker({ catalogue = [], isSelected, onToggle }) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

  const matches = (p) =>
    !q || p.designation.toLowerCase().includes(q) || (p.position_tarifaire ?? '').toLowerCase().includes(q)

  const checked = []
  const unchecked = []
  for (const p of catalogue) {
    if (isSelected(p.id)) checked.push(p)
    else if (matches(p)) unchecked.push(p)
  }

  function Row(p) {
    const sel = isSelected(p.id)
    const reste = productQtyRestante(p)
    return (
      <label
        key={p.id}
        className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-bg ${
          sel ? 'bg-terracotta/10' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={sel}
          onChange={(e) => onToggle(p.id, e.target.checked)}
          className="h-4 w-4 shrink-0 accent-terracotta"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-ink" title={p.designation}>
          {p.designation} <span className="text-ink-muted">[{p.position_tarifaire}]</span>
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          {formatEUR(p.prix_unitaire)} € · reste {formatQty(reste)}
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
        placeholder="Rechercher un produit (désignation ou position tarifaire)…"
        className="min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta"
      />
      <div className="overflow-y-auto rounded-lg border border-border bg-bg-soft" style={{ maxHeight: 300 }}>
        {checked.length > 0 && (
          <>
            <p className="sticky top-0 z-10 border-b border-border bg-bg-soft px-3 py-1 text-xs font-medium text-ink-muted">
              Sélectionnés ({checked.length})
            </p>
            {checked.map(Row)}
          </>
        )}
        {checked.length === 0 && unchecked.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-muted">Aucun produit ne correspond.</p>
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
