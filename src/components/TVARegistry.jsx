import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadTvaExcel } from '../lib/tvaExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/dateFormat'
import { PAYMENT_MODES, MONTHS, recoveryLabel } from '../lib/tvaPayment'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'
import PrintHeader from './PrintHeader'
import { periodLabel as formatPeriodLabel, todayISO } from '../lib/period'
import PrintSelectionModal from './PrintSelectionModal'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function formatDANullable(value) {
  return value == null ? '—' : formatDA(value)
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

export default function TVARegistry({ entityFilter }) {
  const { isAdmin, isViewer } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
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
  const [sheetModalOpen, setSheetModalOpen] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      let query = supabase
        .from('tva_entries')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (entityFilter) query = query.eq('entity', entityFilter)
      const { data, error: fetchError } = await query
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
      .channel(`tva-entries-registry-${entityFilter ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tva_entries',
          ...(entityFilter ? { filter: `entity=eq.${entityFilter}` } : {}),
        },
        (payload) => {
          setEntries((current) => applyRealtimeChange(current, payload))
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [entityFilter])

  const banks = useMemo(() => [...new Set(entries.map((e) => e.cheque_bank).filter(Boolean))], [entries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (monthFilter && String(e.recovery_month) !== monthFilter) return false
      if (yearFilter && String(e.recovery_year) !== yearFilter) return false
      if (paymentFilter && e.payment_mode !== paymentFilter) return false
      if (!q) return true
      return [e.invoice_number, e.supplier_name].some((field) => String(field ?? '').toLowerCase().includes(q))
    })
  }, [entries, query, monthFilter, yearFilter, paymentFilter])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, e) => ({
        count: acc.count + 1,
        totalHt: acc.totalHt + Number(e.total_ht || 0),
        tva: acc.tva + Number(e.tva_amount || 0),
        totalTtc: acc.totalTtc + Number(e.total_ttc || 0),
        totalNet: acc.totalNet + Number(e.total_net || 0),
      }),
      { count: 0, totalHt: 0, tva: 0, totalTtc: 0, totalNet: 0 }
    )
  }, [filtered])

  function buildPrintConfig() {
    const filterParts = []
    if (query.trim()) filterParts.push(`Recherche : "${query.trim()}"`)
    if (monthFilter) filterParts.push(`Mois récup. : ${monthFilter}`)
    if (yearFilter) filterParts.push(`Année : ${yearFilter}`)
    if (paymentFilter) filterParts.push(`Paiement : ${paymentFilter}`)

    return {
      subtitle: 'Registre TVA',
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns: [
        { key: 'invoice_number', label: 'N° Fact' },
        { key: 'entity', label: 'Entité' },
        { key: 'piece_number', label: 'N° Pièce' },
        { key: 'entry_date', label: 'Date' },
        { key: 'created_at', label: 'Saisie le', format: (v) => formatDateTime(v) },
        { key: 'recovery', label: 'Mois récup.' },
        { key: 'supplier_name', label: 'Fournisseur' },
        { key: 'supplier_address', label: 'Adresse' },
        { key: 'total_ht', label: 'HT', align: 'right', format: (v) => formatDA(v) },
        { key: 'discount_amount', label: 'Remise', align: 'right', format: (v) => formatDA(v) },
        { key: 'ht_net', label: 'HT Net', align: 'right', format: (v) => formatDA(v) },
        { key: 'tva_amount', label: 'TVA', align: 'right', format: (v) => formatDA(v) },
        { key: 'dd_amount', label: 'DD', align: 'right', format: (v) => formatDA(v) },
        { key: 'total_ttc', label: 'TTC', align: 'right', format: (v) => formatDA(v) },
        { key: 'stamp_duty', label: 'Timbre', align: 'right', format: (v) => formatDA(v) },
        { key: 'total_net', label: 'Total Net', align: 'right', format: (v) => formatDA(v) },
        { key: 'payment_mode', label: 'Paiement' },
        { key: 'photo_url', label: 'Photo', format: (v) => (v ? 'Oui' : 'Non') },
        { key: 'entered_by_user', label: 'Saisi par' },
      ],
      rows: filtered.map((e) => ({ ...e, recovery: recoveryLabel(e.recovery_month, e.recovery_year) })),
      totals: {
        invoice_number: 'TOTAL',
        total_ht: formatDA(totals.totalHt),
        tva_amount: formatDA(totals.tva),
        total_ttc: formatDA(totals.totalTtc),
        total_net: formatDA(totals.totalNet),
      },
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
    const payload = {
      invoice_number: editDraft.invoice_number.trim(),
      piece_number: editDraft.piece_number?.trim() || null,
      entry_date: editDraft.entry_date,
      recovery_month: editDraft.recovery_month === '' || editDraft.recovery_month == null ? null : Number(editDraft.recovery_month),
      recovery_year: editDraft.recovery_year === '' || editDraft.recovery_year == null ? null : Number(editDraft.recovery_year),
      supplier_name: editDraft.supplier_name.trim(),
      supplier_address: editDraft.supplier_address?.trim() || null,
      nif: editDraft.nif?.trim() || null,
      nis: editDraft.nis?.trim() || null,
      article: editDraft.article?.trim() || null,
      rc_number: editDraft.rc_number?.trim() || null,
      phone: editDraft.phone?.trim() || null,
      total_ht: editDraft.total_ht === '' || editDraft.total_ht == null ? null : Number(editDraft.total_ht),
      discount_amount: Number(editDraft.discount_amount) || 0,
      tva_amount: Number(editDraft.tva_amount) || 0,
      dd_amount: Number(editDraft.dd_amount) || 0,
      stamp_duty: Number(editDraft.stamp_duty) || 0,
      payment_mode: editDraft.payment_mode,
      cheque_number: isCheque ? (editDraft.cheque_number || '').trim() : null,
      cheque_bank: isCheque ? (editDraft.cheque_bank || '').trim() || null : null,
      payment_piece: editDraft.payment_piece?.trim() || null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_tva', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_invoice_number: payload.invoice_number,
          p_piece_number: payload.piece_number,
          p_entry_date: payload.entry_date,
          p_recovery_month: payload.recovery_month,
          p_recovery_year: payload.recovery_year,
          p_supplier_name: payload.supplier_name,
          p_supplier_address: payload.supplier_address,
          p_nif: payload.nif,
          p_nis: payload.nis,
          p_article: payload.article,
          p_rc_number: payload.rc_number,
          p_phone: payload.phone,
          p_total_ht: payload.total_ht,
          p_discount_amount: payload.discount_amount,
          p_tva_amount: payload.tva_amount,
          p_dd_amount: payload.dd_amount,
          p_stamp_duty: payload.stamp_duty,
          p_payment_mode: payload.payment_mode,
          p_cheque_number: payload.cheque_number,
          p_cheque_bank: payload.cheque_bank,
          p_payment_piece: payload.payment_piece,
          p_observations: payload.observations,
        })
      : await supabase.from('tva_entries').update(payload).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_tva', {
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

  function sheetSupplierOptions() {
    return [...new Set(entries.map((e) => e.supplier_name).filter(Boolean))].sort()
  }

  function buildTvaSheet(_typeId, name, startDate, endDate) {
    const nameLower = name.trim().toLowerCase()
    const rows = entries
      .filter((e) => {
        if (String(e.supplier_name ?? '').trim().toLowerCase() !== nameLower) return false
        if (startDate && e.entry_date < startDate) return false
        if (endDate && e.entry_date > endDate) return false
        return true
      })
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
      .map((e) => ({
        invoice_number: e.invoice_number,
        entry_date: e.entry_date,
        total_ht: e.total_ht == null ? null : Number(e.total_ht),
        tva_amount: Number(e.tva_amount) || 0,
        total_ttc: Number(e.total_ttc) || 0,
        stamp_duty: Number(e.stamp_duty) || 0,
        total_net: Number(e.total_net) || 0,
        payment_mode: e.payment_mode ?? 'Non payé',
      }))

    if (rows.length === 0) {
      return { error: `Aucune facture trouvée pour le fournisseur "${name}" sur cette période.` }
    }

    const columns = [
      { key: 'invoice_number', header: 'N° Facture' },
      { key: 'entry_date', header: 'Date' },
      { key: 'total_ht', header: 'HT', align: 'right', format: (v) => formatDA(v) },
      { key: 'tva_amount', header: 'TVA', align: 'right', format: (v) => formatDA(v) },
      { key: 'total_ttc', header: 'TTC', align: 'right', format: (v) => formatDA(v) },
      { key: 'stamp_duty', header: 'Timbre', align: 'right', format: (v) => formatDA(v) },
      { key: 'total_net', header: 'Total Net', align: 'right', format: (v) => formatDA(v) },
      { key: 'payment_mode', header: 'Paiement' },
    ]

    const sums = rows.reduce(
      (acc, r) => ({
        total_ht: acc.total_ht + (Number(r.total_ht) || 0),
        tva_amount: acc.tva_amount + r.tva_amount,
        total_ttc: acc.total_ttc + r.total_ttc,
        stamp_duty: acc.stamp_duty + r.stamp_duty,
        total_net: acc.total_net + r.total_net,
      }),
      { total_ht: 0, tva_amount: 0, total_ttc: 0, stamp_duty: 0, total_net: 0 }
    )

    return {
      title: `Relevé Fournisseur TVA : ${name}`,
      periodLabel: formatPeriodLabel(startDate, endDate),
      columns,
      rows,
      totalRows: [{ cells: { invoice_number: 'TOTAL', ...sums } }],
      excelFilename: `Fiche_Fournisseur_TVA_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
    }
  }

  async function handleExport(filters) {
    const withRecoveryLabel = entries.map((e) => ({ ...e, recovery_label: recoveryLabel(e.recovery_month, e.recovery_year) }))
    const toExport = applyExportFilters(withRecoveryLabel, { ...filters, categoricalField: 'recovery_label' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress(true)
    try {
      await downloadTvaExcel(toExport, {
        filename: buildExportFilename('Registre_TVA', filters.startDate, filters.endDate),
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
    const ok = window.confirm(`Supprimer la facture n° ${entry.invoice_number} (${entry.supplier_name}) ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('tva_entries').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setEntries((current) => current.filter((e) => e.id !== entry.id))
  }

  const recoveryLabelOptions = useMemo(
    () => [...new Set(entries.map((e) => recoveryLabel(e.recovery_month, e.recovery_year)))],
    [entries]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : n° facture, fournisseur…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Mois récup. : tous</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Année : toutes</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Paiement : tous</option>
            {PAYMENT_MODES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 gap-2">
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
              {exportProgress != null ? 'Génération en cours…' : 'Exporter Excel'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSheetModalOpen(true)}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Fiche fournisseur
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
        <p className="text-ink-muted">Aucune facture.</p>
      ) : (
        <div className="print-area">
          <PrintHeader title="Registre TVA" />

          <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Factures</p>
              <p className="font-display text-xl text-ocre">{totals.count}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Total HT</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.totalHt)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">TVA</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.tva)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">TTC</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.totalTtc)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Total Net</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.totalNet)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[2000px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>N° Fact</Th>
                  <Th>Entité</Th>
                  <Th>N° Pièce</Th>
                  <Th>Date</Th>
                  <Th>Saisie le</Th>
                  <Th>Mois récup.</Th>
                  <Th>Fournisseur</Th>
                  <Th>Adresse</Th>
                  <Th>HT</Th>
                  <Th>Remise</Th>
                  <Th>HT Net</Th>
                  <Th>TVA</Th>
                  <Th>DD</Th>
                  <Th>TTC</Th>
                  <Th>Timbre</Th>
                  <Th>Total Net</Th>
                  <Th>Paiement</Th>
                  <Th>Photo</Th>
                  <Th>Saisi par</Th>
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
                      <Td sticky>{entry.invoice_number}</Td>
                      <Td>{entry.entity ?? '—'}</Td>
                      <Td>{entry.piece_number ?? '—'}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
                      <Td>{recoveryLabel(entry.recovery_month, entry.recovery_year)}</Td>
                      <Td>{entry.supplier_name}</Td>
                      <Td>{entry.supplier_address ?? '—'}</Td>
                      <Td>{formatDANullable(entry.total_ht)}</Td>
                      <Td>{formatDA(entry.discount_amount)}</Td>
                      <Td>{formatDA(entry.ht_net)}</Td>
                      <Td>{formatDA(entry.tva_amount)}</Td>
                      <Td>{formatDA(entry.dd_amount)}</Td>
                      <Td>{formatDA(entry.total_ttc)}</Td>
                      <Td>{formatDA(entry.stamp_duty)}</Td>
                      <Td>
                        <span className="font-display text-ocre">{formatDA(entry.total_net)}</span>
                      </Td>
                      <Td>
                        <PaymentBadge mode={entry.payment_mode} />
                      </Td>
                      <Td>
                        <PhotoThumb url={entry.photo_url} onClick={setLightboxUrl} label={`Facture n° ${entry.invoice_number}`} />
                      </Td>
                      <Td>{entry.entered_by_user ?? '—'}</Td>
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
          <img src={lightboxUrl} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'recovery_label', label: 'Mois de récupération', options: recoveryLabelOptions }}
        textFilters={[{ field: 'supplier_name', label: 'Fournisseur', suggestions: exportSuggestions('supplier_name') }]}
        hasPhotos={false}
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
        open={sheetModalOpen}
        onClose={() => setSheetModalOpen(false)}
        modalTitle="Fiche fournisseur"
        nameLabel="Fournisseur"
        nameOptions={sheetSupplierOptions}
        onGenerate={buildTvaSheet}
        excelSheetName="Fiche TVA"
      />
    </div>
  )
}

function PaymentBadge({ mode }) {
  const paid = mode && mode !== 'Non payé'
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
        paid ? 'border-green-500/50 bg-green-500/10 text-green-500' : 'border-terracotta/50 bg-terracotta/10 text-terracotta'
      }`}
    >
      {mode ?? 'Non payé'}
    </span>
  )
}

function PhotoThumb({ url, onClick, label }) {
  if (!url) return '—'
  return (
    <button type="button" onClick={() => onClick(url)} className="block">
      <img src={url} alt={label} className="h-10 w-10 rounded object-cover" />
    </button>
  )
}

function EditRow({ draft, onChange, onSave, onCancel, bankSuggestions }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  const totalHt = Number(draft.total_ht) || 0
  const discountAmount = Number(draft.discount_amount) || 0
  const htNet = totalHt - discountAmount
  const tvaAmount = Number(draft.tva_amount) || 0
  const totalTtc = htNet + tvaAmount
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalNet = totalTtc + stampDuty

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td sticky="bg-bg-soft">
        <input type="text" value={draft.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{draft.entity ?? '—'}</Td>
      <Td>
        <input type="text" value={draft.piece_number ?? ''} onChange={(e) => set('piece_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <div className="flex min-w-32 flex-col gap-1">
          <select value={draft.recovery_month ?? ''} onChange={(e) => set('recovery_month', e.target.value)} className={editInputClass}>
            <option value="">—</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select value={draft.recovery_year ?? ''} onChange={(e) => set('recovery_year', e.target.value)} className={editInputClass}>
            <option value="">—</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </Td>
      <Td>
        <input type="text" value={draft.supplier_name} onChange={(e) => set('supplier_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.supplier_address ?? ''} onChange={(e) => set('supplier_address', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.total_ht ?? ''} onChange={(e) => set('total_ht', e.target.value)} className={editInputClass} placeholder="vide = quittance douane" />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.discount_amount} onChange={(e) => set('discount_amount', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDA(htNet)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.tva_amount} onChange={(e) => set('tva_amount', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.dd_amount} onChange={(e) => set('dd_amount', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDA(totalTtc)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.stamp_duty} onChange={(e) => set('stamp_duty', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <span className="font-display text-ocre">{formatDA(totalNet)}</span>
      </Td>
      <Td>
        <div className="flex min-w-36 flex-col gap-1">
          <select value={draft.payment_mode ?? 'Non payé'} onChange={(e) => set('payment_mode', e.target.value)} className={editInputClass}>
            {PAYMENT_MODES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {draft.payment_mode === 'Chèque' && (
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
                list="tva-edit-banks-list"
                placeholder="Banque"
                value={draft.cheque_bank ?? ''}
                onChange={(e) => set('cheque_bank', e.target.value)}
                className={editInputClass}
              />
              <datalist id="tva-edit-banks-list">
                {bankSuggestions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </>
          )}
        </div>
      </Td>
      <Td>{draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
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
    return [payload.new, ...current].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') {
    return current.map((e) => (e.id === payload.new.id ? payload.new : e))
  }
  if (payload.eventType === 'DELETE') {
    return current.filter((e) => e.id !== payload.old.id)
  }
  return current
}
