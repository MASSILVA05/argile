import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadResidenceCaisseExcel } from '../lib/residenceExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/dateFormat'
import {
  RC_OPERATION_TYPES,
  RC_PAYMENT_MODES,
  RC_CATEGORIES,
  rcCategoryLabel,
  rcIsInflow,
  rcSignedAmount,
  formatDA,
  buildResidenceCaisseSheet,
} from '../lib/residence'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'
import PrintSelectionModal from './PrintSelectionModal'

const SHEET_TYPES = [
  { id: 'beneficiary', label: 'Fournisseur / Bénéficiaire', nameLabel: 'Fournisseur / Bénéficiaire' },
  { id: 'client', label: 'Client', nameLabel: 'Client' },
]

const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

function paymentLabel(entry) {
  if (entry.payment_mode === 'Chèque' && entry.cheque_number) {
    return `Chèque n° ${entry.cheque_number}${entry.cheque_bank ? ` (${entry.cheque_bank})` : ''}`
  }
  return entry.payment_mode ?? '—'
}

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((e) => e.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((e) => (e.id === payload.new.id ? payload.new : e))
  if (payload.eventType === 'DELETE') return current.filter((e) => e.id !== payload.old.id)
  return current
}

export default function ResidenceCaisseRegistry() {
  const { isAdmin } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [exportProgress, setExportProgress] = useState(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportError, setExportError] = useState('')
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [sheetModal, setSheetModal] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('residence_caisse')
        .select('*')
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setEntries(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('residence-caisse-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_caisse' }, (payload) => {
        setEntries((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (typeFilter && e.operation_type !== typeFilter) return false
      if (categoryFilter && e.category !== categoryFilter) return false
      if (dateFilter && e.entry_date !== dateFilter) return false
      if (paymentFilter && e.payment_mode !== paymentFilter) return false
      if (!q) return true
      return [e.bon_number, e.description, e.beneficiary, e.client_name].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, typeFilter, categoryFilter, dateFilter, paymentFilter])

  const totals = useMemo(() => {
    const sumBy = (type) =>
      filtered.filter((e) => e.operation_type === type).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const encaissements = sumBy('Encaissement')
    const decaissements = sumBy('Décaissement')
    const depenses = sumBy('Dépense')
    return { encaissements, decaissements, depenses, solde: encaissements - decaissements - depenses }
  }, [filtered])

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (typeFilter) parts.push(`Type : ${typeFilter}`)
    if (categoryFilter) parts.push(`Catégorie : ${categoryFilter}`)
    if (dateFilter) parts.push(`Date : ${dateFilter}`)
    if (paymentFilter) parts.push(`Paiement : ${paymentFilter}`)

    return {
      subtitle: 'Registre Caisse — Résidence',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'bon_number', label: 'Bon' },
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: fmtTime },
        { key: 'created_at', label: 'Saisie le', format: (v) => formatDateTime(v) },
        { key: 'operation_type', label: 'Type' },
        { key: 'description', label: 'Motif' },
        { key: 'signed_amount', label: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'beneficiary', label: 'Fournisseur/Bénéficiaire' },
        { key: 'client_name', label: 'Client' },
        { key: 'payment', label: 'Paiement' },
        { key: 'piece_number', label: 'N° Pièce' },
        { key: 'category_label', label: 'Catégorie' },
        { key: 'entered_by_user', label: 'Saisi par' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((e) => ({
        ...e,
        signed_amount: rcSignedAmount(e),
        payment: paymentLabel(e),
        category_label: rcCategoryLabel(e),
      })),
      totals: [
        { bon_number: 'TOTAL ENCAISSEMENTS', signed_amount: totals.encaissements },
        { bon_number: 'TOTAL DÉCAISSEMENTS', signed_amount: totals.decaissements },
        { bon_number: 'TOTAL DÉPENSES', signed_amount: totals.depenses },
        { bon_number: 'SOLDE', signed_amount: totals.solde },
      ],
    }
  }

  function sheetNameOptions(typeId) {
    const field = typeId === 'client' ? 'client_name' : 'beneficiary'
    return [...new Set(entries.map((e) => e[field]).filter(Boolean))].sort()
  }

  function buildSheet(typeId, name, startDate, endDate) {
    const field = typeId === 'client' ? 'client_name' : 'beneficiary'
    return buildResidenceCaisseSheet(entries, field, name, startDate, endDate)
  }

  function startEdit(entry) {
    setEditingId(entry.id)
    setEditDraft({ ...entry })
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
    setEditAdminCode(null)
  }

  async function saveEdit() {
    const usingAdminCode = editAdminCode != null
    if (!usingAdminCode && isLocked(editDraft)) {
      setError(LOCK_MESSAGE)
      cancelEdit()
      return
    }
    const isCheque = editDraft.payment_mode === 'Chèque'
    const isOther = editDraft.category === 'Autre'
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      operation_type: editDraft.operation_type,
      description: editDraft.description?.trim() || '',
      amount: Number(editDraft.amount),
      beneficiary: editDraft.beneficiary?.trim() || null,
      client_name: editDraft.client_name?.trim() || null,
      payment_mode: editDraft.payment_mode,
      cheque_number: isCheque ? editDraft.cheque_number?.trim() || null : null,
      cheque_bank: isCheque ? editDraft.cheque_bank?.trim() || null : null,
      piece_number: editDraft.piece_number?.trim() || null,
      category: editDraft.category,
      category_other: isOther ? editDraft.category_other?.trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_residence_caisse', { p_id: editingId, p_admin_code: editAdminCode, p: payload })
      : await supabase.from('residence_caisse').update(payload).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setEntries((current) => current.map((e) => (e.id === row.id ? row : e)))
    cancelEdit()
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
      closeAdminPrompt()
      startEdit(entry)
      setEditAdminCode(adminCodeValue)
      return
    }
    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_delete_residence_caisse', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setEntries((current) => current.filter((e) => e.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  function exportSuggestions(field) {
    return [...new Set(entries.map((e) => e[field]).filter(Boolean))]
  }

  async function handleExport(filters, includePhotos) {
    const toExport = applyExportFilters(entries, { ...filters, categoricalField: 'operation_type' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadResidenceCaisseExcel(toExport, {
        includePhotos,
        filename: buildExportFilename('Caisse_Residence', filters.startDate, filters.endDate),
        onProgress: (current, total) => setExportProgress({ current, total }),
      })
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExportProgress(null)
    }
  }

  async function handleDelete(entry) {
    if (isLocked(entry)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer le bon caisse résidence n° ${entry.bon_number} ?`)) return
    const { error: deleteError } = await supabase.from('residence_caisse').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setEntries((current) => current.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : motif, fournisseur, client, n° bon…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterClass}>
            <option value="">Tous les types</option>
            {RC_OPERATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={filterClass}>
            <option value="">Toutes catégories</option>
            {RC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className={filterClass}>
            <option value="">Tous paiements</option>
            {RC_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterClass} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted">
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          <button
            type="button"
            onClick={() => { setExportError(''); setExportModalOpen(true) }}
            disabled={exportProgress != null}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportProgress != null
              ? exportProgress.total > 0
                ? `Génération… ${exportProgress.current}/${exportProgress.total} photos`
                : 'Génération…'
              : 'Exporter Excel'}
          </button>
          <button type="button" onClick={() => setSheetModal('beneficiary')} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
            Fiche
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune opération.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Total encaissements" value={totals.encaissements} className="text-green-500" />
            <Total label="Total décaissements" value={totals.decaissements} className="text-terracotta" />
            <Total label="Total dépenses" value={totals.depenses} className="text-terracotta" />
            <Total label="Solde" value={totals.solde} className={totals.solde >= 0 ? 'text-green-500' : 'text-terracotta'} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1500px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Bon</Th>
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Type</Th>
                  <Th>Motif</Th>
                  <Th>Montant (DA)</Th>
                  <Th>Fournisseur/Bénéficiaire</Th>
                  <Th>Client</Th>
                  <Th>Paiement</Th>
                  <Th>N° Pièce</Th>
                  <Th>Catégorie</Th>
                  <Th className="no-print">Photo</Th>
                  <Th>Saisi par</Th>
                  <Th>Observations</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) =>
                  editingId === entry.id ? (
                    <EditRow key={entry.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td>{entry.bon_number}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{fmtTime(entry.entry_time)}</Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
                      <Td>{entry.operation_type}</Td>
                      <Td className="max-w-[220px] truncate" title={entry.description}>{entry.description}</Td>
                      <Td className={`text-right font-medium ${rcIsInflow(entry.operation_type) ? 'text-green-500' : 'text-terracotta'}`}>
                        {formatDA(rcSignedAmount(entry))}
                      </Td>
                      <Td>{entry.beneficiary ?? '—'}</Td>
                      <Td>{entry.client_name ?? '—'}</Td>
                      <Td>{paymentLabel(entry)}</Td>
                      <Td>{entry.piece_number ?? '—'}</Td>
                      <Td>{rcCategoryLabel(entry)}</Td>
                      <Td className="no-print">
                        {entry.photo_url ? (
                          <button type="button" onClick={() => setLightboxUrl(entry.photo_url)} className="block">
                            <img src={entry.photo_url} alt={`Bon n° ${entry.bon_number}`} className="h-10 w-10 rounded object-cover" />
                          </button>
                        ) : '—'}
                      </Td>
                      <Td>{entry.entered_by_user ?? '—'}</Td>
                      <Td className="max-w-[200px] truncate" title={entry.observations ?? ''}>{entry.observations ?? '—'}</Td>
                      <Td className="no-print">
                        <RowActions
                          entry={entry}
                          onEdit={() => startEdit(entry)}
                          onDelete={() => handleDelete(entry)}
                          onLockedAttempt={(action) => openAdminPrompt(action, entry)}
                        />
                      </Td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {lightboxUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Justificatif" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'operation_type', label: "Type d'opération", options: RC_OPERATION_TYPES }}
        textFilters={[
          { field: 'beneficiary', label: 'Fournisseur / Bénéficiaire', suggestions: exportSuggestions('beneficiary') },
          { field: 'client_name', label: 'Client', suggestions: exportSuggestions('client_name') },
        ]}
        hasPhotos
        error={exportError}
        onExport={handleExport}
        onCancel={() => setExportModalOpen(false)}
      />

      <AdminCodeModal
        prompt={adminPrompt}
        codeValue={adminCodeValue}
        onCodeChange={setAdminCodeValue}
        error={adminError}
        busy={adminBusy}
        onConfirm={confirmAdminCode}
        onCancel={closeAdminPrompt}
      />

      <EntitySheetModal
        open={sheetModal != null}
        onClose={() => setSheetModal(null)}
        modalTitle="Générer une fiche — Caisse résidence"
        types={SHEET_TYPES}
        initialType={sheetModal}
        nameOptions={sheetNameOptions}
        onGenerate={buildSheet}
        excelSheetName="Fiche caisse résidence"
      />
    </div>
  )
}

function Total({ label, value, className }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${className}`}>{formatDA(value)} DA</p>
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  const isCheque = draft.payment_mode === 'Chèque'
  const isOther = draft.category === 'Autre'
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td><input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} /></Td>
      <Td>{fmtTime(draft.entry_time)}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <select value={draft.operation_type} onChange={(e) => set('operation_type', e.target.value)} className={editInputClass}>
          {RC_OPERATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Td>
      <Td><input type="text" value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="number" step="0.01" value={draft.amount} onChange={(e) => set('amount', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="text" value={draft.beneficiary ?? ''} onChange={(e) => set('beneficiary', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="text" value={draft.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} /></Td>
      <Td>
        <div className="flex min-w-40 flex-col gap-1">
          <select value={draft.payment_mode} onChange={(e) => set('payment_mode', e.target.value)} className={editInputClass}>
            {RC_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {isCheque && (
            <>
              <input type="text" placeholder="N° chèque" value={draft.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} className={editInputClass} />
              <input type="text" placeholder="Banque" value={draft.cheque_bank ?? ''} onChange={(e) => set('cheque_bank', e.target.value)} className={editInputClass} />
            </>
          )}
        </div>
      </Td>
      <Td><input type="text" value={draft.piece_number ?? ''} onChange={(e) => set('piece_number', e.target.value)} className={editInputClass} /></Td>
      <Td>
        <div className="flex min-w-32 flex-col gap-1">
          <select value={draft.category} onChange={(e) => set('category', e.target.value)} className={editInputClass}>
            {RC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {isOther && (
            <input type="text" placeholder="Préciser" value={draft.category_other ?? ''} onChange={(e) => set('category_other', e.target.value)} className={editInputClass} />
          )}
        </div>
      </Td>
      <Td className="no-print">{draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
      <Td><input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={editInputClass} /></Td>
      <Td className="no-print">
        <div className="flex gap-2">
          <button type="button" onClick={onSave} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Enregistrer</button>
          <button type="button" onClick={onCancel} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">Annuler</button>
        </div>
      </Td>
    </tr>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</th>
}
function Td({ children, className = '', title }) {
  return <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`} title={title}>{children}</td>
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta disabled:opacity-60'
