import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadInvoicesExcel } from '../lib/invoicesExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { PAYMENT_STATUSES, isInvoicePaid } from '../lib/invoicePayment'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (paymentFilter && e.payment_status !== paymentFilter) return false
      if (startDate && e.entry_date < startDate) return false
      if (endDate && e.entry_date > endDate) return false
      if (!q) return true
      return [e.invoice_number, e.client_name].some((field) => String(field ?? '').toLowerCase().includes(q))
    })
  }, [entries, query, paymentFilter, startDate, endDate])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, e) => ({
        count: acc.count + 1,
        totalHt: acc.totalHt + Number(e.total_ht || 0),
        totalTva: acc.totalTva + Number(e.total_tva || 0),
        totalTtc: acc.totalTtc + Number(e.total_ttc || 0),
        stampDuty: acc.stampDuty + Number(e.stamp_duty || 0),
        totalNet: acc.totalNet + Number(e.total_net || 0),
      }),
      { count: 0, totalHt: 0, totalTva: 0, totalTtc: 0, stampDuty: 0, totalNet: 0 }
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
    const payload = {
      invoice_number: editDraft.invoice_number.trim(),
      entry_date: editDraft.entry_date,
      client_name: editDraft.client_name.trim(),
      total_ht: Number(editDraft.total_ht),
      discount_percent: Number(editDraft.discount_percent) || 0,
      stamp_duty: Number(editDraft.stamp_duty) || 0,
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
          p_total_ht: payload.total_ht,
          p_discount_percent: payload.discount_percent,
          p_stamp_duty: payload.stamp_duty,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : n° facture, client…"
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
        {!isViewer && (
          <button
            type="button"
            onClick={() => { setExportError(''); setExportModalOpen(true) }}
            disabled={exportProgress != null}
            className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportProgress != null ? 'Génération en cours…' : 'Exporter Excel'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
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

      {error && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune facture.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>N° Facture</Th>
                <Th>Date</Th>
                <Th>Heure</Th>
                <Th>Client</Th>
                <Th>Total HT</Th>
                <Th>Remise (%)</Th>
                <Th>TVA</Th>
                <Th>TTC</Th>
                <Th>Timbre</Th>
                <Th>Total Net</Th>
                <Th>Paiement</Th>
                <Th>Réf. Commande</Th>
                <Th>Réf. Livraison</Th>
                <Th>Saisi par</Th>
                <Th>Observations</Th>
                <Th>Actions</Th>
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
                    <Td>{entry.invoice_number}</Td>
                    <Td>{entry.entry_date}</Td>
                    <Td>{formatTime(entry.entry_time)}</Td>
                    <Td>{entry.client_name}</Td>
                    <Td>{formatDA(entry.total_ht)}</Td>
                    <Td>{entry.discount_percent ?? 0}</Td>
                    <Td>{formatDA(entry.total_tva)}</Td>
                    <Td>{formatDA(entry.total_ttc)}</Td>
                    <Td>{formatDA(entry.stamp_duty)}</Td>
                    <Td>{formatDA(entry.total_net)}</Td>
                    <Td>
                      <PaidBadge status={entry.payment_status} />
                    </Td>
                    <Td>{entry.ref_commande ?? '—'}</Td>
                    <Td>{entry.ref_livraison ?? '—'}</Td>
                    <Td>{entry.entered_by_user ?? '—'}</Td>
                    <Td className="max-w-[200px] truncate" title={entry.observations ?? ''}>
                      {entry.observations ?? '—'}
                    </Td>
                    <Td>
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

function EditRow({ draft, onChange, onSave, onCancel, bankSuggestions }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  const totalHt = Number(draft.total_ht) || 0
  const discount = Number(draft.discount_percent) || 0
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalTva = totalHt * 0.19 * (1 - discount / 100)
  const totalTtc = totalHt * (1 - discount / 100) + totalTva
  const totalNet = totalTtc + stampDuty

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="text" value={draft.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>
        <input type="text" value={draft.client_name} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.total_ht} onChange={(e) => set('total_ht', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.discount_percent ?? 0} onChange={(e) => set('discount_percent', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDA(totalTva)}</Td>
      <Td>{formatDA(totalTtc)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.stamp_duty ?? 0} onChange={(e) => set('stamp_duty', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDA(totalNet)}</Td>
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
        <input type="text" value={draft.ref_commande ?? ''} onChange={(e) => set('ref_commande', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.ref_livraison ?? ''} onChange={(e) => set('ref_livraison', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
      <Td>
        <input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={editInputClass} />
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

function Th({ children }) {
  return <th className="px-3 py-2 font-display font-medium whitespace-nowrap">{children}</th>
}

function Td({ children, className = '', title }) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`} title={title}>
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
