import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  formatDA,
  formatQty,
  toNum,
  constitutionArray,
  constitutionSummary,
  constitutionCost,
} from '../lib/prodnet'
import { downloadProdnetProductsExcel } from '../lib/prodnetExcel'
import { printProductsConstitution } from '../lib/printRegistry'
import PrintSelectionModal from './PrintSelectionModal'
import MatieresPicker from './MatieresPicker'

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
  const [printOpen, setPrintOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [constitProduct, setConstitProduct] = useState(null)

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

  async function saveConstitution(productId, constitution) {
    const { data, error: updateError } = await supabase
      .from('prodnet_products')
      .update({ constitution })
      .eq('id', productId)
      .select()
      .single()
    if (updateError) return updateError.message
    setRows((current) => current.map((r) => (r.id === data.id ? data : r)))
    setConstitProduct(null)
    setError('')
    return null
  }

  function buildPrintConfig() {
    return {
      title: 'SARL DPR AXXAM',
      subtitle: 'Produits finis — Constitution',
      columns: [
        { key: 'reference', label: 'Référence' },
        { key: 'designation', label: 'Désignation' },
        { key: 'quantite', label: 'Quantité', align: 'right', format: (v) => formatQty(v) },
        { key: 'constitution', label: 'Constitution', format: (v) => constitutionSummary(v) },
        { key: 'constitution_cost', label: 'Coût revient estimé (DA)', align: 'right', format: (v) => formatDA(v) },
      ],
      rows: filtered.map((r) => ({ ...r, constitution_cost: constitutionCost(r.constitution) })),
      onPrint: (products) => printProductsConstitution(products),
    }
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
            <table className="w-full min-w-[980px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Référence</Th>
                  <Th>Désignation</Th>
                  <Th>Quantité</Th>
                  <Th>Prix moyen HT</Th>
                  <Th>Montant HT</Th>
                  <Th>Constitution</Th>
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
                      <Td>—</Td>
                      <Td>
                        <div className="flex gap-2">
                          <button type="button" onClick={saveEdit} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Enregistrer</button>
                          <button type="button" onClick={() => { setEditingId(null); setEditDraft(null) }} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">Annuler</button>
                        </div>
                      </Td>
                    </tr>
                  ) : (
                    <FragmentRow key={row.id} row={row} expanded={expandedId === row.id}
                      onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                      onEditConstitution={() => setConstitProduct(row)}
                      onEdit={() => startEdit(row)}
                      onDelete={() => handleDelete(row)}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />

      {constitProduct && (
        <ConstitutionModal
          product={constitProduct}
          onSave={saveConstitution}
          onCancel={() => setConstitProduct(null)}
        />
      )}
    </div>
  )
}

function FragmentRow({ row, expanded, onToggle, onEditConstitution, onEdit, onDelete }) {
  const cons = constitutionArray(row.constitution)
  return (
    <>
      <tr className="border-b border-border last:border-0">
        <Td>{row.reference || '—'}</Td>
        <Td className="max-w-[320px] truncate" title={row.designation}>{row.designation}</Td>
        <Td>{formatQty(row.quantite)}</Td>
        <Td className="text-right">{formatDA(row.prix_moyen_ht)}</Td>
        <Td className="text-right">{formatDA(row.montant_ht)}</Td>
        <Td>
          <button
            type="button"
            onClick={onToggle}
            className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre"
          >
            {constitutionSummary(row.constitution)}{cons.length > 0 ? ` · ${expanded ? 'masquer' : 'voir'}` : ''}
          </button>
        </Td>
        <Td>
          <div className="flex gap-1">
            <button type="button" onClick={onEditConstitution} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Constitution</button>
            <button type="button" onClick={onEdit} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre">Modifier</button>
            <button type="button" onClick={onDelete} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10">Suppr.</button>
          </div>
        </Td>
      </tr>
      {expanded && cons.length > 0 && (
        <tr className="border-b border-border bg-bg-soft last:border-0">
          <td colSpan={7} className="px-3 py-3">
            <p className="mb-2 font-display text-ink">Constitution — {row.reference ? `${row.designation} [${row.reference}]` : row.designation}</p>
            <table className="w-full border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="py-1 pr-4">Matière première</th>
                  <th className="py-1 pr-4 text-right">Quantité</th>
                  <th className="py-1 pr-4 text-right">Prix unitaire</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {cons.map((c, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4">{c.matiere_designation}</td>
                    <td className="py-1 pr-4 text-right">{formatQty(c.quantite)}</td>
                    <td className="py-1 pr-4 text-right">{formatDA(c.prix_unitaire)}</td>
                    <td className="py-1 text-right">{formatDA(toNum(c.quantite) * toNum(c.prix_unitaire))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-1 pr-4">Coût de revient estimé</td>
                  <td></td>
                  <td></td>
                  <td className="py-1 text-right text-ocre">{formatDA(constitutionCost(row.constitution))}</td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

function ConstitutionModal({ product, onSave, onCancel }) {
  // selected : { [matiere_id]: quantiteString }
  const [selected, setSelected] = useState(() => {
    const init = {}
    for (const c of constitutionArray(product.constitution)) {
      if (c.matiere_id) init[c.matiere_id] = String(c.quantite ?? '')
    }
    return init
  })
  const [catalogue, setCatalogue] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    supabase
      .from('prodnet_matieres')
      .select('id, designation, quantite, prix_moyen, unite')
      .order('designation')
      .then(({ data }) => {
        if (active) setCatalogue(data ?? [])
      })
    return () => {
      active = false
    }
  }, [])

  const selectedRows = useMemo(
    () => catalogue.filter((m) => selected[m.id] !== undefined),
    [catalogue, selected]
  )

  const coutEstime = selectedRows.reduce(
    (s, m) => s + toNum(selected[m.id]) * toNum(m.prix_moyen),
    0
  )

  function toggle(id, checked) {
    setSelected((cur) => {
      const next = { ...cur }
      if (checked) next[id] = next[id] ?? ''
      else delete next[id]
      return next
    })
  }

  function setQte(id, value) {
    setSelected((cur) => ({ ...cur, [id]: value }))
  }

  async function submit() {
    setError('')
    const constitution = selectedRows
      .filter((m) => toNum(selected[m.id]) > 0)
      .map((m) => ({
        matiere_id: m.id,
        matiere_designation: m.designation,
        quantite: toNum(selected[m.id]),
        prix_unitaire: toNum(m.prix_moyen),
      }))
    setBusy(true)
    const msg = await onSave(product.id, constitution)
    setBusy(false)
    if (msg) setError(msg)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[92vh] sm:w-full sm:max-w-2xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg text-ink">Constitution du produit</h2>
        <p className="mb-3 text-sm text-ink-muted">
          {product.reference ? `${product.designation} [${product.reference}]` : product.designation}
        </p>

        <MatieresPicker
          catalogue={catalogue}
          isSelected={(id) => selected[id] !== undefined}
          onToggle={toggle}
        />

        {selectedRows.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[480px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <th className="px-2 py-1.5">Matière</th>
                  <th className="px-2 py-1.5">Quantité</th>
                  <th className="px-2 py-1.5 text-right">Prix unitaire</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{m.designation}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={selected[m.id]}
                        onChange={(e) => setQte(m.id, e.target.value)}
                        className="w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatDA(m.prix_moyen)}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{formatDA(toNum(selected[m.id]) * toNum(m.prix_moyen))}</td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => toggle(m.id, false)} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10">Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-ocre/50 bg-ocre/10 px-3 py-2">
          <p className="text-xs text-ink-muted">Coût de revient estimé ({selectedRows.length} matière(s))</p>
          <p className="font-display text-lg text-ocre">{formatDA(coutEstime)} DA</p>
        </div>

        {error && <p className="mt-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">Annuler</button>
          <button type="button" onClick={submit} disabled={busy} className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Enregistrer la constitution'}
          </button>
        </div>
      </div>
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
