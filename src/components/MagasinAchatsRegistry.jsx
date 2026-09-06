import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { buildExportFilename } from '../lib/exportFilters'
import {
  ACHAT_PAYMENT_MODES,
  ACHAT_DESTINATIONS,
  formatDA,
  itemsSummary,
  achatItemsText,
  buildMagasinFournisseurSheet,
} from '../lib/magasin'
import { downloadMagasinAchatsExcel } from '../lib/magasinAchatsExcel'
import PrintSelectionModal from './PrintSelectionModal'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import EntitySheetModal from './EntitySheetModal'

const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

function paymentLabel(a) {
  if (a.payment_mode === 'Chèque' && a.cheque_number) {
    return `Chèque n° ${a.cheque_number}${a.cheque_bank ? ` (${a.cheque_bank})` : ''}`
  }
  return a.payment_mode ?? '—'
}

export default function MagasinAchatsRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [destFilter, setDestFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('magasin_achats')
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
      .channel('magasin-achats-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_achats' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((a) => {
      if (dateFilter && a.entry_date !== dateFilter) return false
      if (destFilter && a.destination !== destFilter) return false
      if (paymentFilter && a.payment_mode !== paymentFilter) return false
      if (!q) return true
      return [a.bon_number, a.fournisseur, a.client_revente, achatItemsText(a.items)].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [all, query, dateFilter, destFilter, paymentFilter])

  const totals = useMemo(() => {
    const total = filtered.reduce((s, a) => s + (Number(a.total) || 0), 0)
    const marge = filtered.reduce((s, a) => s + (Number(a.marge) || 0), 0)
    return { total, marge }
  }, [filtered])

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (dateFilter) parts.push(`Date : ${dateFilter}`)
    if (destFilter) parts.push(`Destination : ${destFilter}`)
    if (paymentFilter) parts.push(`Paiement : ${paymentFilter}`)
    return {
      subtitle: 'Registre des achats fournisseurs — Magasin Bejaia',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'bon_number', label: 'Bon' },
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: fmtTime },
        { key: 'fournisseur', label: 'Fournisseur' },
        { key: 'articles', label: 'Articles' },
        { key: 'total', label: 'Total (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'destination', label: 'Destination' },
        { key: 'client_revente', label: 'Client revente' },
        { key: 'prix_revente', label: 'Prix revente', align: 'right', format: (v) => (v == null ? '' : formatDA(v)) },
        { key: 'marge', label: 'Marge', align: 'right', format: (v) => (v == null ? '' : formatDA(v)) },
        { key: 'payment', label: 'Paiement' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((a) => ({ ...a, articles: achatItemsText(a.items), payment: paymentLabel(a) })),
      totals: [{ bon_number: 'TOTAUX', total: totals.total, marge: totals.marge }],
    }
  }

  function startEdit(a) {
    setEditingId(a.id)
    setEditDraft({ ...a })
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
    const isRevente = editDraft.destination === 'Revente directe'
    const prixRevente = isRevente && editDraft.prix_revente !== '' && editDraft.prix_revente != null ? Number(editDraft.prix_revente) : null
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      fournisseur: editDraft.fournisseur?.trim() || null,
      total: Number(editDraft.total) || 0,
      payment_mode: editDraft.payment_mode,
      cheque_number: isCheque ? editDraft.cheque_number?.trim() || null : null,
      cheque_bank: isCheque ? editDraft.cheque_bank?.trim() || null : null,
      destination: editDraft.destination,
      client_revente: isRevente ? editDraft.client_revente?.trim() || null : null,
      prix_revente: prixRevente,
      marge: prixRevente == null ? null : prixRevente - (Number(editDraft.total) || 0),
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_magasin_achat', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p: payload,
        })
      : await supabase.from('magasin_achats').update(payload).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setAll((current) => current.map((a) => (a.id === row.id ? row : a)))
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
    const { error: rpcError } = await supabase.rpc('admin_delete_magasin_achat', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((a) => a.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(a) {
    if (isLocked(a)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer le bon d'achat n° ${a.bon_number} ?`)) return
    const { error: deleteError } = await supabase.from('magasin_achats').delete().eq('id', a.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((x) => x.id !== a.id))
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadMagasinAchatsExcel(filtered, {
        filename: buildExportFilename('Achats_Magasin', dateFilter || '', dateFilter || ''),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  function sheetNameOptions() {
    return [...new Set(all.map((a) => a.fournisseur).filter(Boolean))].sort()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : fournisseur, article, n° bon…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={destFilter} onChange={(e) => setDestFilter(e.target.value)} className={filterClass}>
            <option value="">Toutes destinations</option>
            {ACHAT_DESTINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className={filterClass}>
            <option value="">Tous paiements</option>
            {ACHAT_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted">
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
          <button type="button" onClick={() => setSheetOpen(true)} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
            Fiche fournisseur
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun achat.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Total achats" value={totals.total} />
            <Total label="Marge (revente directe)" value={totals.marge} className={totals.marge < 0 ? 'text-terracotta' : 'text-ocre'} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1300px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Bon</Th>
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Fournisseur</Th>
                  <Th>Articles</Th>
                  <Th>Total</Th>
                  <Th>Destination</Th>
                  <Th>Client revente</Th>
                  <Th>Prix revente</Th>
                  <Th>Marge</Th>
                  <Th>Paiement</Th>
                  <Th className="no-print">Photo</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) =>
                  editingId === a.id ? (
                    <EditRow key={a.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <Td>{a.bon_number}</Td>
                      <Td>{a.entry_date}</Td>
                      <Td>{fmtTime(a.entry_time)}</Td>
                      <Td>{formatDateTime(a.created_at)}</Td>
                      <Td>{a.fournisseur ?? '—'}</Td>
                      <Td className="max-w-[280px] truncate" title={achatItemsText(a.items)}>{itemsSummary(a.items)}</Td>
                      <Td className="text-right font-medium text-ocre">{formatDA(a.total)}</Td>
                      <Td>{a.destination ?? '—'}</Td>
                      <Td>{a.client_revente ?? '—'}</Td>
                      <Td className="text-right">{a.prix_revente == null ? '—' : formatDA(a.prix_revente)}</Td>
                      <Td className={`text-right ${Number(a.marge) < 0 ? 'text-terracotta' : ''}`}>{a.marge == null ? '—' : formatDA(a.marge)}</Td>
                      <Td>{paymentLabel(a)}</Td>
                      <Td className="no-print">
                        {a.photo_url ? (
                          <button type="button" onClick={() => setLightboxUrl(a.photo_url)} className="block">
                            <img src={a.photo_url} alt="" className="h-10 w-10 rounded object-cover" />
                          </button>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{a.entered_by_user ?? '—'}</Td>
                      <Td className="no-print">
                        <RowActions
                          entry={a}
                          onEdit={() => startEdit(a)}
                          onDelete={() => handleDelete(a)}
                          onLockedAttempt={(action) => openAdminPrompt(action, a)}
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
          <img src={lightboxUrl} alt="Bon d'achat" className="max-h-full max-w-full rounded-lg" />
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

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche fournisseur — Magasin"
        nameLabel="Fournisseur"
        nameOptions={sheetNameOptions}
        onGenerate={(_typeId, name, startDate, endDate) => buildMagasinFournisseurSheet(all, name, startDate, endDate)}
        excelSheetName="Fiche fournisseur magasin"
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
  const isRevente = draft.destination === 'Revente directe'
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td><input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} /></Td>
      <Td>{fmtTime(draft.entry_time)}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td><input type="text" value={draft.fournisseur ?? ''} onChange={(e) => set('fournisseur', e.target.value)} className={editInputClass} /></Td>
      <Td className="max-w-[240px] truncate" title={achatItemsText(draft.items)}>
        {itemsSummary(draft.items)}
        <span className="block text-xs text-ink-muted">(articles non modifiables ici)</span>
      </Td>
      <Td><input type="number" step="0.01" value={draft.total ?? 0} onChange={(e) => set('total', e.target.value)} className={editInputClass} /></Td>
      <Td>
        <select value={draft.destination} onChange={(e) => set('destination', e.target.value)} className={editInputClass}>
          {ACHAT_DESTINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Td>
      <Td><input type="text" value={draft.client_revente ?? ''} onChange={(e) => set('client_revente', e.target.value)} className={editInputClass} disabled={!isRevente} /></Td>
      <Td><input type="number" step="0.01" value={draft.prix_revente ?? ''} onChange={(e) => set('prix_revente', e.target.value)} className={editInputClass} disabled={!isRevente} /></Td>
      <Td className="text-right">
        {isRevente && draft.prix_revente !== '' && draft.prix_revente != null
          ? formatDA(Number(draft.prix_revente) - (Number(draft.total) || 0))
          : '—'}
      </Td>
      <Td>
        <div className="flex min-w-40 flex-col gap-1">
          <select value={draft.payment_mode} onChange={(e) => set('payment_mode', e.target.value)} className={editInputClass}>
            {ACHAT_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
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
  return (
    <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`} title={title}>
      {children}
    </td>
  )
}

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((a) => a.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((a) => (a.id === payload.new.id ? payload.new : a))
  if (payload.eventType === 'DELETE') return current.filter((a) => a.id !== payload.old.id)
  return current
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
