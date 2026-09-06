import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MATIERE_UNITES, formatDA, formatQty, toNum } from '../lib/prodnet'
import { downloadProdnetMatieresExcel } from '../lib/prodnetExcel'
import PrintSelectionModal from './PrintSelectionModal'

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
