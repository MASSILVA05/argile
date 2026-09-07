import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA, formatQty, toNum } from '../lib/prodnet'
import { downloadMatiereHistoryExcel } from '../lib/prodnetExcel'
import { printRegistry } from '../lib/printRegistry'

function fmtDateFR(iso) {
  const [y, m, d] = String(iso ?? '').split('-')
  return d && m && y ? `${d}/${m}/${y}` : String(iso ?? '')
}

// Contenu partagé « historique d'utilisation d'une matière première » :
// utilisé par le sous-onglet Prodnet > Historique et par la modale-raccourci
// dans ProdnetMatieres.
export default function MatiereHistory({ matiere, showInfoLine = true }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('prodnet_fabrications')
        .select('id, entry_date, product_reference, product_designation, matieres, entered_by_user')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }
      const desig = String(matiere.designation).trim().toLowerCase()
      const out = []
      for (const fab of data ?? []) {
        const mats = Array.isArray(fab.matieres) ? fab.matieres : []
        const hit = mats.find(
          (m) => m.matiere_id === matiere.id || String(m.designation ?? '').trim().toLowerCase() === desig
        )
        if (!hit) continue
        const qte = toNum(hit.quantite_utilisee)
        const pu = toNum(hit.prix_unitaire)
        out.push({
          id: fab.id,
          entry_date: fab.entry_date,
          product_reference: fab.product_reference ?? '',
          product_designation: fab.product_designation ?? '',
          quantite_utilisee: qte,
          prix_unitaire: pu,
          total: toNum(hit.total) || qte * pu,
          entered_by_user: fab.entered_by_user ?? '',
        })
      }
      setRows(out)
      setError('')
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [matiere.id, matiere.designation])

  const totalQte = rows.reduce((s, r) => s + r.quantite_utilisee, 0)
  const totalMontant = rows.reduce((s, r) => s + r.total, 0)

  const byMonth = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const key = String(r.entry_date ?? '').slice(0, 7)
      if (!key) continue
      map.set(key, (map.get(key) || 0) + r.quantite_utilisee)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12)
  }, [rows])
  const maxMonth = Math.max(1, ...byMonth.map(([, v]) => v))

  function handlePrint() {
    printRegistry({
      subtitle: `Historique d'utilisation — ${matiere.designation}`,
      orientation: 'landscape',
      filters: `Stock actuel : ${formatQty(matiere.quantite)} ${matiere.unite || ''} · Prix moyen : ${formatDA(matiere.prix_moyen)} DA · Valeur totale : ${formatDA(matiere.valeur_totale)} DA`,
      columns: [
        { key: 'entry_date', label: 'Date fabrication', format: fmtDateFR },
        { key: 'product_reference', label: 'Réf. produit' },
        { key: 'product_designation', label: 'Produit fabriqué' },
        { key: 'quantite_utilisee', label: 'Qté utilisée', align: 'right', format: (v) => formatQty(v) },
        { key: 'prix_unitaire', label: 'Prix unitaire (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'total', label: 'Total (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'entered_by_user', label: 'Saisi par' },
      ],
      rows,
      totals: [{ entry_date: 'TOTAUX', quantite_utilisee: totalQte, total: totalMontant }],
    })
  }

  async function handleExcel() {
    setBusy(true)
    try {
      await downloadMatiereHistoryExcel(matiere, rows)
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {showInfoLine && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-bg-soft px-4 py-3 sm:grid-cols-4">
          <Info label="Désignation" value={matiere.designation} />
          <Info label="Stock actuel" value={`${formatQty(matiere.quantite)} ${matiere.unite || ''}`} danger={toNum(matiere.quantite) === 0} />
          <Info label="Prix moyen" value={`${formatDA(matiere.prix_moyen)} DA`} />
          <Info label="Valeur totale" value={`${formatDA(matiere.valeur_totale)} DA`} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={handlePrint} disabled={rows.length === 0} className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-display text-ink-muted hover:border-ink-muted disabled:opacity-50">
          Imprimer
        </button>
        <button type="button" onClick={handleExcel} disabled={busy || rows.length === 0} className="min-h-10 rounded-lg border border-ocre px-3 py-2 text-sm font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
          {busy ? 'Génération…' : 'Exporter Excel'}
        </button>
      </div>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-ink-muted">Cette matière n'a jamais été utilisée dans une fabrication.</p>
      ) : (
        <>
          {byMonth.length > 1 && (
            <div>
              <p className="mb-1 text-xs text-ink-muted">Utilisation par mois (12 derniers)</p>
              <div className="flex items-end gap-1 rounded-lg border border-border bg-bg-soft p-3" style={{ height: 110 }}>
                {byMonth.map(([month, v]) => (
                  <div key={month} className="flex flex-1 flex-col items-center gap-0.5">
                    <span className="text-[9px] text-ink-muted">{formatQty(v)}</span>
                    <div className="w-full rounded-t bg-ocre" style={{ height: `${Math.max(3, (v / maxMonth) * 70)}px` }} title={`${month} : ${formatQty(v)}`} />
                    <span className="text-[9px] text-ink-muted">{month.slice(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <th className="px-2 py-1.5">Date fabrication</th>
                  <th className="px-2 py-1.5">Produit fabriqué</th>
                  <th className="px-2 py-1.5 text-right">Qté utilisée</th>
                  <th className="px-2 py-1.5 text-right">Prix unitaire</th>
                  <th className="px-2 py-1.5 text-right">Total (DA)</th>
                  <th className="px-2 py-1.5">Saisi par</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{fmtDateFR(r.entry_date)}</td>
                    <td className="px-2 py-1.5">{r.product_reference ? `${r.product_designation} [${r.product_reference}]` : r.product_designation}</td>
                    <td className="px-2 py-1.5 text-right">{formatQty(r.quantite_utilisee)}</td>
                    <td className="px-2 py-1.5 text-right">{formatDA(r.prix_unitaire)}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{formatDA(r.total)}</td>
                    <td className="px-2 py-1.5">{r.entered_by_user || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-2 py-1.5">TOTAUX ({rows.length} fabrication{rows.length > 1 ? 's' : ''})</td>
                  <td></td>
                  <td className="px-2 py-1.5 text-right">{formatQty(totalQte)}</td>
                  <td></td>
                  <td className="px-2 py-1.5 text-right text-ocre">{formatDA(totalMontant)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Info({ label, value, danger }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-sm ${danger ? 'text-terracotta' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
