import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadSandExcel } from '../lib/sandExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/dateFormat'
import { PAYMENT_MODES, PAID_OPTIONS, buildPaymentPayload } from '../lib/sandPayment'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'
import PrintHeader from './PrintHeader'
import { periodLabel as formatPeriodLabel, todayISO } from '../lib/period'
import { printRegistry } from '../lib/printRegistry'

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function total(entry) {
  return Number(entry.sand_total || 0) + Number(entry.transport_price || 0)
}

const SAND_SHEET_TYPES = [
  { id: 'fournisseur', label: 'Fournisseur', nameLabel: 'Fournisseur' },
  { id: 'transporteur', label: 'Transporteur', nameLabel: 'Transporteur' },
]

export default function SandRegistry() {
  const { isAdmin, isViewer } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [supplierPaidFilter, setSupplierPaidFilter] = useState('')
  const [transporterPaidFilter, setTransporterPaidFilter] = useState('')
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
  const [sheetModal, setSheetModal] = useState(null) // 'fournisseur' | 'transporteur' | null

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('sand_entries')
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
      .channel('sand-entries-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sand_entries' }, (payload) => {
        setEntries((current) => applyRealtimeChange(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const banks = useMemo(
    () => [...new Set(entries.flatMap((e) => [e.supplier_cheque_bank, e.transporter_cheque_bank]).filter(Boolean))],
    [entries]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (supplierPaidFilter && e.supplier_paid !== supplierPaidFilter) return false
      if (transporterPaidFilter && e.transporter_paid !== transporterPaidFilter) return false
      if (!q) return true
      return [e.bon_number, e.supplier_name, e.transporter_name, e.truck_plate, e.driver_name].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, supplierPaidFilter, transporterPaidFilter])

  const totals = useMemo(() => {
    const quantity = filtered.reduce((sum, e) => sum + (Number(e.quantity_tons) || 0), 0)
    const amount = filtered.reduce((sum, e) => sum + total(e), 0)
    return { count: filtered.length, quantity, amount }
  }, [filtered])

  function handlePrint() {
    const filterParts = []
    if (query.trim()) filterParts.push(`Recherche : "${query.trim()}"`)
    if (supplierPaidFilter) filterParts.push(`Statut fourn. : ${supplierPaidFilter}`)
    if (transporterPaidFilter) filterParts.push(`Statut transp. : ${transporterPaidFilter}`)

    printRegistry({
      subtitle: 'Registre Sable',
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns: [
        { key: 'bon_number', label: 'Bon' },
        { key: 'entry_date', label: 'Date' },
        { key: 'created_at', label: 'Saisie le', format: (v) => formatDateTime(v) },
        { key: 'entry_time', label: 'Heure', format: (v) => formatTime(v) },
        { key: 'supplier_name', label: 'Fournisseur' },
        { key: 'transporter_name', label: 'Transporteur' },
        { key: 'truck_plate', label: 'Matricule' },
        { key: 'driver_name', label: 'Chauffeur' },
        { key: 'quantity_tons', label: 'Quantité (T)', align: 'right', format: (v) => Number(v).toFixed(2) },
        { key: 'unit_price', label: 'Prix unit.', align: 'right', format: (v) => formatDA(v) },
        { key: 'sand_total', label: 'Total sable', align: 'right', format: (v) => formatDA(v) },
        { key: 'transport_price', label: 'Transport', align: 'right', format: (v) => formatDA(v) },
        { key: 'total_general', label: 'Total général', align: 'right', format: (v) => formatDA(v) },
        { key: 'supplier_paid', label: 'Statut fourn.' },
        { key: 'transporter_paid', label: 'Statut transp.' },
        { key: 'photo_url', label: 'Photo', format: (v) => (v ? 'Oui' : 'Non') },
        { key: 'entered_by_user', label: 'Saisi par' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((e) => ({ ...e, total_general: total(e) })),
      totals: {
        bon_number: `${totals.count} bon${totals.count > 1 ? 's' : ''}`,
        quantity_tons: totals.quantity.toFixed(2),
        total_general: formatDA(totals.amount),
      },
    })
  }

  function sheetNameOptions(typeId) {
    const field = typeId === 'transporteur' ? 'transporter_name' : 'supplier_name'
    return [...new Set(entries.map((e) => e[field]).filter(Boolean))].sort()
  }

  function buildSandSheet(typeId, name, startDate, endDate) {
    const field = typeId === 'transporteur' ? 'transporter_name' : 'supplier_name'
    const paidField = typeId === 'transporteur' ? 'transporter_paid' : 'supplier_paid'
    const label = typeId === 'transporteur' ? 'Transporteur' : 'Fournisseur'
    const otherLabel = typeId === 'transporteur' ? 'Fournisseur' : 'Transporteur'
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
        other_party: typeId === 'transporteur' ? (e.supplier_name ?? '—') : (e.transporter_name ?? '—'),
        quantity_tons: Number(e.quantity_tons) || 0,
        unit_price: Number(e.unit_price) || 0,
        sand_total: Number(e.sand_total) || 0,
        transport_price: Number(e.transport_price) || 0,
        total: total(e),
        payment_status: e[paidField] ?? 'Non payé',
      }))

    if (rows.length === 0) {
      return { error: `Aucune opération trouvée pour ${label.toLowerCase()} "${name}" sur cette période.` }
    }

    const columns = [
      { key: 'bon_number', header: 'N° Bon' },
      { key: 'entry_date', header: 'Date' },
      { key: 'other_party', header: otherLabel },
      { key: 'quantity_tons', header: 'Quantité (T)', align: 'right', format: (v) => Number(v).toFixed(2) },
      { key: 'unit_price', header: 'Prix unitaire', align: 'right', format: (v) => formatDA(v) },
      { key: 'sand_total', header: 'Total Sable', align: 'right', format: (v) => formatDA(v) },
      { key: 'transport_price', header: 'Transport', align: 'right', format: (v) => formatDA(v) },
      { key: 'total', header: 'Total', align: 'right', format: (v) => formatDA(v) },
      { key: 'payment_status', header: 'Statut paiement' },
    ]

    const quantitySum = rows.reduce((s, r) => s + r.quantity_tons, 0)
    const totalSum = rows.reduce((s, r) => s + r.total, 0)
    const dueAmountField = typeId === 'transporteur' ? 'transport_price' : 'sand_total'
    const dueSum = rows.filter((r) => r.payment_status !== 'Payé').reduce((s, r) => s + r[dueAmountField], 0)

    return {
      title: `Relevé ${label} : ${name}`,
      periodLabel: formatPeriodLabel(startDate, endDate),
      columns,
      rows,
      totalRows: [
        { cells: { bon_number: 'TOTAL', quantity_tons: quantitySum, total: totalSum } },
        { cells: { bon_number: 'RESTE À PAYER', total: dueSum }, highlight: true },
      ],
      excelFilename: `Fiche_${label}_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
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
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      supplier_name: editDraft.supplier_name.trim(),
      transporter_name: editDraft.transporter_name?.trim() || null,
      truck_plate: editDraft.truck_plate?.trim() || null,
      driver_name: editDraft.driver_name?.trim() || null,
      quantity_tons: Number(editDraft.quantity_tons),
      unit_price: Number(editDraft.unit_price),
      transport_price: Number(editDraft.transport_price),
      observations: editDraft.observations?.trim() || null,
      ...buildPaymentPayload(editDraft, 'supplier'),
      ...buildPaymentPayload(editDraft, 'transporter'),
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_sand', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_bon_number: payload.bon_number,
          p_entry_date: payload.entry_date,
          p_supplier_name: payload.supplier_name,
          p_transporter_name: payload.transporter_name,
          p_truck_plate: payload.truck_plate,
          p_driver_name: payload.driver_name,
          p_quantity_tons: payload.quantity_tons,
          p_unit_price: payload.unit_price,
          p_transport_price: payload.transport_price,
          p_observations: payload.observations,
          p_supplier_paid: payload.supplier_paid,
          p_supplier_payment_mode: payload.supplier_payment_mode,
          p_supplier_cheque_number: payload.supplier_cheque_number,
          p_supplier_cheque_bank: payload.supplier_cheque_bank,
          p_supplier_payment_date: payload.supplier_payment_date,
          p_supplier_amount_paid: payload.supplier_amount_paid,
          p_transporter_paid: payload.transporter_paid,
          p_transporter_payment_mode: payload.transporter_payment_mode,
          p_transporter_cheque_number: payload.transporter_cheque_number,
          p_transporter_cheque_bank: payload.transporter_cheque_bank,
          p_transporter_payment_date: payload.transporter_payment_date,
          p_transporter_amount_paid: payload.transporter_amount_paid,
        })
      : await supabase.from('sand_entries').update(payload).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_sand', {
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
    const toExport = applyExportFilters(entries, filters)
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadSandExcel(toExport, {
        includePhotos,
        filename: buildExportFilename('Registre_Sable', filters.startDate, filters.endDate),
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
    const ok = window.confirm(`Supprimer le bon sable n° ${entry.bon_number} (${entry.supplier_name}) ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('sand_entries').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setEntries((current) => current.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : bon, fournisseur, transporteur, matricule, chauffeur…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={supplierPaidFilter}
            onChange={(e) => setSupplierPaidFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Statut fourn. : tous</option>
            {PAID_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select
            value={transporterPaidFilter}
            onChange={(e) => setTransporterPaidFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Statut transp. : tous</option>
            {PAID_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
          >
            Imprimer
          </button>
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
            onClick={() => setSheetModal('fournisseur')}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Fiche fournisseur
          </button>
          <button
            type="button"
            onClick={() => setSheetModal('transporteur')}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Fiche transporteur
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
        <p className="text-ink-muted">Aucune livraison.</p>
      ) : (
        <div className="print-area">
          <PrintHeader title="Registre sable" />

          <div className="mb-4 flex gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Bons</p>
              <p className="font-display text-xl text-ocre">{totals.count}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Quantité cumulée</p>
              <p className="font-display text-xl text-ocre">{totals.quantity.toFixed(2)} T</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Total (DA)</p>
              <p className="font-display text-xl text-ocre">{totals.amount.toLocaleString('fr-FR')}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1900px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>Bon</Th>
                  <Th>Date</Th>
                  <Th>Saisie le</Th>
                  <Th>Heure</Th>
                  <Th>Fournisseur</Th>
                  <Th>Transporteur</Th>
                  <Th>Matricule</Th>
                  <Th>Chauffeur</Th>
                  <Th>Quantité (T)</Th>
                  <Th>Prix unit.</Th>
                  <Th>Total sable (DA)</Th>
                  <Th>Transport (DA)</Th>
                  <Th>Total général (DA)</Th>
                  <Th>Statut fourn.</Th>
                  <Th>Statut transp.</Th>
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
                      bankSuggestions={banks}
                    />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td sticky>{entry.bon_number}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
                      <Td>{formatTime(entry.entry_time)}</Td>
                      <Td>{entry.supplier_name}</Td>
                      <Td>{entry.transporter_name ?? '—'}</Td>
                      <Td>{entry.truck_plate ?? '—'}</Td>
                      <Td>{entry.driver_name ?? '—'}</Td>
                      <Td>{entry.quantity_tons}</Td>
                      <Td>{entry.unit_price}</Td>
                      <Td>{Number(entry.sand_total || 0).toLocaleString('fr-FR')}</Td>
                      <Td>{entry.transport_price}</Td>
                      <Td>{total(entry).toLocaleString('fr-FR')}</Td>
                      <Td>
                        <PaidBadge status={entry.supplier_paid} />
                      </Td>
                      <Td>
                        <PaidBadge status={entry.transporter_paid} />
                      </Td>
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
          <img src={lightboxUrl} alt="Bon" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <ExportFilterModal
        open={exportModalOpen}
        textFilters={[
          { field: 'supplier_name', label: 'Fournisseur', suggestions: exportSuggestions('supplier_name') },
          { field: 'transporter_name', label: 'Transporteur', suggestions: exportSuggestions('transporter_name') },
          { field: 'truck_plate', label: 'Matricule', suggestions: exportSuggestions('truck_plate') },
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
        types={SAND_SHEET_TYPES}
        initialType={sheetModal}
        nameOptions={sheetNameOptions}
        onGenerate={buildSandSheet}
        excelSheetName="Fiche sable"
      />
    </div>
  )
}

function PaidBadge({ status }) {
  const isPaid = status === 'Payé'
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
        isPaid ? 'border-green-500/50 bg-green-500/10 text-green-500' : 'border-terracotta/50 bg-terracotta/10 text-terracotta'
      }`}
    >
      {status ?? 'Non payé'}
    </span>
  )
}

function PaymentEditCell({ prefix, draft, set, bankSuggestions, defaultAmount }) {
  const paid = draft[`${prefix}_paid`]
  const mode = draft[`${prefix}_payment_mode`]

  function setPaid(value) {
    set(`${prefix}_paid`, value)
    if (value === 'Payé' && !draft[`${prefix}_amount_paid`]) {
      set(`${prefix}_amount_paid`, String(defaultAmount))
    }
  }

  return (
    <div className="flex min-w-40 flex-col gap-1">
      <select value={paid ?? 'Non payé'} onChange={(e) => setPaid(e.target.value)} className={editInputClass}>
        {PAID_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {paid === 'Payé' && (
        <>
          <select
            value={mode ?? ''}
            onChange={(e) => set(`${prefix}_payment_mode`, e.target.value)}
            className={editInputClass}
          >
            <option value="">Mode…</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {mode === 'Chèque' && (
            <>
              <input
                type="text"
                placeholder="N° chèque"
                value={draft[`${prefix}_cheque_number`] ?? ''}
                onChange={(e) => set(`${prefix}_cheque_number`, e.target.value)}
                className={editInputClass}
              />
              <input
                type="text"
                list={`${prefix}-edit-banks-list`}
                placeholder="Banque"
                value={draft[`${prefix}_cheque_bank`] ?? ''}
                onChange={(e) => set(`${prefix}_cheque_bank`, e.target.value)}
                className={editInputClass}
              />
              <datalist id={`${prefix}-edit-banks-list`}>
                {bankSuggestions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </>
          )}
          <input
            type="date"
            value={draft[`${prefix}_payment_date`] ?? ''}
            onChange={(e) => set(`${prefix}_payment_date`, e.target.value)}
            className={editInputClass}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Montant"
            value={draft[`${prefix}_amount_paid`] ?? ''}
            onChange={(e) => set(`${prefix}_amount_paid`, e.target.value)}
            className={editInputClass}
          />
        </>
      )}
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel, bankSuggestions }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  const sandTotal = (Number(draft.quantity_tons) || 0) * (Number(draft.unit_price) || 0)

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td sticky="bg-bg-soft">
        <input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>
        <input type="text" value={draft.supplier_name} onChange={(e) => set('supplier_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.transporter_name ?? ''} onChange={(e) => set('transporter_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.truck_plate ?? ''} onChange={(e) => set('truck_plate', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.driver_name ?? ''} onChange={(e) => set('driver_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.quantity_tons} onChange={(e) => set('quantity_tons', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.unit_price} onChange={(e) => set('unit_price', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{sandTotal.toLocaleString('fr-FR')}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.transport_price} onChange={(e) => set('transport_price', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{(sandTotal + (Number(draft.transport_price) || 0)).toLocaleString('fr-FR')}</Td>
      <Td>
        <PaymentEditCell prefix="supplier" draft={draft} set={set} bankSuggestions={bankSuggestions} defaultAmount={sandTotal} />
      </Td>
      <Td>
        <PaymentEditCell
          prefix="transporter"
          draft={draft}
          set={set}
          bankSuggestions={bankSuggestions}
          defaultAmount={Number(draft.transport_price) || 0}
        />
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
