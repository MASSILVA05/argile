import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession, useAuth } from '../lib/auth'
import { formatDA, formatQty, isLowStock } from '../lib/magasin'
import { downloadMagasinStockExcel } from '../lib/magasinStockExcel'
import { notifyMagasinStockEntry } from '../lib/ntfy'

const NUMERIC_FIELDS = ['quantite', 'prix_achat', 'prix_gros', 'prix_detail', 'prix_euro', 'stock_min']

const emptyDraft = {
  reference: '',
  designation: '',
  marque: '',
  quantite: '',
  prix_achat: '',
  prix_gros: '',
  prix_detail: '',
  prix_euro: '',
  stock_min: '',
  rayonnage: '',
  code_barre: '',
}

function toPayload(draft) {
  const payload = {
    reference: draft.reference.trim() || null,
    designation: draft.designation.trim(),
    marque: draft.marque.trim() || null,
    rayonnage: draft.rayonnage.trim() || null,
    code_barre: draft.code_barre.trim() || null,
  }
  for (const f of NUMERIC_FIELDS) payload[f] = draft[f] === '' || draft[f] == null ? 0 : Number(draft[f])
  return payload
}

export default function MagasinStock() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('magasin_stock')
        .select('*')
        .order('designation')
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
      .channel('magasin-stock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_stock' }, (payload) => {
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
      if (onlyLow && !isLowStock(r)) return false
      if (!q) return true
      return [r.reference, r.designation, r.marque, r.code_barre].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, query, onlyLow])

  async function handleAdd() {
    if (!addDraft.designation.trim()) {
      setError('La désignation est obligatoire.')
      return
    }
    const { data, error: insertError } = await supabase
      .from('magasin_stock')
      .insert(toPayload(addDraft))
      .select()
      .single()
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
    setEditDraft({ ...emptyDraft, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) })
  }

  async function saveEdit() {
    if (!editDraft.designation.trim()) {
      setError('La désignation est obligatoire.')
      return
    }
    const { data, error: updateError } = await supabase
      .from('magasin_stock')
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

  async function handleStockEntry(row) {
    const raw = window.prompt(`Entrée de stock pour « ${row.designation} »\nQuantité reçue à ajouter :`, '')
    if (raw == null) return
    const added = Number(String(raw).replace(',', '.'))
    if (!Number.isFinite(added) || added === 0) {
      setError('Quantité invalide.')
      return
    }
    const newQty = (Number(row.quantite) || 0) + added
    const { data, error: updateError } = await supabase
      .from('magasin_stock')
      .update({ quantite: newQty })
      .eq('id', row.id)
      .select()
      .single()
    if (updateError) {
      setError(`Erreur : ${updateError.message}`)
      return
    }
    setRows((current) => current.map((r) => (r.id === data.id ? data : r)))
    setError('')
    notifyMagasinStockEntry({
      designation: row.designation,
      reference: row.reference,
      added,
      quantite: newQty,
      entered_by_user: getSession()?.username ?? null,
    })
  }

  async function handleDelete(row) {
    if (!window.confirm(`Supprimer l'article « ${row.designation} » ?`)) return
    const { error: rpcError } = isAdmin
      ? await supabase.rpc('admin_delete_magasin_stock', {
          p_id: row.id,
          p_admin_code: window.prompt('Code administrateur :') ?? '',
        })
      : await supabase.from('magasin_stock').delete().eq('id', row.id)
    if (rpcError) {
      setError(`Erreur de suppression : ${rpcError.message}`)
      return
    }
    setRows((current) => current.filter((r) => r.id !== row.id))
    setError('')
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadMagasinStockExcel(filtered)
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  const lowCount = rows.filter(isLowStock).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher : référence, désignation, marque, code-barre…"
          className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={(e) => setOnlyLow(e.target.checked)}
            className="h-4 w-4 accent-terracotta"
          />
          Stock bas ({lowCount})
        </label>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v)
            setAddDraft(emptyDraft)
          }}
          className="min-h-11 rounded-lg border border-terracotta px-4 py-2 font-display text-terracotta transition-colors hover:bg-terracotta/10"
        >
          {adding ? 'Annuler' : 'Ajouter un article'}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:opacity-50"
        >
          {exporting ? 'Génération…' : 'Exporter Excel'}
        </button>
      </div>

      {adding && (
        <ArticleForm
          draft={addDraft}
          onChange={setAddDraft}
          onSubmit={handleAdd}
          onCancel={() => setAdding(false)}
          submitLabel="Ajouter l'article"
        />
      )}

      {error && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun article.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1100px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Référence</Th>
                <Th>Désignation</Th>
                <Th>Marque</Th>
                <Th>Quantité</Th>
                <Th>Stock min</Th>
                <Th>Prix achat</Th>
                <Th>Prix gros</Th>
                <Th>Prix détail</Th>
                <Th>Prix €</Th>
                <Th>Rayonnage</Th>
                <Th>Code barre</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) =>
                editingId === row.id ? (
                  <EditRow
                    key={row.id}
                    draft={editDraft}
                    onChange={setEditDraft}
                    onSave={saveEdit}
                    onCancel={() => {
                      setEditingId(null)
                      setEditDraft(null)
                    }}
                  />
                ) : (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <Td>{row.reference || '—'}</Td>
                    <Td className="max-w-[260px] truncate" title={row.designation}>
                      {row.designation}
                    </Td>
                    <Td>{row.marque || '—'}</Td>
                    <Td>
                      <span
                        className={`inline-block rounded px-2 py-0.5 font-medium ${
                          isLowStock(row) ? 'bg-terracotta/20 text-terracotta' : 'text-ink'
                        }`}
                      >
                        {formatQty(row.quantite)}
                      </span>
                    </Td>
                    <Td>{formatQty(row.stock_min)}</Td>
                    <Td className="text-right">{formatDA(row.prix_achat)}</Td>
                    <Td className="text-right">{formatDA(row.prix_gros)}</Td>
                    <Td className="text-right">{formatDA(row.prix_detail)}</Td>
                    <Td className="text-right">{formatDA(row.prix_euro)}</Td>
                    <Td>{row.rayonnage || '—'}</Td>
                    <Td>{row.code_barre || '—'}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleStockEntry(row)}
                          title="Entrée de stock"
                          className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10"
                        >
                          + Entrée
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10"
                        >
                          Suppr.
                        </button>
                      </div>
                    </Td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ArticleForm({ draft, onChange, onSubmit, onCancel, submitLabel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-soft p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Référence">
          <input type="text" value={draft.reference} onChange={(e) => set('reference', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Désignation *">
          <input type="text" value={draft.designation} onChange={(e) => set('designation', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Marque">
          <input type="text" value={draft.marque} onChange={(e) => set('marque', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Quantité">
          <input type="number" step="0.01" value={draft.quantite} onChange={(e) => set('quantite', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Stock min">
          <input type="number" step="0.01" value={draft.stock_min} onChange={(e) => set('stock_min', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Rayonnage">
          <input type="text" value={draft.rayonnage} onChange={(e) => set('rayonnage', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Prix achat">
          <input type="number" step="0.01" value={draft.prix_achat} onChange={(e) => set('prix_achat', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Prix gros">
          <input type="number" step="0.01" value={draft.prix_gros} onChange={(e) => set('prix_gros', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Prix détail">
          <input type="number" step="0.01" value={draft.prix_detail} onChange={(e) => set('prix_detail', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Prix euro">
          <input type="number" step="0.01" value={draft.prix_euro} onChange={(e) => set('prix_euro', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Code barre">
          <input type="text" value={draft.code_barre} onChange={(e) => set('code_barre', e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-border px-4 py-2 text-ink-muted hover:border-ink-muted"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="text" value={draft.reference} onChange={(e) => set('reference', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.designation} onChange={(e) => set('designation', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.marque} onChange={(e) => set('marque', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.quantite} onChange={(e) => set('quantite', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.stock_min} onChange={(e) => set('stock_min', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.prix_achat} onChange={(e) => set('prix_achat', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.prix_gros} onChange={(e) => set('prix_gros', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.prix_detail} onChange={(e) => set('prix_detail', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.prix_euro} onChange={(e) => set('prix_euro', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.rayonnage} onChange={(e) => set('rayonnage', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.code_barre} onChange={(e) => set('code_barre', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <div className="flex gap-2">
          <button type="button" onClick={onSave} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">
            Enregistrer
          </button>
          <button type="button" onClick={onCancel} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">
            Annuler
          </button>
        </div>
      </Td>
    </tr>
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
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
const editInputClass =
  'min-w-20 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
