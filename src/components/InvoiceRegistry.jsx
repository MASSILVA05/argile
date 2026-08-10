import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadInvoicesExcel } from '../lib/invoicesExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { PAYMENT_STATUSES, DESIGNATIONS, PAYMENT_TYPES, isInvoicePaid } from '../lib/invoicePayment'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import PrintHeader from './PrintHeader'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function designationLabel(entry) {
  return entry.designation === 'Autre' ? entry.designation_other || 'Autre' : entry.designation
}

export default function InvoiceRegistry() {
  const { isAdmin, isViewer } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [exportProgress, setExportProgress] = useState(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportError, setExportError] = useState('')
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [clientCodeByName, setClientCodeByName] = useState(new Map())

  useEffect(() => {
    supabase
      .from('clients')
      .select('name, client_code')
      .then(({ data }) => {
        setClientCodeByName(new Map((data ?? []).map((c) => [c.name, c.client_code])))
      })
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('invoices')
        .select('*')
        .order('entry_date', { ascending: false })
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
      .channel('invoices-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, (payload) => {
        setEntries((current) => applyRealtimeChange(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const banks = useMemo(
    () => [...new Set(entries.map((e) => e.cheque_bank).filter(Boolean))],
    [entries]
  )

  const paymentTypes = useMemo(
    () => [...new Set([...PAYMENT_TYPES, ...entries.map((e) => e.payment_type).filter(Boolean)])],
    [entries]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (paymentFilter && e.payment_status !== paymentFilter) return false
      if (startDate && e.entry_date < startDate) return false
      if (endDate && e.entry_date > endDate) return false
      if (!q) return true
      return [e.invoice_number, e.client_name, e.truck_plate].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, paymentFilter, startDate, endDate])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, e) => ({
        count: acc.count + 1,
        amount: acc.amount + Number(e.amount || 0),
        discount: acc.discount + Number(e.discount_amount || 0),
        total: acc.total + Number(e.total || 0),
        settlement: acc.settlement + Number(e.settlement || 0),
        balance: acc.balance + Number(e.balance || 0),
        totalTva: acc.totalTva + Number(e.total_tva || 0),
        totalTtc: acc.totalTtc + Number(e.total_ttc || 0),
        stampDuty: acc.stampDuty + Number(e.stamp_duty || 0),
        totalNet: acc.totalNet + Number(e.total_net || 0),
      }),
      { count: 0, amount: 0, discount: 0, total: 0, settlement: 0, balance: 0, totalTva: 0, totalTtc: 0, stampDuty: 0, totalNet: 0 }
    )
  }, [filtered])

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
    const isCheque = editDraft.payment_status === 'Chèque'
    const isOther = editDraft.designation === 'Autre'
    const payload = {
      invoice_number: editDraft.invoice_number.trim(),
      entry_date: editDraft.entry_date,
      client_name: editDraft.client_name.trim().toUpperCase(),
      designation: editDraft.designation,
      designation_other: isOther ? (editDraft.designation_other || '').trim() : null,
      bl_number: editDraft.bl_number?.trim() || null,
      qty_b8: Number(editDraft.qty_b8) || 0,
      qty_b12: Number(editDraft.qty_b12) || 0,
      qty_h: Number(editDraft.qty_h) || 0,
      price_b8: Number(editDraft.price_b8) || 0,
      price_b12: Number(editDraft.price_b12) || 0,
      price_h: Number(editDraft.price_h) || 0,
      discount_amount: Number(editDraft.discount_amount) || 0,
      settlement: Number(editDraft.settlement) || 0,
      disbursement: Number(editDraft.disbursement) || 0,
      stamp_duty: Number(editDraft.stamp_duty) || 0,
      amount_override: editDraft.amount_override === '' || editDraft.amount_override == null ? null : Number(editDraft.amount_override),
      driver_name: editDraft.driver_name?.trim() || null,
      truck_plate: editDraft.truck_plate?.trim() || null,
      payment_type: (editDraft.payment_type || '').trim() || 'A TERME',
      payment_status: editDraft.payment_status,
      cheque_number: isCheque ? (editDraft.cheque_number || '').trim() : null,
      cheque_bank: isCheque ? (editDraft.cheque_bank || '').trim() || null : null,
      ref_commande: editDraft.ref_commande?.trim() || null,
      ref_livraison: editDraft.ref_livraison?.trim() || null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_invoice', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_invoice_number: payload.invoice_number,
          p_entry_date: payload.entry_date,
          p_client_name: payload.client_name,
          p_designation: payload.designation,
          p_designation_other: payload.designation_other,
          p_bl_number: payload.bl_number,
          p_qty_b8: payload.qty_b8,
          p_qty_b12: payload.qty_b12,
          p_qty_h: payload.qty_h,
          p_price_b8: payload.price_b8,
          p_price_b12: payload.price_b12,
          p_price_h: payload.price_h,
          p_amount_override: payload.amount_override,
          p_discount_amount: payload.discount_amount,
          p_settlement: payload.settlement,
          p_disbursement: payload.disbursement,
          p_stamp_duty: payload.stamp_duty,
          p_driver_name: payload.driver_name,
          p_truck_plate: payload.truck_plate,
          p_payment_type: payload.payment_type,
          p_payment_status: payload.payment_status,
          p_cheque_number: payload.cheque_number,
          p_cheque_bank: payload.cheque_bank,
          p_ref_commande: payload.ref_commande,
          p_ref_livraison: payload.ref_livraison,
          p_observations: payload.observations,
        })
      : await supabase.from('invoices').update(payload).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_invoice', {
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

  async function handleExport(filters) {
    const toExport = applyExportFilters(entries, { ...filters, categoricalField: 'payment_status' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress(true)
    try {
      await downloadInvoicesExcel(toExport, {
        filename: buildExportFilename('Registre_Factures', filters.startDate, filters.endDate),
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
    const ok = window.confirm(`Supprimer la facture n° ${entry.invoice_number} (${entry.client_name}) ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('invoices').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setEntries((current) => current.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : n° facture, client, matricule…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Statut paiement : tous</option>
            {PAYMENT_STATUSES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
            aria-label="Du"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
            aria-label="Au"
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => window.print()}
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
              {exportProgress != null ? 'Génération en cours…' : 'Exporter Excel'}
            </button>
          )}
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
          <PrintHeader title="Registre factures" />

          <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Factures</p>
              <p className="font-display text-xl text-ocre">{totals.count}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Montant</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.amount)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Remise</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.discount)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Total</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.total)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Règlement</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.settlement)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Solde</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.balance)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">TVA</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.totalTva)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">TTC</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.totalTtc)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Timbre</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.stampDuty)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Total Net</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.totalNet)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[2400px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>N° Facture</Th>
                  <Th>Date</Th>
                  <Th>Client</Th>
                  <Th>Code</Th>
                  <Th>Désignation</Th>
                  <Th>N° BL</Th>
                  <Th>B8 (T)</Th>
                  <Th>B12 (T)</Th>
                  <Th>Autre (H)</Th>
                  <Th>Prix B8</Th>
                  <Th>Prix B12</Th>
                  <Th>Prix H</Th>
                  <Th>Montant</Th>
                  <Th>Remise</Th>
                  <Th>Total</Th>
                  <Th>Règlement</Th>
                  <Th>Décaissement</Th>
                  <Th>Chauffeur</Th>
                  <Th>Immat</Th>
                  <Th>Type (N/B)</Th>
                  <Th>Solde</Th>
                  <Th>TVA</Th>
                  <Th>TTC</Th>
                  <Th>Timbre</Th>
                  <Th>Total Net</Th>
                  <Th>Paiement</Th>
                  <Th>Observations</Th>
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
                      paymentTypeSuggestions={paymentTypes}
                      clientCode={clientCodeByName.get(entry.client_name)}
                    />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td sticky>{entry.invoice_number}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{entry.client_name}</Td>
                      <Td>{clientCodeByName.get(entry.client_name) ?? '—'}</Td>
                      <Td>{designationLabel(entry)}</Td>
                      <Td>{entry.bl_number ?? '—'}</Td>
                      <Td>{entry.qty_b8}</Td>
                      <Td>{entry.qty_b12}</Td>
                      <Td>{entry.qty_h}</Td>
                      <Td>{entry.qty_b8 > 0 ? entry.price_b8 : '—'}</Td>
                      <Td>{entry.qty_b12 > 0 ? entry.price_b12 : '—'}</Td>
                      <Td>{entry.qty_h > 0 ? entry.price_h : '—'}</Td>
                      <Td>{formatDA(entry.amount)}</Td>
                      <Td>{formatDA(entry.discount_amount)}</Td>
                      <Td>{formatDA(entry.total)}</Td>
                      <Td>{formatDA(entry.settlement)}</Td>
                      <Td>{formatDA(entry.disbursement)}</Td>
                      <Td>{entry.driver_name ?? '—'}</Td>
                      <Td>{entry.truck_plate ?? '—'}</Td>
                      <Td>{entry.payment_type}</Td>
                      <Td>
                        <span className={Number(entry.balance) > 0 ? 'text-terracotta' : 'text-green-500'}>
                          {formatDA(entry.balance)}
                        </span>
                      </Td>
                      <Td>{formatDA(entry.total_tva)}</Td>
                      <Td>{formatDA(entry.total_ttc)}</Td>
                      <Td>{formatDA(entry.stamp_duty)}</Td>
                      <Td>{formatDA(entry.total_net)}</Td>
                      <Td>
                        <PaidBadge status={entry.payment_status} />
                      </Td>
                      <Td className="max-w-[220px] truncate" title={entry.observations ?? ''}>
                        {entry.observations ?? '—'}
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

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'payment_status', label: 'Statut paiement', options: PAYMENT_STATUSES }}
        textFilters={[{ field: 'client_name', label: 'Client', suggestions: exportSuggestions('client_name') }]}
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
    </div>
  )
}

function PaidBadge({ status }) {
  const paid = isInvoicePaid(status)
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
        paid ? 'border-green-500/50 bg-green-500/10 text-green-500' : 'border-terracotta/50 bg-terracotta/10 text-terracotta'
      }`}
    >
      {status ?? 'Non payé'}
    </span>
  )
}

function EditRow({ draft, onChange, onSave, onCancel, bankSuggestions, paymentTypeSuggestions, clientCode }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  const qtyB8 = Number(draft.qty_b8) || 0
  const qtyB12 = Number(draft.qty_b12) || 0
  const qtyH = Number(draft.qty_h) || 0
  const priceB8 = Number(draft.price_b8) || 0
  const priceB12 = Number(draft.price_b12) || 0
  const priceH = Number(draft.price_h) || 0
  const discountAmount = Number(draft.discount_amount) || 0
  const settlement = Number(draft.settlement) || 0
  const amountOverride = draft.amount_override === '' || draft.amount_override == null ? null : Number(draft.amount_override)
  const amount = amountOverride ?? (qtyB8 * priceB8 + qtyB12 * priceB12 + qtyH * priceH)
  const total = amount - discountAmount
  const balance = total - settlement
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalTva = total * 0.19
  const totalTtc = total * 1.19
  const totalNet = totalTtc + stampDuty

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td sticky="bg-bg-soft">
        <input type="text" value={draft.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.client_name} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{clientCode ?? '—'}</Td>
      <Td>
        <div className="flex min-w-32 flex-col gap-1">
          <select value={draft.designation} onChange={(e) => set('designation', e.target.value)} className={editInputClass}>
            {DESIGNATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {draft.designation === 'Autre' && (
            <input
              type="text"
              placeholder="Désignation libre"
              value={draft.designation_other ?? ''}
              onChange={(e) => set('designation_other', e.target.value)}
              className={editInputClass}
            />
          )}
        </div>
      </Td>
      <Td>
        <input type="text" value={draft.bl_number ?? ''} onChange={(e) => set('bl_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.qty_b8} onChange={(e) => set('qty_b8', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.qty_b12} onChange={(e) => set('qty_b12', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.qty_h} onChange={(e) => set('qty_h', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.price_b8} onChange={(e) => set('price_b8', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.price_b12} onChange={(e) => set('price_b12', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.price_h} onChange={(e) => set('price_h', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDA(amount)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.discount_amount} onChange={(e) => set('discount_amount', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDA(total)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.settlement} onChange={(e) => set('settlement', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.disbursement} onChange={(e) => set('disbursement', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.driver_name ?? ''} onChange={(e) => set('driver_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.truck_plate ?? ''} onChange={(e) => set('truck_plate', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input
          type="text"
          list="invoice-edit-payment-types-list"
          value={draft.payment_type ?? ''}
          onChange={(e) => set('payment_type', e.target.value)}
          className={editInputClass}
        />
        <datalist id="invoice-edit-payment-types-list">
          {paymentTypeSuggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Td>
      <Td>
        <span className={balance > 0 ? 'text-terracotta' : 'text-green-500'}>{formatDA(balance)}</span>
      </Td>
      <Td>{formatDA(totalTva)}</Td>
      <Td>{formatDA(totalTtc)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.stamp_duty} onChange={(e) => set('stamp_duty', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <span className="font-display text-ocre">{formatDA(totalNet)}</span>
      </Td>
      <Td>
        <div className="flex min-w-36 flex-col gap-1">
          <select value={draft.payment_status ?? 'Non payé'} onChange={(e) => set('payment_status', e.target.value)} className={editInputClass}>
            {PAYMENT_STATUSES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {draft.payment_status === 'Chèque' && (
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
                list="invoice-edit-banks-list"
                placeholder="Banque"
                value={draft.cheque_bank ?? ''}
                onChange={(e) => set('cheque_bank', e.target.value)}
                className={editInputClass}
              />
              <datalist id="invoice-edit-banks-list">
                {bankSuggestions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </>
          )}
        </div>
      </Td>
      <Td>
        <input
          type="text"
          value={draft.observations ?? ''}
          onChange={(e) => set('observations', e.target.value)}
          className={`${editInputClass} min-w-40`}
        />
      </Td>
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
