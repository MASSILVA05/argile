import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { buildExportFilename } from '../lib/exportFilters'
import { PAYMENT_MODES, formatDA, itemsSummary, itemsText, computeVenteTotals, buildMagasinClientSheet } from '../lib/magasin'
import { downloadMagasinVentesExcel } from '../lib/magasinVentesExcel'
import { printRegistry } from '../lib/printRegistry'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import EntitySheetModal from './EntitySheetModal'
import ExportFilterModal from './ExportFilterModal'

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

function paymentLabel(v) {
  if (v.payment_mode === 'Chèque' && v.cheque_number) {
    return `Chèque n° ${v.cheque_number}${v.cheque_bank ? ` (${v.cheque_bank})` : ''}`
  }
  return v.payment_mode ?? '—'
}

export default function MagasinVentesRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('magasin_ventes')
        .select('*')
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
      .channel('magasin-ventes-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_ventes' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const ventes = useMemo(() => all.filter((v) => !v.is_payment), [all])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ventes.filter((v) => {
      if (dateFilter && v.entry_date !== dateFilter) return false
      if (paymentFilter && v.payment_mode !== paymentFilter) return false
      if (!q) return true
      return [v.bon_number, v.client_name, itemsText(v.items)].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [ventes, query, dateFilter, paymentFilter])

  const totals = useMemo(() => {
    const totalHt = filtered.reduce((s, v) => s + (Number(v.total_ht) || 0), 0)
    const remise = filtered.reduce((s, v) => s + (Number(v.remise) || 0), 0)
    const total = filtered.reduce((s, v) => s + (Number(v.total) || 0), 0)
    return { totalHt, remise, total }
  }, [filtered])

  function handlePrint() {
    const filterParts = []
    if (query.trim()) filterParts.push(`Recherche : "${query.trim()}"`)
    if (dateFilter) filterParts.push(`Date : ${dateFilter}`)
    if (paymentFilter) filterParts.push(`Paiement : ${paymentFilter}`)

    printRegistry({
      subtitle: 'Registre des ventes — Magasin Bejaia',
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns: [
        { key: 'bon_number', label: 'Bon' },
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: (v) => formatTime(v) },
        { key: 'client_name', label: 'Client' },
        { key: 'articles', label: 'Articles' },
        { key: 'total_ht', label: 'Total HT (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'remise', label: 'Remise (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'total', label: 'Total (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'payment', label: 'Paiement' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((v) => ({ ...v, articles: itemsText(v.items), payment: paymentLabel(v) })),
      totals: [
        { bon_number: 'TOTAUX', total_ht: totals.totalHt, remise: totals.remise, total: totals.total },
      ],
    })
  }

  function sheetNameOptions() {
    return [...new Set(all.map((v) => v.client_name).filter(Boolean))].sort()
  }

  function startEdit(v) {
    setEditingId(v.id)
    setEditDraft({ ...v })
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
    const totalHt = Number(editDraft.total_ht) || computeVenteTotals(editDraft.items, 0).totalHt
    const remise = Number(editDraft.remise) || 0
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      client_name: editDraft.client_name?.trim() || null,
      items: editDraft.items ?? [],
      total_ht: totalHt,
      remise,
      total: totalHt - remise,
      payment_mode: editDraft.payment_mode,
      cheque_number: isCheque ? editDraft.cheque_number?.trim() || null : null,
      cheque_bank: isCheque ? editDraft.cheque_bank?.trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_magasin_vente', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_bon_number: payload.bon_number,
          p_entry_date: payload.entry_date,
          p_client_name: payload.client_name,
          p_items: payload.items,
          p_total_ht: payload.total_ht,
          p_remise: payload.remise,
          p_total: payload.total,
          p_payment_mode: payload.payment_mode,
          p_cheque_number: payload.cheque_number,
          p_cheque_bank: payload.cheque_bank,
          p_observations: payload.observations,
        })
      : await supabase.from('magasin_ventes').update(payload).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setAll((current) => current.map((v) => (v.id === data.id ? data : v)))
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
    const { error: rpcError } = await supabase.rpc('admin_delete_magasin_vente', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((v) => v.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(v) {
    if (isLocked(v)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer le bon de vente n° ${v.bon_number} ?`)) return
    const { error: deleteError } = await supabase.from('magasin_ventes').delete().eq('id', v.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((x) => x.id !== v.id))
  }

  async function handleExport(filters) {
    const { startDate, endDate } = filters
    const toExport = ventes.filter((v) => {
      if (startDate && v.entry_date < startDate) return false
      if (endDate && v.entry_date > endDate) return false
      if (filters.categoricalValues && !filters.categoricalValues.includes(v.payment_mode)) return false
      const clientQ = filters.textValues?.client_name
      if (clientQ && !String(v.client_name ?? '').toLowerCase().includes(clientQ.trim().toLowerCase())) return false
      return true
    })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportOpen(false)
    setExporting(true)
    try {
      await downloadMagasinVentesExcel(toExport, {
        filename: buildExportFilename('Ventes_Magasin', startDate, endDate),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : client, article, n° bon…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
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
            onClick={handlePrint}
            className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
          >
            Imprimer
          </button>
          <button
            type="button"
            onClick={() => {
              setExportError('')
              setExportOpen(true)
            }}
            disabled={exporting}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:opacity-50"
          >
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
          >
            Fiche client
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
        <p className="text-ink-muted">Aucune vente.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Total HT" value={totals.totalHt} />
            <Total label="Remise" value={totals.remise} />
            <Total label="Total" value={totals.total} className="text-ocre" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1200px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Bon</Th>
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Client</Th>
                  <Th>Articles</Th>
                  <Th>Total HT</Th>
                  <Th>Remise</Th>
                  <Th>Total</Th>
                  <Th>Paiement</Th>
                  <Th className="no-print">Photo</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) =>
                  editingId === v.id ? (
                    <EditRow key={v.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={v.id} className="border-b border-border last:border-0">
                      <Td>{v.bon_number}</Td>
                      <Td>{v.entry_date}</Td>
                      <Td>{formatTime(v.entry_time)}</Td>
                      <Td>{formatDateTime(v.created_at)}</Td>
                      <Td>{v.client_name ?? '—'}</Td>
                      <Td className="max-w-[280px] truncate" title={itemsText(v.items)}>
                        {itemsSummary(v.items)}
                      </Td>
                      <Td className="text-right">{formatDA(v.total_ht)}</Td>
                      <Td className="text-right">{formatDA(v.remise)}</Td>
                      <Td className="text-right font-medium text-ocre">{formatDA(v.total)}</Td>
                      <Td>{paymentLabel(v)}</Td>
                      <Td className="no-print">
                        {v.photo_url ? (
                          <button type="button" onClick={() => setLightboxUrl(v.photo_url)} className="block">
                            <img src={v.photo_url} alt="" className="h-10 w-10 rounded object-cover" />
                          </button>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{v.entered_by_user ?? '—'}</Td>
                      <Td className="no-print">
                        <RowActions
                          entry={v}
                          onEdit={() => startEdit(v)}
                          onDelete={() => handleDelete(v)}
                          onLockedAttempt={(action) => openAdminPrompt(action, v)}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Bon de vente" className="max-h-full max-w-full rounded-lg" />
        </div>
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

      <ExportFilterModal
        open={exportOpen}
        categorical={{ field: 'payment_mode', label: 'Mode de paiement', options: PAYMENT_MODES }}
        textFilters={[
          { field: 'client_name', label: 'Client', suggestions: [...new Set(ventes.map((v) => v.client_name).filter(Boolean))] },
        ]}
        hasPhotos={false}
        error={exportError}
        onExport={handleExport}
        onCancel={() => setExportOpen(false)}
      />

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche client — Magasin"
        nameLabel="Client"
        nameOptions={sheetNameOptions}
        onGenerate={(_typeId, name, startDate, endDate) => buildMagasinClientSheet(all, name, startDate, endDate)}
        excelSheetName="Fiche client magasin"
      />
    </div>
  )
}

function Total({ label, value, className = 'text-ink' }) {
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
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <input type="text" value={draft.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td className="max-w-[240px] truncate" title={itemsText(draft.items)}>
        {itemsSummary(draft.items)}
        <span className="block text-xs text-ink-muted">(articles non modifiables ici)</span>
      </Td>
      <Td className="text-right">{formatDA(draft.total_ht)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.remise ?? 0} onChange={(e) => set('remise', e.target.value)} className={editInputClass} />
      </Td>
      <Td className="text-right text-ocre">
        {formatDA((Number(draft.total_ht) || 0) - (Number(draft.remise) || 0))}
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
              <input type="text" placeholder="N° chèque" value={draft.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} className={editInputClass} />
              <input type="text" placeholder="Banque" value={draft.cheque_bank ?? ''} onChange={(e) => set('cheque_bank', e.target.value)} className={editInputClass} />
            </>
          )}
        </div>
      </Td>
      <Td className="no-print">
        {draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}
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
    if (current.some((v) => v.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((v) => (v.id === payload.new.id ? payload.new : v))
  if (payload.eventType === 'DELETE') return current.filter((v) => v.id !== payload.old.id)
  return current
}

const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
