import { useEffect, useMemo, useState } from 'react'
import { printRegistry } from '../lib/printRegistry'

// Modale de sélection des lignes à imprimer, réutilisée par tous les registres.
//
// Props = la même config que printRegistry() (title, subtitle, columns, rows,
// totals, filters, orientation) + open / onClose.
//   - columns : [{ key, label|header, align, format }]
//   - rows    : objets déjà prêts pour printRegistry (valeurs brutes ; les
//               colonnes portent leur `format`)
//
// « Imprimer la sélection » -> printRegistry avec seulement les lignes cochées
//   et des totaux recalculés (somme des colonnes alignées à droite).
// « Imprimer tout » -> printRegistry avec toutes les lignes et les totaux
//   d'origine (déjà calculés par le registre).

function cellText(column, row) {
  const raw = row[column.key]
  if (raw == null || raw === '') return ''
  return String(column.format ? column.format(raw) : raw)
}

function autoTotals(columns, rows) {
  if (rows.length === 0 || columns.length === 0) return []
  const totalRow = { [columns[0].key]: 'TOTAUX (sélection)' }
  let hasAny = false
  for (const c of columns.slice(1)) {
    if (c.align !== 'right') continue
    let sum = 0
    let numeric = false
    for (const r of rows) {
      const v = r[c.key]
      if (v == null || v === '') continue
      const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'))
      if (Number.isFinite(n)) {
        sum += n
        numeric = true
      }
    }
    if (numeric) {
      totalRow[c.key] = sum
      hasAny = true
    }
  }
  return hasAny ? [totalRow] : []
}

export default function PrintSelectionModal({
  open,
  onClose,
  title = 'SARL DPR AXXAM BRIQUETERIE',
  subtitle = '',
  columns = [],
  rows = [],
  totals,
  filters,
  orientation = 'landscape',
}) {
  const [checked, setChecked] = useState(() => new Set())
  const [query, setQuery] = useState('')

  // Réinitialise (tout coché) à l'ouverture. `rows` étant recréé à chaque
  // render par le parent, on NE dépend PAS de son identité (sinon boucle de
  // rendu) — seulement de `open` et du nombre de lignes.
  const rowCount = rows.length
  useEffect(() => {
    if (open) {
      setChecked(new Set(Array.from({ length: rowCount }, (_, i) => i)))
      setQuery('')
    }
  }, [open, rowCount])

  const visibleIdx = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = rows.map((_, i) => i)
    if (!q) return all
    return all.filter((i) => columns.some((c) => cellText(c, rows[i]).toLowerCase().includes(q)))
  }, [rows, columns, query])

  if (!open) return null

  const toggle = (i) => {
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const checkAll = () => setChecked(new Set(rows.map((_, i) => i)))
  const uncheckAll = () => setChecked(new Set())

  const selectedRows = rows.filter((_, i) => checked.has(i))

  function printSelection() {
    if (selectedRows.length === 0) return
    printRegistry({
      title,
      subtitle,
      columns,
      rows: selectedRows,
      totals: autoTotals(columns, selectedRows),
      filters: [filters, `${selectedRows.length} ligne(s) sélectionnée(s)`].filter(Boolean).join(' — '),
      orientation,
    })
    onClose()
  }

  function printAll() {
    printRegistry({ title, subtitle, columns, rows, totals, filters, orientation })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col bg-bg-card p-5 sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-4xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Imprimer — {subtitle || title}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer les lignes…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <button type="button" onClick={checkAll} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:border-ink-muted">
            Tout cocher
          </button>
          <button type="button" onClick={uncheckAll} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:border-ink-muted">
            Tout décocher
          </button>
          <span className="text-sm text-ink-muted">
            {checked.size} / {rows.length} ligne(s) sélectionnée(s)
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-[11px] sm:text-sm">
            <thead className="sticky top-0 bg-bg-soft">
              <tr className="border-b border-border text-left text-ink-muted">
                <th className="w-10 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={visibleIdx.length > 0 && visibleIdx.every((i) => checked.has(i))}
                    onChange={(e) => {
                      setChecked((cur) => {
                        const next = new Set(cur)
                        for (const i of visibleIdx) e.target.checked ? next.add(i) : next.delete(i)
                        return next
                      })
                    }}
                    className="h-4 w-4 accent-terracotta"
                  />
                </th>
                {columns.map((c) => (
                  <th key={c.key} className={`px-2 py-2 font-display font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.label ?? c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleIdx.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="px-3 py-4 text-center text-ink-muted">Aucune ligne.</td></tr>
              ) : (
                visibleIdx.map((i) => (
                  <tr
                    key={i}
                    onClick={() => toggle(i)}
                    className={`cursor-pointer border-b border-border last:border-0 hover:bg-bg-soft ${checked.has(i) ? 'bg-terracotta/10' : ''}`}
                  >
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-terracotta" />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''} max-w-[240px] truncate`} title={cellText(c, rows[i])}>
                        {cellText(c, rows[i])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm text-ink-muted hover:border-ink-muted">
            Annuler
          </button>
          <button type="button" onClick={printAll} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
            Imprimer tout ({rows.length})
          </button>
          <button
            type="button"
            onClick={printSelection}
            disabled={checked.size === 0}
            className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
          >
            Imprimer la sélection ({checked.size})
          </button>
        </div>
      </div>
    </div>
  )
}
