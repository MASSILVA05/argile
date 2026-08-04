import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadMaintenanceExcel } from '../lib/maintenanceExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'

const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE
const PAID_OPTIONS = ['Non', 'Oui', 'En attente']

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

export default function MaintenanceRegistry() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [paidFilter, setPaidFilter] = useState('')
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
        .from('maintenance')
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
      .channel('maintenance-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' }, (payload) => {
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
      if (paidFilter && e.is_paid !== paidFilter) return false
      if (!q) return true
      return [e.fiche_number, e.machine_name, e.supplier_name, e.purchased_by, e.requested_by].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, paidFilter])

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
      fiche_number: Number(editDraft.fiche_number),
      entry_date: editDraft.entry_date,
      machine_name: editDraft.machine_name.trim(),
      problem_description: editDraft.problem_description.trim(),
      supplier_name: editDraft.supplier_name?.trim() || null,
      purchased_by: editDraft.purchased_by?.trim() || null,
      entered_by: editDraft.entered_by?.trim() || null,
      requested_by: editDraft.requested_by?.trim() || null,
      amount: editDraft.amount === '' || editDraft.amount == null ? null : Number(editDraft.amount),
      is_paid: editDraft.is_paid,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_maintenance', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_fiche_number: payload.fiche_number,
          p_entry_date: payload.entry_date,
          p_machine_name: payload.machine_name,
          p_problem_description: payload.problem_description,
          p_supplier_name: payload.supplier_name,
          p_purchased_by: payload.purchased_by,
          p_entered_by: payload.entered_by,
          p_requested_by: payload.requested_by,
          p_amount: payload.amount,
          p_is_paid: payload.is_paid,
          p_observations: payload.observations,
        })
      : await supabase.from('maintenance').update(payload).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setEntries((current) => current.map((e) => (e.id === data.id ? data : e)))
    cancelEdit()
  }

  function openAdminPrompt(action, entry) {
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
    if (!ADMIN_CODE) {
      setAdminError("VITE_ADMIN_CODE n'est pas configuré.")
      return
    }
    if (adminCodeValue !== ADMIN_CODE) {
      setAdminError('Code incorrect.')
      return
    }

    if (adminPrompt.action === 'edit') {
      const entry = adminPrompt.entry
      closeAdminPrompt()
      startEdit(entry)
      setEditAdminCode(adminCodeValue)
      return
    }

    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_delete_maintenance', {
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
    const toExport = applyExportFilters(entries, { ...filters, categoricalField: 'is_paid' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadMaintenanceExcel(toExport, {
        includePhotos,
        filename: buildExportFilename('Registre_Maintenance', filters.startDate, filters.endDate),
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
    const ok = window.confirm(`Supprimer la fiche n° ${entry.fiche_number} (${entry.machine_name}) ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('maintenance').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setEntries((current) => current.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : fiche, machine, fournisseur, acheteur…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={paidFilter}
            onChange={(e) => setPaidFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Tous les statuts</option>
            {PAID_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => { setExportError(''); setExportModalOpen(true) }}
          disabled={exportProgress != null}
          className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportProgress != null
            ? exportProgress.total > 0
              ? `Génération en cours… ${exportProgress.current}/${exportProgress.total} photos`
              : 'Génération en cours…'
            : 'Exporter Excel'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune fiche.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1200px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Fiche</Th>
                <Th>Date</Th>
                <Th>Heure</Th>
                <Th>Machine</Th>
                <Th>Problème</Th>
                <Th>Fournisseur</Th>
                <Th>Acheté par</Th>
                <Th>Saisi par</Th>
                <Th>Demandé par</Th>
                <Th>Montant</Th>
                <Th>Payé</Th>
                <Th>Photo machine</Th>
                <Th>Photo bon</Th>
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
                  />
                ) : (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <Td>{entry.fiche_number}</Td>
                    <Td>{entry.entry_date}</Td>
                    <Td>{formatTime(entry.entry_time)}</Td>
                    <Td>{entry.machine_name}</Td>
                    <Td className="max-w-[200px] truncate" title={entry.problem_description}>
                      {entry.problem_description}
                    </Td>
                    <Td>{entry.supplier_name ?? '—'}</Td>
                    <Td>{entry.purchased_by ?? '—'}</Td>
                    <Td>{entry.entered_by ?? '—'}</Td>
                    <Td>{entry.requested_by ?? '—'}</Td>
                    <Td>{entry.amount != null ? `${entry.amount} DA` : '—'}</Td>
                    <Td>{entry.is_paid}</Td>
                    <Td>
                      <PhotoThumb url={entry.machine_photo_url} onClick={setLightboxUrl} label={`Fiche n° ${entry.fiche_number}`} />
                    </Td>
                    <Td>
                      <PhotoThumb url={entry.receipt_photo_url} onClick={setLightboxUrl} label={`Fiche n° ${entry.fiche_number}`} />
                    </Td>
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
        categorical={{ field: 'is_paid', label: 'Statut payé', options: PAID_OPTIONS }}
        textFilters={[
          { field: 'machine_name', label: 'Machine', suggestions: exportSuggestions('machine_name') },
          { field: 'supplier_name', label: 'Fournisseur', suggestions: exportSuggestions('supplier_name') },
          { field: 'purchased_by', label: 'Acheté par', suggestions: exportSuggestions('purchased_by') },
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
    </div>
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

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="number" value={draft.fiche_number} onChange={(e) => set('fiche_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>
        <input type="text" value={draft.machine_name} onChange={(e) => set('machine_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.problem_description} onChange={(e) => set('problem_description', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.supplier_name ?? ''} onChange={(e) => set('supplier_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.purchased_by ?? ''} onChange={(e) => set('purchased_by', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.entered_by ?? ''} onChange={(e) => set('entered_by', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.requested_by ?? ''} onChange={(e) => set('requested_by', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.amount ?? ''} onChange={(e) => set('amount', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <select value={draft.is_paid} onChange={(e) => set('is_paid', e.target.value)} className={editInputClass}>
          {PAID_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Td>
      <Td>{draft.machine_photo_url ? <img src={draft.machine_photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
      <Td>{draft.receipt_photo_url ? <img src={draft.receipt_photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
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
