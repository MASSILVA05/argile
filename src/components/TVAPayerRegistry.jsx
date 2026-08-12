import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadTvaPayerExcel } from '../lib/tvaPayerExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/dateFormat'
import { PAYMENT_MODES } from '../lib/tvaPayment'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import PrintHeader from './PrintHeader'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function isPaid(mode) {
  return mode && mode !== 'Non payé'
}

const STATUS_OPTIONS = ['Payé', 'Non payé']

export default function TVAPayerRegistry() {
  const { isAdmin, isViewer, isTvaOnly } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('tva_payer_entries')
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
      .channel('tva-payer-entries-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tva_payer_entries' }, (payload) => {
        setEntries((current) => applyRealtimeChange(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const banks = useMemo(() => [...new Set(entries.map((e) => e.cheque_bank).filter(Boolean))], [entries])
  const clientOptions = useMemo(() => [...new Set(entries.map((e) => e.client_name).filter(Boolean))].sort(), [entries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (clientFilter && e.client_name !== clientFilter) return false
      if (statusFilter === 'Payé' && !isPaid(e.payment_mode)) return false
      if (statusFilter === 'Non payé' && isPaid(e.payment_mode)) return false
      if (startDate && e.entry_date < startDate) return false
      if (endDate && e.entry_date > endDate) return false
      if (!q) return true
      return [e.invoice_number, e.client_name].some((field) => String(field ?? '').toLowerCase().includes(q))
    })
  }, [entries, query, clientFilter, statusFilter, startDate, endDate])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, e) => ({
        count: acc.count + 1,
        totalHt: acc.totalHt + Number(e.total_ht || 0),
        discount: acc.discount + Number(e.discount_amount || 0),
        totalTva: acc.totalTva + Number(e.total_tva || 0),
        totalTtc: acc.totalTtc + Number(e.total_ttc || 0),
        stampDuty: acc.stampDuty + Number(e.stamp_duty || 0),
        totalNet: acc.totalNet + Number(e.total_net || 0),
      }),
      { count: 0, totalHt: 0, discount: 0, totalTva: 0, totalTtc: 0, stampDuty: 0, totalNet: 0 }
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
    const isCheque = editDraft.payment_mode === 'Chèque'
    const payload = {
      invoice_number: editDraft.invoice_number.trim(),
      entry_date: editDraft.entry_date,
      client_name: editDraft.client_name.trim(),
      total_ht: Number(editDraft.total_ht) || 0,
      discount_amount: Number(editDraft.discount_amount) || 0,
      stamp_duty: Number(editDraft.stamp_duty) || 0,
      ref_commande: editDraft.ref_commande?.trim() || null,
      ref_livraison: editDraft.ref_livraison?.trim() || null,
      payment_mode: editDraft.payment_mode,
      cheque_number: isCheque ? (editDraft.cheque_number || '').trim() : null,
      cheque_bank: isCheque ? (editDraft.cheque_bank || '').trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_tva_payer', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_invoice_number: payload.invoice_number,
          p_entry_date: payload.entry_date,
          p_client_name: payload.client_name,
          p_total_ht: payload.total_ht,
          p_discount_amount: payload.discount_amount,
          p_stamp_duty: payload.stamp_duty,
          p_ref_commande: payload.ref_commande,
          p_ref_livraison: payload.ref_livraison,
          p_payment_mode: payload.payment_mode,
          p_cheque_number: payload.cheque_number,
          p_cheque_bank: payload.cheque_bank,
          p_observations: payload.observations,
        })
      : await supabase.from('tva_payer_entries').update(payload).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_tva_payer', {
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

  async function handleExport(filters) {
    const withStatus = entries.map((e) => ({ ...e, status_label: isPaid(e.payment_mode) ? 'Payé' : 'Non payé' }))
    const toExport = applyExportFilters(withStatus, { ...filters, categoricalField: 'status_label' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress(true)
    try {
      await downloadTvaPayerExcel(toExport, {
        startDate: filters.startDate || toExport[0].entry_date,
        endDate: filters.endDate || toExport[toExport.length - 1].entry_date,
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
    const { error: deleteError } = await supabase.from('tva_payer_entries').delete().eq('id', entry.id)
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
            placeholder="Rechercher : n° facture, client…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Client : tous</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Statut : tous</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
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
          {!isViewer && !isTvaOnly && (
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
          <PrintHeader title="Registre TVA à payer" />

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
              <p className="text-xs text-ink-muted">Remise</p>
              <p className="font-display text-xl text-ocre">{formatDA(totals.discount)}</p>
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
            <table className="w-full min-w-[2000px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>Numéro</Th>
                  <Th>Du</Th>
                  <Th>Saisie le</Th>
                  <Th>Client</Th>
                  <Th>Total HT</Th>
                  <Th>Remise</Th>
                  <Th>Total TVA</Th>
                  <Th>Total TTC</Th>
                  <Th>Timbre</Th>
                  <Th>Total net</Th>
                  <Th>Réf. Commande</Th>
                  <Th>Réf. Livraison</Th>
                  <Th>Paiement</Th>
                  <Th>Statut</Th>
                  <Th>Photo</Th>
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
                    />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td sticky>{entry.invoice_number}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
                      <Td>{entry.client_name}</Td>
                      <Td>{formatDA(entry.total_ht)}</Td>
                      <Td>{formatDA(entry.discount_amount)}</Td>
                      <Td>{formatDA(entry.total_tva)}</Td>
                      <Td>{formatDA(entry.total_ttc)}</Td>
                      <Td>{formatDA(entry.stamp_duty)}</Td>
                      <Td>
                        <span className="font-display text-ocre">{formatDA(entry.total_net)}</span>
                      </Td>
                      <Td>{entry.ref_commande ?? '—'}</Td>
                      <Td>{entry.ref_livraison ?? '—'}</Td>
                      <Td>{entry.payment_mode ?? 'Non payé'}</Td>
                      <Td>
                        <StatusBadge mode={entry.payment_mode} />
                      </Td>
                      <Td>
                        <PhotoThumb url={entry.photo_url} onClick={setLightboxUrl} label={`Facture n° ${entry.invoice_number}`} />
                      </Td>
                      <Td className="max-w-[200px] truncate" title={entry.observations ?? ''}>
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
        categorical={{ field: 'status_label', label: 'Statut', options: STATUS_OPTIONS }}
        textFilters={[{ field: 'client_name', label: 'Client', suggestions: clientOptions }]}
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

function StatusBadge({ mode }) {
  const paid = isPaid(mode)
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
        paid ? 'border-green-500/50 bg-green-500/10 text-green-500' : 'border-terracotta/50 bg-terracotta/10 text-terracotta'
      }`}
    >
      {paid ? 'Payé' : 'Non payé'}
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
  const totalTva = (totalHt - discountAmount) * 0.19
  const totalTtc = (totalHt - discountAmount) * 1.19
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalNet = totalTtc + stampDuty

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td sticky="bg-bg-soft">
        <input type="text" value={draft.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <input type="text" value={draft.client_name} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.total_ht} onChange={(e) => set('total_ht', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.discount_amount} onChange={(e) => set('discount_amount', e.target.value)} className={editInputClass} />
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
        <input type="text" value={draft.ref_commande ?? ''} onChange={(e) => set('ref_commande', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.ref_livraison ?? ''} onChange={(e) => set('ref_livraison', e.target.value)} className={editInputClass} />
      </Td>
      <Td colSpan={2}>
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
                list="tva-payer-edit-banks-list"
                placeholder="Banque"
                value={draft.cheque_bank ?? ''}
                onChange={(e) => set('cheque_bank', e.target.value)}
                className={editInputClass}
              />
              <datalist id="tva-payer-edit-banks-list">
                {bankSuggestions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </>
          )}
        </div>
      </Td>
      <Td>{draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
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

function Td({ children, className = '', title, sticky, colSpan }) {
  const stickyClass = sticky ? `sticky left-0 z-10 ${sticky === true ? 'bg-bg-card' : sticky}` : ''
  return (
    <td colSpan={colSpan} className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${stickyClass} ${className}`} title={title}>
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
