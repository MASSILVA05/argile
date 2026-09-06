import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDA, formatQty, toNum } from '../lib/prodnet'
import { downloadProdnetProductsExcel } from '../lib/prodnetExcel'
import { printRegistry } from '../lib/printRegistry'

const emptyDraft = { reference: '', designation: '', quantite: '', prix_moyen_ht: '', montant_ht: '' }

function toPayload(draft) {
  const quantite = toNum(draft.quantite)
  const prix = toNum(draft.prix_moyen_ht)
  const montant = draft.montant_ht === '' || draft.montant_ht == null ? quantite * prix : toNum(draft.montant_ht)
  return {
    reference: draft.reference.trim() || null,
    designation: draft.designation.trim(),
    quantite,
    prix_moyen_ht: prix,
    montant_ht: montant,
  }
}

export default function ProdnetProducts() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase.from('prodnet_products').select('*').order('designation')
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
      .channel('prodnet-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prodnet_products' }, (payload) => {
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
    if (!q) return rows
    return rows.filter((r) => [r.reference, r.designation].some((f) => String(f ?? '').toLowerCase().includes(q)))
  }, [rows, query])

  async function handleAdd() {
    if (!addDraft.designation.trim()) {
      setError('La désignation est obligatoire.')
      return
    }
    const { data, error: insertError } = await supabase.from('prodnet_products').insert(toPayload(addDraft)).select().single()
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
      reference: row.reference ?? '',
      designation: row.designation ?? '',
      quantite: row.quantite ?? '',
      prix_moyen_ht: row.prix_moyen_ht ?? '',
      montant_ht: row.montant_ht ?? '',
    })
  }

  async function saveEdit() {
    if (!editDraft.designation.trim()) {
      setError('La désignation est obligatoire.')
      return
    }
    const { data, error: updateError } = await supabase
      .from('prodnet_products')
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
    if (!window.confirm(`Supprimer le produit fini « ${row.designation} » ?`)) return
    const { error: rpcError } = isAdmin
      ? await supabase.rpc('admin_delete_prodnet_product', {
          p_id: row.id,
          p_admin_code: window.prompt('Code administrateur :') ?? '',
        })
      : await supabase.from('prodnet_products').delete().eq('id', row.id)
    if (rpcError) {
      setError(`Erreur de suppression : ${rpcError.message}`)
      return
    }
    setRows((current) => current.filter((r) => r.id !== row.id))
    setError('')
  }

  function handlePrint() {
    printRegistry({
      title: 'SARL DPR AXXAM',
      subtitle: 'Liste des Produits Finis',
      orientation: 'landscape',
      filters: query.trim() ? `Recherche : "${query.trim()}"` : '',
      columns: [
        { key: 'reference', label: 'Référence' },
        { key: 'designation', label: 'Désignation' },
        { key: 'quantite', label: 'Quantité', align: 'right', format: (v) => formatQty(v) },
        { key: 'prix_moyen_ht', label: 'Prix moyen HT (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'montant_ht', label: 'Montant HT (DA)', align: 'right', format: (v) => formatDA(v) },
      ],
      rows: filtered,
      totals: [{ designation: 'TOTAL', montant_ht: totalMontant }],
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadProdnetProductsExcel(filtered)
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  const totalMontant = filtered.reduce((s, r) => s + toNum(r.montant_ht), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher : référence, désignation…"
          className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
        />
        <button
          type="button"
          onClick={() => { setAdding((v) => !v); setAddDraft(emptyDraft) }}
          className="min-h-11 rounded-lg border border-terracotta px-4 py-2 font-display text-terracotta hover:bg-terracotta/10"
        >
          {adding ? 'Annuler' : 'Ajouter un produit'}
        </button>
        <button
          type="button"
          onClick={handlePrint}
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
      </div>

      {adding && <ProductForm draft={addDraft} onChange={setAddDraft} onSubmit={handleAdd} onCancel={() => setAdding(false)} submitLabel="Ajouter" />}

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun produit fini.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Produits</p>
              <p className="font-display text-lg text-ink">{filtered.length}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Valeur stock (Montant HT)</p>
              <p className="font-display text-lg text-ocre">{formatDA(totalMontant)} DA</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[800px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Référence</Th>
                  <Th>Désignation</Th>
                  <Th>Quantité</Th>
                  <Th>Prix moyen HT</Th>
                  <Th>Montant HT</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) =>
                  editingId === row.id ? (
                    <tr key={row.id} className="border-b border-border bg-bg-soft last:border-0">
                      <Td><input type="text" value={editDraft.reference} onChange={(e) => setEditDraft({ ...editDraft, reference: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="text" value={editDraft.designation} onChange={(e) => setEditDraft({ ...editDraft, designation: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="number" step="0.01" value={editDraft.quantite} onChange={(e) => setEditDraft({ ...editDraft, quantite: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="number" step="0.01" value={editDraft.prix_moyen_ht} onChange={(e) => setEditDraft({ ...editDraft, prix_moyen_ht: e.target.value })} className={editInputClass} /></Td>
                      <Td><input type="number" step="0.01" value={editDraft.montant_ht} onChange={(e) => setEditDraft({ ...editDraft, montant_ht: e.target.value })} className={editInputClass} placeholder="auto" /></Td>
                      <Td>
                        <div className="flex gap-2">
                          <button type="button" onClick={saveEdit} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Enregistrer</button>
                          <button type="button" onClick={() => { setEditingId(null); setEditDraft(null) }} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">Annuler</button>
                        </div>
                      </Td>
                    </tr>
                  ) : (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <Td>{row.reference || '—'}</Td>
                      <Td className="max-w-[320px] truncate" title={row.designation}>{row.designation}</Td>
                      <Td>{formatQty(row.quantite)}</Td>
                      <Td className="text-right">{formatDA(row.prix_moyen_ht)}</Td>
                      <Td className="text-right">{formatDA(row.montant_ht)}</Td>
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
    </div>
  )
}

function ProductForm({ draft, onChange, onSubmit, onCancel, submitLabel }) {
  const set = (field, value) => onChange({ ...draft, [field]: value })
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-soft p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Référence"><input type="text" value={draft.reference} onChange={(e) => set('reference', e.target.value)} className={inputClass} placeholder="ex : DPR0001" /></Field>
        <Field label="Désignation *"><input type="text" value={draft.designation} onChange={(e) => set('designation', e.target.value)} className={inputClass} /></Field>
        <Field label="Quantité"><input type="number" step="0.01" value={draft.quantite} onChange={(e) => set('quantite', e.target.value)} className={inputClass} /></Field>
        <Field label="Prix moyen HT"><input type="number" step="0.01" value={draft.prix_moyen_ht} onChange={(e) => set('prix_moyen_ht', e.target.value)} className={inputClass} /></Field>
        <Field label="Montant HT (auto si vide)"><input type="number" step="0.01" value={draft.montant_ht} onChange={(e) => set('montant_ht', e.target.value)} className={inputClass} /></Field>
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
