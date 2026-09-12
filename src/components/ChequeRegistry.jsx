import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadChequesExcel } from '../lib/chequesExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/dateFormat'
import {
  CHEQUE_TYPES,
  CHEQUE_STATUTS,
  CHEQUE_BANKS,
  CHEQUE_MOTIFS,
  formatDA,
  isEmis,
  buildChequeSheet,
} from '../lib/cheques'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'
import PrintSelectionModal from './PrintSelectionModal'

const SHEET_TYPES = [{ id: 'beneficiary', label: 'Bénéficiaire / Émetteur', nameLabel: 'Bénéficiaire / Émetteur' }]

const TYPE_BADGE = {
  Émis: 'border-blue-500/50 bg-blue-500/10 text-blue-500',
  Reçu: 'border-green-500/50 bg-green-500/10 text-green-500',
}

const STATUT_BADGE = {
  'En attente': 'border-ocre/60 bg-ocre/10 text-ocre',
  'Remis en banque': 'border-blue-500/50 bg-blue-500/10 text-blue-500',
  'Encaissé': 'border-green-500/50 bg-green-500/10 text-green-500',
  'Rejeté': 'border-terracotta/60 bg-terracotta/10 text-terracotta',
  'Annulé': 'border-border bg-bg-soft text-ink-muted line-through',
}

export default function ChequeRegistry() {
  const { isAdmin } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statutFilter, setStatutFilter] = useState('')
  const [bankFilter, setBankFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
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
        .from('cheques')
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
      .channel('cheques-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cheques' }, (payload) => {
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
      if (typeFilter && e.type !== typeFilter) return false
      if (statutFilter && e.statut !== statutFilter) return false
      if (bankFilter && e.bank !== bankFilter) return false
      if (dateFilter && e.cheque_date !== dateFilter) return false
      if (!q) return true
      return [e.cheque_number, e.beneficiary, e.motif, e.observations].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, typeFilter, statutFilter, bankFilter, dateFilter])

  const totals = useMemo(() => {
    const totalEmis = filtered.filter((e) => isEmis(e.type)).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const totalRecu = filtered.filter((e) => !isEmis(e.type)).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    return { totalEmis, totalRecu, solde: totalRecu - totalEmis }
  }, [filtered])

  const bankValues = useMemo(() => [...new Set(entries.map((e) => e.bank).filter(Boolean))].sort(), [entries])

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (typeFilter) parts.push(`Type : ${typeFilter}`)
    if (statutFilter) parts.push(`Statut : ${statutFilter}`)
    if (bankFilter) parts.push(`Banque : ${bankFilter}`)
    if (dateFilter) parts.push(`Date : ${dateFilter}`)

    return {
      subtitle: 'Registre des chèques',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'cheque_number', label: 'N° Chèque' },
        { key: 'cheque_date', label: 'Date chèque' },
        { key: 'type', label: 'Type' },
        { key: 'beneficiary', label: 'Bénéficiaire' },
        { key: 'amount', label: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'bank', label: 'Banque' },
        { key: 'motif', label: 'Motif' },
        { key: 'statut', label: 'Statut' },
        { key: 'date_remise', label: 'Date remise' },
        { key: 'date_encaissement', label: 'Date encaissement' },
        { key: 'entered_by_user', label: 'Saisi par' },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered,
      totals: [
        { cheque_number: 'TOTAL ÉMIS', amount: totals.totalEmis },
        { cheque_number: 'TOTAL REÇU', amount: totals.totalRecu },
        { cheque_number: 'SOLDE (Reçu - Émis)', amount: totals.solde },
      ],
    }
  }

  function sheetNameOptions() {
    return [...new Set(entries.map((e) => e.beneficiary).filter(Boolean))].sort()
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
    const isRemis = editDraft.statut === 'Remis en banque'
    const isEncaisse = editDraft.statut === 'Encaissé'
    const isRejete = editDraft.statut === 'Rejeté'
    const payload = {
      type: editDraft.type,
      cheque_number: editDraft.cheque_number?.trim() || '',
      cheque_date: editDraft.cheque_date,
      beneficiary: editDraft.beneficiary?.trim() || '',
      amount: Number(editDraft.amount) || 0,
      bank: editDraft.bank?.trim() || '',
      bank_account: editDraft.bank_account?.trim() || null,
      motif: editDraft.motif?.trim() || null,
      statut: editDraft.statut,
      date_remise: isRemis || isEncaisse ? editDraft.date_remise || null : null,
      date_encaissement: isEncaisse ? editDraft.date_encaissement || null : null,
      motif_rejet: isRejete ? editDraft.motif_rejet?.trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_cheque', { p_id: editingId, p_admin_code: editAdminCode, p: payload })
      : await supabase.from('cheques').update(payload).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_cheque', {
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
    const toExport = applyExportFilters(entries, { ...filters, categoricalField: 'type', dateField: 'cheque_date' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadChequesExcel(toExport, {
        includePhotos,
        filename: buildExportFilename('Cheques', filters.startDate, filters.endDate),
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
    if (!window.confirm(`Supprimer le chèque n° ${entry.cheque_number} (${entry.beneficiary}) ?`)) return
    const { error: deleteError } = await supabase.from('cheques').delete().eq('id', entry.id)
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
            placeholder="Rechercher : n° chèque, bénéficiaire, motif…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterClass}>
            <option value="">Tous types</option>
            {CHEQUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} className={filterClass}>
            <option value="">Tous statuts</option>
            {CHEQUE_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className={filterClass}>
            <option value="">Toutes banques</option>
            {bankValues.map((b) => <option key={b} value={b}>{b}</option>)}
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
            Fiche bénéficiaire
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun chèque.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Total émis" value={totals.totalEmis} className="text-terracotta" />
            <Total label="Total reçu" value={totals.totalRecu} className="text-green-500" />
            <Total label="Solde (Reçu - Émis)" value={totals.solde} className={totals.solde >= 0 ? 'text-green-500' : 'text-terracotta'} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1400px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>N° Chèque</Th>
                  <Th>Date chèque</Th>
                  <Th>Type</Th>
                  <Th>Bénéficiaire</Th>
                  <Th>Montant (DA)</Th>
                  <Th>Banque</Th>
                  <Th>Motif</Th>
                  <Th>Statut</Th>
                  <Th>Date remise</Th>
                  <Th>Date encaissement</Th>
                  <Th className="no-print">Photo</Th>
                  <Th>Saisi par</Th>
                  <Th>Saisie le</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) =>
                  editingId === entry.id ? (
                    <EditRow key={entry.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td className="font-medium text-ink">{entry.cheque_number}</Td>
                      <Td>{entry.cheque_date}</Td>
                      <Td>
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TYPE_BADGE[entry.type] ?? ''}`}>
                          {entry.type}
                        </span>
                      </Td>
                      <Td>{entry.beneficiary}</Td>
                      <Td className="text-right font-medium text-ocre">{formatDA(entry.amount)}</Td>
                      <Td>{entry.bank}</Td>
                      <Td className="max-w-[180px] truncate" title={entry.motif ?? ''}>{entry.motif ?? '—'}</Td>
                      <Td>
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${STATUT_BADGE[entry.statut] ?? ''}`}>
                          {entry.statut}
                        </span>
                        {entry.statut === 'Rejeté' && entry.motif_rejet && (
                          <p className="mt-0.5 max-w-[160px] truncate text-[10px] text-terracotta" title={entry.motif_rejet}>
                            {entry.motif_rejet}
                          </p>
                        )}
                      </Td>
                      <Td>{entry.date_remise ?? '—'}</Td>
                      <Td>{entry.date_encaissement ?? '—'}</Td>
                      <Td className="no-print">
                        {entry.photo_url ? (
                          <button type="button" onClick={() => setLightboxUrl(entry.photo_url)} className="block">
                            <img src={entry.photo_url} alt={`Chèque n° ${entry.cheque_number}`} className="h-10 w-10 rounded object-cover" />
                          </button>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{entry.entered_by_user ?? '—'}</Td>
                      <Td>{formatDateTime(entry.created_at)}</Td>
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
          <img src={lightboxUrl} alt="Chèque" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'type', label: 'Type', options: CHEQUE_TYPES }}
        textFilters={[
          { field: 'beneficiary', label: 'Bénéficiaire / Émetteur', suggestions: exportSuggestions('beneficiary') },
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
        modalTitle="Générer une fiche — Chèques"
        types={SHEET_TYPES}
        initialType={sheetModal}
        nameOptions={sheetNameOptions}
        onGenerate={(_typeId, name, startDate, endDate) => buildChequeSheet(entries, name, startDate, endDate)}
        excelSheetName="Fiche chèques"
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
  const isRemis = draft.statut === 'Remis en banque'
  const isEncaisse = draft.statut === 'Encaissé'
  const isRejete = draft.statut === 'Rejeté'
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td><input type="text" value={draft.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="date" value={draft.cheque_date ?? ''} onChange={(e) => set('cheque_date', e.target.value)} className={editInputClass} /></Td>
      <Td>
        <select value={draft.type} onChange={(e) => set('type', e.target.value)} className={editInputClass}>
          {CHEQUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Td>
      <Td><input type="text" value={draft.beneficiary ?? ''} onChange={(e) => set('beneficiary', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="number" step="0.01" value={draft.amount ?? ''} onChange={(e) => set('amount', e.target.value)} className={editInputClass} /></Td>
      <Td>
        <input type="text" list="cheque-edit-banks-list" value={draft.bank ?? ''} onChange={(e) => set('bank', e.target.value)} className={editInputClass} />
        <datalist id="cheque-edit-banks-list">
          {CHEQUE_BANKS.map((b) => <option key={b} value={b} />)}
        </datalist>
      </Td>
      <Td>
        <input type="text" list="cheque-edit-motifs-list" value={draft.motif ?? ''} onChange={(e) => set('motif', e.target.value)} className={editInputClass} />
        <datalist id="cheque-edit-motifs-list">
          {CHEQUE_MOTIFS.map((m) => <option key={m} value={m} />)}
        </datalist>
      </Td>
      <Td>
        <div className="flex min-w-40 flex-col gap-1">
          <select value={draft.statut} onChange={(e) => set('statut', e.target.value)} className={editInputClass}>
            {CHEQUE_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {isRejete && (
            <input type="text" placeholder="Motif de rejet" value={draft.motif_rejet ?? ''} onChange={(e) => set('motif_rejet', e.target.value)} className={editInputClass} />
          )}
        </div>
      </Td>
      <Td>
        {(isRemis || isEncaisse) ? (
          <input type="date" value={draft.date_remise ?? ''} onChange={(e) => set('date_remise', e.target.value)} className={editInputClass} />
        ) : '—'}
      </Td>
      <Td>
        {isEncaisse ? (
          <input type="date" value={draft.date_encaissement ?? ''} onChange={(e) => set('date_encaissement', e.target.value)} className={editInputClass} />
        ) : '—'}
      </Td>
      <Td className="no-print">{draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
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
    if (current.some((e) => e.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((e) => (e.id === payload.new.id ? payload.new : e))
  if (payload.eventType === 'DELETE') return current.filter((e) => e.id !== payload.old.id)
  return current
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta disabled:opacity-60'
