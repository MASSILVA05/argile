import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadFuelExcel } from '../lib/fuelExcel'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import { useAuth } from '../lib/auth'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import PrintHeader from './PrintHeader'

const OPERATION_TYPES = ['Remplissage', 'Approvisionnement']

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

export default function FuelRegistry() {
  const { isAdmin, isViewer } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [exporting, setExporting] = useState(false)
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
        .from('fuel_entries')
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
      .channel('fuel-entries-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_entries' }, (payload) => {
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
      if (!q) return true
      return [e.bon_number, e.truck_plate, e.driver_name, e.entry_date, e.supplier_name].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, typeFilter])

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
    const isRefill = editDraft.operation_type === 'Remplissage'
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      operation_type: editDraft.operation_type,
      truck_plate: isRefill ? editDraft.truck_plate?.trim() || null : null,
      driver_name: isRefill ? editDraft.driver_name?.trim() || null : null,
      volume_liters: Number(editDraft.volume_liters),
      supplier_name: !isRefill ? editDraft.supplier_name?.trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_fuel', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_bon_number: payload.bon_number,
          p_entry_date: payload.entry_date,
          p_operation_type: payload.operation_type,
          p_truck_plate: payload.truck_plate,
          p_driver_name: payload.driver_name,
          p_volume_liters: payload.volume_liters,
          p_supplier_name: payload.supplier_name,
          p_observations: payload.observations,
        })
      : await supabase.from('fuel_entries').update(payload).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_fuel', {
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
    const toExport = applyExportFilters(entries, { ...filters, categoricalField: 'operation_type' })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExporting(true)
    try {
      await downloadFuelExcel(toExport, {
        filename: buildExportFilename('Registre_Carburant', filters.startDate, filters.endDate),
      })
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete(entry) {
    if (isLocked(entry)) {
      setError(LOCK_MESSAGE)
      return
    }
    const ok = window.confirm(`Supprimer le bon carburant n° ${entry.bon_number} ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('fuel_entries').delete().eq('id', entry.id)
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
            placeholder="Rechercher : bon, matricule, chauffeur, date…"
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
              disabled={exporting}
              className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Génération en cours…' : 'Exporter Excel'}
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
        <p className="text-ink-muted">Aucune opération.</p>
      ) : (
        <div className="print-area">
          <PrintHeader title="Registre carburant" />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1100px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>Bon</Th>
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Type</Th>
                  <Th>Matricule</Th>
                  <Th>Chauffeur</Th>
                  <Th>Volume (L)</Th>
                  <Th>Fournisseur</Th>
                  <Th>Réserve après</Th>
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
                    />
                  ) : (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <Td sticky>{entry.bon_number}</Td>
                      <Td>{entry.entry_date}</Td>
                      <Td>{formatTime(entry.entry_time)}</Td>
                      <Td>{entry.operation_type}</Td>
                      <Td>{entry.truck_plate ?? '—'}</Td>
                      <Td>{entry.driver_name ?? '—'}</Td>
                      <Td>{entry.volume_liters} L</Td>
                      <Td>{entry.supplier_name ?? '—'}</Td>
                      <Td>{entry.tank_volume_after} L</Td>
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

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'operation_type', label: "Type d'opération", options: OPERATION_TYPES }}
        textFilters={[
          { field: 'truck_plate', label: 'Matricule', suggestions: exportSuggestions('truck_plate') },
          { field: 'driver_name', label: 'Chauffeur', suggestions: exportSuggestions('driver_name') },
        ]}
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

function EditRow({ draft, onChange, onSave, onCancel }) {
  const isRefill = draft.operation_type === 'Remplissage'

  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td sticky="bg-bg-soft">
        <input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
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
        {isRefill ? (
          <input type="text" value={draft.truck_plate ?? ''} onChange={(e) => set('truck_plate', e.target.value)} className={editInputClass} />
        ) : (
          '—'
        )}
      </Td>
      <Td>
        {isRefill ? (
          <input type="text" value={draft.driver_name ?? ''} onChange={(e) => set('driver_name', e.target.value)} className={editInputClass} />
        ) : (
          '—'
        )}
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.volume_liters} onChange={(e) => set('volume_liters', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        {!isRefill ? (
          <input type="text" value={draft.supplier_name ?? ''} onChange={(e) => set('supplier_name', e.target.value)} className={editInputClass} />
        ) : (
          '—'
        )}
      </Td>
      <Td>{draft.tank_volume_after} L</Td>
      <Td>
        <input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={editInputClass} />
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
