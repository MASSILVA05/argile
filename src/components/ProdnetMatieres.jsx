import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MATIERE_UNITES, formatDA, formatQty, toNum } from '../lib/prodnet'
import { downloadProdnetMatieresExcel, downloadMatiereHistoryExcel } from '../lib/prodnetExcel'
import { printRegistry } from '../lib/printRegistry'
import PrintSelectionModal from './PrintSelectionModal'

function fmtDateFR(iso) {
  const [y, m, d] = String(iso ?? '').split('-')
  return d && m && y ? `${d}/${m}/${y}` : String(iso ?? '')
}

const emptyDraft = { designation: '', position_tarifaire: '', unite: 'U', quantite: '', prix_moyen: '', valeur_totale: '' }

function toPayload(draft) {
  const quantite = toNum(draft.quantite)
  const prix = toNum(draft.prix_moyen)
  const valeur = draft.valeur_totale === '' || draft.valeur_totale == null ? quantite * prix : toNum(draft.valeur_totale)
  return {
    designation: draft.designation.trim(),
    position_tarifaire: draft.position_tarifaire.trim() || null,
    unite: draft.unite.trim() || 'U',
    quantite,
    prix_moyen: prix,
    valeur_totale: valeur,
  }
}

export default function ProdnetMatieres() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [historyMatiere, setHistoryMatiere] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase.from('prodnet_matieres').select('*').order('designation')
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setRows(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('prodnet-matieres')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prodnet_matieres' }, (payload) => {
        setRows((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (onlyEmpty && toNum(r.quantite) !== 0) return false
      if (!q) return true
      return [r.designation, r.position_tarifaire].some((f) => String(f ?? '').toLowerCase().includes(q))
    })
  }, [rows, query, onlyEmpty])

  const emptyCount = rows.filter((r) => toNum(r.quantite) === 0).length

  async function handleAdd() {
    if (!addDraft.designation.trim()) {
      setError('La désignation est obligatoire.')
      return
    }
    const { data, error: insertError } = await supabase.from('prodnet_matieres').insert(toPayload(addDraft)).select().single()
    if (insertError) {
      setError(`Erreur d'ajout : ${insertError.message}`)
      return
    }
    setRows((current) => [...current, data].sort((a, b) => a.designation.localeCompare(b.designation)))
    setAdding(false)
    setAddDraft(emptyDraft)
    setError('')
  }

  function startEdit(row) {
    setEditingId(row.id)
    setEditDraft({
      designation: row.designation ?? '',
      position_tarifaire: row.position_tarifaire ?? '',
      unite: row.unite ?? 'U',
      quantite: row.quantite ?? '',
      prix_moyen: row.prix_moyen ?? '',
      valeur_totale: row.valeur_totale ?? '',
    })
  }

  async function saveEdit() {
    if (!editDraft.designation.trim()) {
      setError('La désignation est obligatoire.')
      return
    }
    const { data, error: updateError } = await supabase
      .from('prodnet_matieres')
      .update(toPayload(editDraft))
      .eq('id', editingId)
      .select()
      .single()
    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setRows((current) => current.map((r) => (r.id === data.id ? data : r)))
    setEditingId(null)
    setEditDraft(null)
    setError('')
  }

  async function handleDelete(row) {
    if (!window.confirm(`Supprimer la matière première « ${row.designation} » ?`)) return
    const { error: rpcError } = isAdmin
      ? await supabase.rpc('admin_delete_prodnet_matiere', {
          p_id: row.id,
          p_admin_code: window.prompt('Code administrateur :') ?? '',
        })
      : await supabase.from('prodnet_matieres').delete().eq('id', row.id)
    if (rpcError) {
      setError(`Erreur de suppression : ${rpcError.message}`)
      return
    }
    setRows((current) => current.filter((r) => r.id !== row.id))
    setError('')
  }

  async function handleDeleteAll() {
    if (!isAdmin) return
    if (!window.confirm(
      `Supprimer TOUTES les matières premières (${rows.length}) ?\n\nCette action est irréversible. Utile pour ré-importer un stock à jour.`
    )) return
    const code = window.prompt('Code administrateur :') ?? ''
    if (!code) return
    const { error: rpcError } = await supabase.rpc('admin_delete_all_prodnet_matieres', { p_admin_code: code })
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    setRows([])
    setError('')
  }

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (onlyEmpty) parts.push('Stock épuisé uniquement')
    return {
      title: 'SARL DPR AXXAM',
      subtitle: 'Stock Matières Premières',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'designation', label: 'Désignation' },
        { key: 'position_tarifaire', label: 'Position tarifaire' },
        { key: 'unite', label: 'Unité' },
        { key: 'quantite', label: 'Quantité', align: 'right', format: (v) => formatQty(v) },
        { key: 'prix_moyen', label: 'Prix moyen (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'valeur_totale', label: 'Valeur totale (DA)', align: 'right', format: (v) => formatDA(v) },
      ],
      rows: filtered,
      totals: [{ designation: 'TOTAL', valeur_totale: totalValeur }],
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadProdnetMatieresExcel(filtered)
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  const totalValeur = filtered.reduce((s, r) => s + toNum(r.valeur_totale), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par désignation, position tarifaire…"
          className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="h-4 w-4 accent-terracotta" />
          Stock épuisé ({emptyCount})
        </label>
        <button
          type="button"
          onClick={() => { setAdding((v) => !v); setAddDraft(emptyDraft) }}
          className="min-h-11 rounded-lg border border-terracotta px-4 py-2 font-display text-terracotta hover:bg-terracotta/10"
        >
          {adding ? 'Annuler' : 'Ajouter une matière'}
        </button>
        <button
          type="button"
          onClick={() => setPrintOpen(true)}
          className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted"
        >
          Imprimer
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50"
        >
          {exporting ? 'Génération…' : 'Exporter Excel'}
        </button>
        {isAdmin && rows.length > 0 && (
          <button
            type="button"
            onClick={handleDeleteAll}
            className="min-h-11 rounded-lg border border-terracotta px-4 py-2 font-display text-terracotta hover:bg-terracotta/10"
          >
            Tout supprimer
          </button>
        )}
      </div>

      {adding && <MatiereForm draft={addDraft} onChange={setAddDraft} onSubmit={handleAdd} onCancel={() => setAdding(false)} submitLabel="Ajouter" />}

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune matière première.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Matières</p>
              <p className="font-display text-lg text-ink">{filtered.length}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Valeur totale du stock</p>
              <p className="font-display text-lg text-ocre">{formatDA(totalValeur)} DA</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Désignation</Th>
                  <Th>Position tarifaire</Th>
                  <Th>Unité</Th>
                  <Th>Quantité</Th>
                  <Th>Prix moyen</Th>
                  <Th>Valeur totale</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) =>
                  editingId === row.id ? (
                    <tr key={row.id} className="border-b border-border bg-bg-soft last:border-0">
                      <Td><input type="text" value={editDraft.designation} onChange={(e) => setEditDraft({ ...editDraft, designation: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="text" value={editDraft.position_tarifaire} onChange={(e) => setEditDraft({ ...editDraft, position_tarifaire: e.target.value })} className={editInputClass} /></Td>
                      <Td>
                        <select value={editDraft.unite} onChange={(e) => setEditDraft({ ...editDraft, unite: e.target.value })} className={editInputClass}>
                          {MATIERE_UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </Td>
                      <Td><input type="number" step="0.001" value={editDraft.quantite} onChange={(e) => setEditDraft({ ...editDraft, quantite: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="number" step="0.01" value={editDraft.prix_moyen} onChange={(e) => setEditDraft({ ...editDraft, prix_moyen: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="number" step="0.01" value={editDraft.valeur_totale} onChange={(e) => setEditDraft({ ...editDraft, valeur_totale: e.target.value })} className={editInputClass} placeholder="auto" /></Td>
                      <Td>
                        <div className="flex gap-2">
                          <button type="button" onClick={saveEdit} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Enregistrer</button>
                          <button type="button" onClick={() => { setEditingId(null); setEditDraft(null) }} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">Annuler</button>
                        </div>
                      </Td>
                    </tr>
                  ) : (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <Td className="max-w-[320px] truncate" title={row.designation}>{row.designation}</Td>
                      <Td>{row.position_tarifaire || '—'}</Td>
                      <Td>{row.unite || 'U'}</Td>
                      <Td>
                        <span className={`inline-block rounded px-2 py-0.5 font-medium ${toNum(row.quantite) === 0 ? 'bg-terracotta/20 text-terracotta' : 'text-ink'}`}>
                          {formatQty(row.quantite)}
                        </span>
                      </Td>
                      <Td className="text-right">{formatDA(row.prix_moyen)}</Td>
                      <Td className="text-right">{formatDA(row.valeur_totale)}</Td>
                      <Td>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setHistoryMatiere(row)} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Historique</button>
                          <button type="button" onClick={() => startEdit(row)} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre">Modifier</button>
                          <button type="button" onClick={() => handleDelete(row)} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10">Suppr.</button>
                        </div>
                      </Td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />

      {historyMatiere && (
        <MatiereHistoryModal matiere={historyMatiere} onClose={() => setHistoryMatiere(null)} />
      )}
    </div>
  )
}

function MatiereHistoryModal({ matiere, onClose }) {
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

  // Utilisation par mois (12 derniers mois qui apparaissent).
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
      filters: `Stock actuel : ${formatQty(matiere.quantite)} ${matiere.unite || ''} · Prix moyen : ${formatDA(matiere.prix_moyen)} DA`,
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
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[92vh] sm:w-full sm:max-w-4xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Historique de {matiere.designation}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          Stock actuel : <span className="text-ink">{formatQty(matiere.quantite)} {matiere.unite || ''}</span>
          {' · '}Prix moyen : <span className="text-ink">{formatDA(matiere.prix_moyen)} DA</span>
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" onClick={handlePrint} disabled={rows.length === 0} className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-display text-ink-muted hover:border-ink-muted disabled:opacity-50">
            Imprimer
          </button>
          <button type="button" onClick={handleExcel} disabled={busy || rows.length === 0} className="min-h-10 rounded-lg border border-ocre px-3 py-2 text-sm font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
            {busy ? 'Génération…' : 'Exporter Excel'}
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>}

        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-ink-muted">Cette matière n'a jamais été utilisée dans une fabrication.</p>
        ) : (
          <>
            {byMonth.length > 1 && (
              <div className="mb-3">
                <p className="mb-1 text-xs text-ink-muted">Utilisation par mois</p>
                <div className="flex items-end gap-1" style={{ height: 90 }}>
                  {byMonth.map(([month, v]) => (
                    <div key={month} className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-[9px] text-ink-muted">{formatQty(v)}</span>
                      <div className="w-full rounded-t bg-ocre" style={{ height: `${Math.max(3, (v / maxMonth) * 66)}px` }} title={`${month} : ${formatQty(v)}`} />
                      <span className="text-[9px] text-ink-muted">{month.slice(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] border-collapse text-[11px] sm:text-sm">
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
    </div>
  )
}

function MatiereForm({ draft, onChange, onSubmit, onCancel, submitLabel }) {
  const set = (field, value) => onChange({ ...draft, [field]: value })
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-soft p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Désignation *"><input type="text" value={draft.designation} onChange={(e) => set('designation', e.target.value)} className={inputClass} /></Field>
        <Field label="Position tarifaire"><input type="text" value={draft.position_tarifaire} onChange={(e) => set('position_tarifaire', e.target.value)} className={inputClass} /></Field>
        <Field label="Unité">
          <select value={draft.unite} onChange={(e) => set('unite', e.target.value)} className={inputClass}>
            {MATIERE_UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Quantité"><input type="number" step="0.001" value={draft.quantite} onChange={(e) => set('quantite', e.target.value)} className={inputClass} /></Field>
        <Field label="Prix moyen"><input type="number" step="0.01" value={draft.prix_moyen} onChange={(e) => set('prix_moyen', e.target.value)} className={inputClass} /></Field>
        <Field label="Valeur totale (auto si vide)"><input type="number" step="0.01" value={draft.valeur_totale} onChange={(e) => set('valeur_totale', e.target.value)} className={inputClass} /></Field>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onSubmit} className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-4 py-2 text-ink-muted hover:border-ink-muted">Annuler</button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function Th({ children }) {
  return <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">{children}</th>
}

function Td({ children, className = '', title }) {
  return (
    <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`} title={title}>
      {children}
    </td>
  )
}

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((r) => r.id === payload.new.id)) return current
    return [...current, payload.new].sort((a, b) => a.designation.localeCompare(b.designation))
  }
  if (payload.eventType === 'UPDATE') return current.map((r) => (r.id === payload.new.id ? payload.new : r))
  if (payload.eventType === 'DELETE') return current.filter((r) => r.id !== payload.old.id)
  return current
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
