import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { buildExportFilename } from '../lib/exportFilters'
import { printRegistry } from '../lib/printRegistry'
import { downloadProdnetFabricationsExcel } from '../lib/prodnetExcel'
import { formatDA, formatQty, matieresSummary, matieresText } from '../lib/prodnet'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'

const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

export default function ProdnetFabricationRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [editEntry, setEditEntry] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('prodnet_fabrications')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setAll(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('prodnet-fabrications-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prodnet_fabrications' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const productOptions = useMemo(
    () => [...new Set(all.map((f) => f.product_designation).filter(Boolean))].sort(),
    [all]
  )

  const filtered = useMemo(() => {
    return all.filter((f) => {
      if (productFilter && f.product_designation !== productFilter) return false
      if (dateFilter && f.entry_date !== dateFilter) return false
      return true
    })
  }, [all, productFilter, dateFilter])

  const totals = useMemo(() => {
    const coutTotal = filtered.reduce((s, f) => s + (Number(f.cout_total) || 0), 0)
    const qte = filtered.reduce((s, f) => s + (Number(f.quantite_produite) || 0), 0)
    return { coutTotal, qte }
  }, [filtered])

  function handlePrint() {
    const parts = []
    if (productFilter) parts.push(`Produit : ${productFilter}`)
    if (dateFilter) parts.push(`Date : ${dateFilter}`)
    printRegistry({
      subtitle: 'Registre des fabrications — Prodnet',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: fmtTime },
        { key: 'product_reference', label: 'Réf.' },
        { key: 'product_designation', label: 'Produit fini' },
        { key: 'quantite_produite', label: 'Qté produite', align: 'right', format: (v) => formatQty(v) },
        { key: 'matieres_text', label: 'Matières consommées' },
        { key: 'cout_total', label: 'Coût total (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'cout_unitaire', label: 'Coût unitaire (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'entered_by_user', label: 'Saisi par' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((f) => ({ ...f, matieres_text: matieresText(f.matieres) })),
      totals: [{ entry_date: 'TOTAUX', quantite_produite: formatQty(totals.qte), cout_total: formatDA(totals.coutTotal) }],
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadProdnetFabricationsExcel(filtered, {
        filename: buildExportFilename('Prodnet_Fabrications', dateFilter || '', dateFilter || ''),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  async function saveEdit(payload) {
    const usingAdmin = editAdminCode != null
    const { data, error: updateError } = usingAdmin
      ? await supabase.rpc('admin_update_prodnet_fabrication', { p_id: editEntry.id, p_admin_code: editAdminCode, p: payload })
      : await supabase.from('prodnet_fabrications').update(payload).eq('id', editEntry.id).select().single()
    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setAll((current) => current.map((f) => (f.id === row.id ? row : f)))
    setEditEntry(null)
    setEditAdminCode(null)
    setError('')
  }

  function openAdminPrompt(action, entry) {
    if (!isAdmin) {
      setError(LOCK_MESSAGE)
      return
    }
    setAdminPrompt({ action, entry })
    setAdminCodeValue('')
    setAdminError('')
  }

  function closeAdminPrompt() {
    setAdminPrompt(null)
    setAdminCodeValue('')
    setAdminError('')
  }

  async function confirmAdminCode() {
    if (adminPrompt.action === 'edit') {
      const entry = adminPrompt.entry
      const code = adminCodeValue
      closeAdminPrompt()
      setEditEntry(entry)
      setEditAdminCode(code)
      return
    }
    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_delete_prodnet_fabrication', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((f) => f.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(entry) {
    if (isLocked(entry)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(
      `Supprimer la fabrication du ${entry.entry_date} (${entry.product_designation}) ?\n\nAttention : les stocks de matières / produit ne sont PAS restaurés automatiquement.`
    )) return
    const { error: deleteError } = await supabase.from('prodnet_fabrications').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((f) => f.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className={filterClass}>
            <option value="">Tous les produits</option>
            {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handlePrint} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted">
            Imprimer
          </button>
          <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune fabrication.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Quantité produite (total)</p>
              <p className="font-display text-lg text-ink">{formatQty(totals.qte)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Coût total fabrications</p>
              <p className="font-display text-lg text-ocre">{formatDA(totals.coutTotal)} DA</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1000px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Produit fini</Th>
                  <Th>Qté produite</Th>
                  <Th>Matières</Th>
                  <Th>Coût total</Th>
                  <Th>Coût unitaire</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <FabRow
                    key={f.id}
                    fab={f}
                    expanded={expandedId === f.id}
                    onToggle={() => setExpandedId((id) => (id === f.id ? null : f.id))}
                    onEdit={() => { setEditEntry(f); setEditAdminCode(null) }}
                    onDelete={() => handleDelete(f)}
                    onLockedAttempt={(action) => openAdminPrompt(action, f)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editEntry && (
        <EditModal
          entry={editEntry}
          adminMode={editAdminCode != null}
          onSave={saveEdit}
          onCancel={() => { setEditEntry(null); setEditAdminCode(null) }}
        />
      )}

      <AdminCodeModal
        prompt={adminPrompt}
        codeValue={adminCodeValue}
        onCodeChange={setAdminCodeValue}
        error={adminError}
        busy={adminBusy}
        onConfirm={confirmAdminCode}
        onCancel={closeAdminPrompt}
      />
    </div>
  )
}

function FabRow({ fab, expanded, onToggle, onEdit, onDelete, onLockedAttempt }) {
  const matieres = Array.isArray(fab.matieres) ? fab.matieres : []
  return (
    <>
      <tr className="border-b border-border last:border-0">
        <Td>{fab.entry_date}</Td>
        <Td>{fmtTime(fab.entry_time)}</Td>
        <Td>{formatDateTime(fab.created_at)}</Td>
        <Td className="max-w-[280px] truncate" title={fab.product_designation}>
          {fab.product_reference ? `${fab.product_designation} [${fab.product_reference}]` : fab.product_designation}
        </Td>
        <Td className="text-right">{formatQty(fab.quantite_produite)}</Td>
        <Td>
          <button type="button" onClick={onToggle} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre">
            {matieresSummary(fab.matieres)} · {expanded ? 'masquer' : 'détail'}
          </button>
        </Td>
        <Td className="text-right font-medium text-ocre">{formatDA(fab.cout_total)}</Td>
        <Td className="text-right">{formatDA(fab.cout_unitaire)}</Td>
        <Td>{fab.entered_by_user ?? '—'}</Td>
        <Td className="no-print">
          <RowActions entry={fab} onEdit={onEdit} onDelete={onDelete} onLockedAttempt={onLockedAttempt} />
        </Td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-bg-soft last:border-0">
          <td colSpan={10} className="px-3 py-3">
            <p className="mb-2 font-display text-ink">Matières premières consommées</p>
            <table className="w-full border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="py-1 pr-4">Désignation</th>
                  <th className="py-1 pr-4 text-right">Quantité</th>
                  <th className="py-1 pr-4 text-right">Prix unitaire</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {matieres.map((m, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4">{m.designation}</td>
                    <td className="py-1 pr-4 text-right">{formatQty(m.quantite_utilisee)}</td>
                    <td className="py-1 pr-4 text-right">{formatDA(m.prix_unitaire)}</td>
                    <td className="py-1 text-right">{formatDA(m.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-1 pr-4">TOTAL</td>
                  <td></td>
                  <td></td>
                  <td className="py-1 text-right text-ocre">{formatDA(fab.cout_total)}</td>
                </tr>
              </tfoot>
            </table>
            {fab.observations && <p className="mt-2 text-sm text-ink-muted">Obs : {fab.observations}</p>}
          </td>
        </tr>
      )}
    </>
  )
}

function EditModal({ entry, adminMode, onSave, onCancel }) {
  const [entryDate, setEntryDate] = useState(entry.entry_date)
  const [observations, setObservations] = useState(entry.observations ?? '')
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    await onSave({ entry_date: entryDate, observations: observations.trim() || null })
    setBusy(false)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:w-full sm:max-w-md sm:rounded-xl sm:border sm:border-border" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 font-display text-lg text-ink">
          Modifier la fabrication {adminMode && <span className="ml-2 text-sm text-ocre">(code admin)</span>}
        </h2>
        <p className="mb-3 text-sm text-ink-muted">
          Seules la date et les observations sont modifiables. Les matières et coûts sont figés (les stocks ont déjà été impactés).
        </p>
        <label className="mb-3 flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Date</span>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={ic} />
        </label>
        <label className="mb-3 flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Observations</span>
          <textarea value={observations} onChange={(e) => setObservations(e.target.value)} className={`${ic} min-h-20 resize-y`} />
        </label>
        <div className="mt-auto flex justify-end gap-2 pt-3">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">Annuler</button>
          <button type="button" onClick={submit} disabled={busy} className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</th>
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
    if (current.some((f) => f.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) =>
      a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.created_at < b.created_at ? 1 : -1
    )
  }
  if (payload.eventType === 'UPDATE') return current.map((f) => (f.id === payload.new.id ? payload.new : f))
  if (payload.eventType === 'DELETE') return current.filter((f) => f.id !== payload.old.id)
  return current
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const ic =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
