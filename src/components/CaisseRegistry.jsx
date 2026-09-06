import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadCaisseExcel } from '../lib/caisseExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/dateFormat'
import {
  OPERATION_TYPES,
  PAYMENT_MODES,
  CATEGORIES,
  categoryLabel,
  isInflow,
  signedAmount,
  formatDA,
} from '../lib/caisse'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'
import PrintHeader from './PrintHeader'
import { periodLabel as formatPeriodLabel, todayISO } from '../lib/period'
import PrintSelectionModal from './PrintSelectionModal'

const CAISSE_SHEET_TYPES = [
  { id: 'beneficiary', label: 'Fournisseur / Bénéficiaire', nameLabel: 'Fournisseur / Bénéficiaire' },
  { id: 'client', label: 'Client', nameLabel: 'Client' },
]

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

function paymentLabel(entry) {
  if (entry.payment_mode === 'Chèque' && entry.cheque_number) {
    return `Chèque n° ${entry.cheque_number}${entry.cheque_bank ? ` (${entry.cheque_bank})` : ''}`
  }
  return entry.payment_mode ?? '—'
}

export default function CaisseRegistry() {
  const { isAdmin, isViewer } = useAuth()
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
        .from('caisse_entries')
        .select('*')
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) {
        setError(`Erreur de chargement : ${fetchError.message}`)
      } else {
        setEntries(data ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('caisse-entries-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caisse_entries' }, (payload) => {
        setEntries((current) => applyRealtimeChange(current, payload))
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
      return [e.bon_number, e.description, e.beneficiary, e.client_name].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
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
    const filterParts = []
    if (query.trim()) filterParts.push(`Recherche : "${query.trim()}"`)
    if (typeFilter) filterParts.push(`Type : ${typeFilter}`)
    if (categoryFilter) filterParts.push(`Catégorie : ${categoryFilter}`)
    if (dateFilter) filterParts.push(`Date : ${dateFilter}`)
    if (paymentFilter) filterParts.push(`Paiement : ${paymentFilter}`)

    return {
      subtitle: 'Registre Caisse',
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns: [
        { key: 'bon_number', label: 'Bon' },
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: (v) => formatTime(v) },
        { key: 'created_at', label: 'Saisie le', format: (v) => formatDateTime(v) },
        { key: 'operation_type', label: 'Type' },
        { key: 'description', label: 'Motif' },
        { key: 'signed_amount', label: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'beneficiary', label: 'Fournisseur/Bénéficiaire' },
        { key: 'client_name', label: 'Client' },
        { key: 'payment', label: 'Paiement' },
        { key: 'piece_number', label: 'N° Pièce' },
        { key: 'category_label', label: 'Catégorie' },
        { key: 'photo_url', label: 'Photo', format: (v) => (v ? 'Oui' : 'Non') },
        { key: 'entered_by_user', label: 'Saisi par' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((e) => ({
        ...e,
        signed_amount: signedAmount(e),
        payment: paymentLabel(e),
        category_label: categoryLabel(e),
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

  function buildCaisseSheet(typeId, name, startDate, endDate) {
    const field = typeId === 'client' ? 'client_name' : 'beneficiary'
    const label = typeId === 'client' ? 'Client' : 'Fournisseur / Bénéficiaire'
    const nameLower = name.trim().toLowerCase()

    const rows = entries
      .filter((e) => {
        if (String(e[field] ?? '').trim().toLowerCase() !== nameLower) return false
        if (startDate && e.entry_date < startDate) return false
        if (endDate && e.entry_date > endDate) return false
        return true
      })
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
      .map((e) => ({
        bon_number: e.bon_number,
        entry_date: e.entry_date,
        operation_type: e.operation_type,
        description: e.description,
        payment_mode: e.payment_mode ?? '—',
        amount: signedAmount(e),
      }))

    if (rows.length === 0) {
      return { error: `Aucune opération trouvée pour « ${name} » sur cette période.` }
    }

    const columns = [
      { key: 'bon_number', header: 'N° Bon' },
      { key: 'entry_date', header: 'Date' },
      { key: 'operation_type', header: 'Type' },
      { key: 'description', header: 'Motif / Libellé' },
      { key: 'payment_mode', header: 'Paiement' },
      { key: 'amount', header: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
    ]

    const net = rows.reduce((s, r) => s + r.amount, 0)

    return {
      title: `Relevé Caisse — ${label} : ${name}`,
      periodLabel: formatPeriodLabel(startDate, endDate),
      columns,
      rows,
      totalRows: [{ cells: { bon_number: 'SOLDE NET', amount: net }, highlight: true }],
      excelFilename: `Fiche_Caisse_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
    }
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
      ? await supabase.rpc('admin_update_caisse', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_bon_number: payload.bon_number,
          p_entry_date: payload.entry_date,
          p_operation_type: payload.operation_type,
          p_description: payload.description,
          p_amount: payload.amount,
          p_beneficiary: payload.beneficiary,
          p_client_name: payload.client_name,
          p_payment_mode: payload.payment_mode,
          p_cheque_number: payload.cheque_number,
          p_cheque_bank: payload.cheque_bank,
          p_piece_number: payload.piece_number,
          p_category: payload.category,
          p_category_other: payload.category_other,
          p_observations: payload.observations,
        })
      : await supabase.from('caisse_entries').update(payload).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setEntries((current) => current.map((e) => (e.id === data.id ? data : e)))
    cancelEdit()
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
    const { error: rpcError } = await supabase.rpc('admin_delete_caisse', {
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
      await downloadCaisseExcel(toExport, {
        includePhotos,
        filename: buildExportFilename('Registre_Caisse', filters.startDate, filters.endDate),
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
    const ok = window.confirm(`Supprimer le bon caisse n° ${entry.bon_number} ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('caisse_entries').delete().eq('id', entry.id)
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
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Tous les types</option>
            {OPERATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Toutes catégories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Tous paiements</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPrintOpen(true)}
            className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
          >
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          {!isViewer && (
            <button
              type="button"
              onClick={() => { setExportError(''); setExportModalOpen(true) }}
              disabled={exportProgress != null}
              className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportProgress != null
                ? exportProgress.total > 0
                  ? `Génération en cours… ${exportProgress.current}/${exportProgress.total} photos`
                  : 'Génération en cours…'
                : 'Exporter Excel'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSheetModal('beneficiary')}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Fiche
          </button>
        </div>
      </div>

      {error && (
        <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune opération.</p>
      ) : (
        <div className="print-area">
          <PrintHeader title="Registre caisse" />

          <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Total encaissements" value={totals.encaissements} className="text-green-500" />
            <Total label="Total décaissements" value={totals.decaissements} className="text-terracotta" />
            <Total label="Total dépenses" value={totals.depenses} className="text-terracotta" />
            <Total
              label="Solde"
              value={totals.solde}
              className={totals.solde >= 0 ? 'text-green-500' : 'text-terracotta'}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1700px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>Bon</Th>
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
                  <Th>Photo</Th>
                  <Th>Saisi par</Th>
                  <Th>Observations</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) =>
                  editingId === entry.id ? (
                    <EditRow
                      key={entry.id}
                      draft={editDraft}
                      onChange={setEditDraft}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td sticky>{entry.bon_number}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{formatTime(entry.entry_time)}</Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
                      <Td>{entry.operation_type}</Td>
                      <Td className="max-w-[220px] truncate" title={entry.description}>
                        {entry.description}
                      </Td>
                      <Td
                        className={`text-right font-medium ${
                          isInflow(entry.operation_type) ? 'text-green-500' : 'text-terracotta'
                        }`}
                      >
                        {formatDA(signedAmount(entry))}
                      </Td>
                      <Td>{entry.beneficiary ?? '—'}</Td>
                      <Td>{entry.client_name ?? '—'}</Td>
                      <Td>{paymentLabel(entry)}</Td>
                      <Td>{entry.piece_number ?? '—'}</Td>
                      <Td>{categoryLabel(entry)}</Td>
                      <Td>
                        {entry.photo_url ? (
                          <button type="button" onClick={() => setLightboxUrl(entry.photo_url)} className="block">
                            <img
                              src={entry.photo_url}
                              alt={`Bon n° ${entry.bon_number}`}
                              className="h-10 w-10 rounded object-cover"
                            />
                          </button>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{entry.entered_by_user ?? '—'}</Td>
                      <Td className="max-w-[200px] truncate" title={entry.observations ?? ''}>
                        {entry.observations ?? '—'}
                      </Td>
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
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Justificatif" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'operation_type', label: "Type d'opération", options: OPERATION_TYPES }}
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
        modalTitle="Générer une fiche"
        types={CAISSE_SHEET_TYPES}
        initialType={sheetModal}
        nameOptions={sheetNameOptions}
        onGenerate={buildCaisseSheet}
        excelSheetName="Fiche caisse"
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
      <Td sticky="bg-bg-soft">
        <input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <select value={draft.operation_type} onChange={(e) => set('operation_type', e.target.value)} className={editInputClass}>
          {OPERATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Td>
      <Td>
        <input type="text" value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.amount} onChange={(e) => set('amount', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.beneficiary ?? ''} onChange={(e) => set('beneficiary', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <div className="flex min-w-40 flex-col gap-1">
          <select value={draft.payment_mode} onChange={(e) => set('payment_mode', e.target.value)} className={editInputClass}>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {isCheque && (
            <>
              <input
                type="text"
                placeholder="N° chèque"
                value={draft.cheque_number ?? ''}
                onChange={(e) => set('cheque_number', e.target.value)}
                className={editInputClass}
              />
              <input
                type="text"
                placeholder="Banque"
                value={draft.cheque_bank ?? ''}
                onChange={(e) => set('cheque_bank', e.target.value)}
                className={editInputClass}
              />
            </>
          )}
        </div>
      </Td>
      <Td>
        <input type="text" value={draft.piece_number ?? ''} onChange={(e) => set('piece_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <div className="flex min-w-32 flex-col gap-1">
          <select value={draft.category} onChange={(e) => set('category', e.target.value)} className={editInputClass}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {isOther && (
            <input
              type="text"
              placeholder="Préciser"
              value={draft.category_other ?? ''}
              onChange={(e) => set('category_other', e.target.value)}
              className={editInputClass}
            />
          )}
        </div>
      </Td>
      <Td>{draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
      <Td>
        <input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={editInputClass} />
      </Td>
      <Td className="no-print">
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

function Th({ children, sticky, className = '' }) {
  return (
    <th
      className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${
        sticky ? 'sticky left-0 z-20 bg-bg-soft' : ''
      } ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '', title, sticky }) {
  const stickyClass = sticky ? `sticky left-0 z-10 ${sticky === true ? 'bg-bg-card' : sticky}` : ''
  return (
    <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${stickyClass} ${className}`} title={title}>
      {children}
    </td>
  )
}

const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta disabled:opacity-60'

function applyRealtimeChange(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((e) => e.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') {
    return current.map((e) => (e.id === payload.new.id ? payload.new : e))
  }
  if (payload.eventType === 'DELETE') {
    return current.filter((e) => e.id !== payload.old.id)
  }
  return current
}
