import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadExcel } from '../lib/excel'
import { UNLOADING_TYPES, FIXED_WEIGHT_TYPE, FIXED_WEIGHT_TONS } from '../lib/unloadingTypes'

const EDIT_LOCK_HOURS = 72

function isLocked(entry) {
  const ageMs = Date.now() - new Date(entry.created_at).getTime()
  return ageMs > EDIT_LOCK_HOURS * 3600 * 1000
}

function formatTime(value) {
  return value ? value.slice(0, 5) : '—'
}

const LOCK_MESSAGE = 'Modification impossible après 72h'

export default function Registry() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [exportProgress, setExportProgress] = useState(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('entries')
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
      .channel('entries-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, (payload) => {
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
      if (typeFilter && e.unloading_type !== typeFilter) return false
      if (!q) return true
      return [e.bon_number, e.truck_plate, e.driver_name, e.unloading_type, e.ticket_number].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, typeFilter])

  const totals = useMemo(() => {
    const weight = filtered.reduce((sum, e) => sum + (Number(e.weight_tons) || 0), 0)
    return { count: filtered.length, weight }
  }, [filtered])

  function startEdit(entry) {
    setEditingId(entry.id)
    setEditDraft({ ...entry })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
  }

  async function saveEdit() {
    if (isLocked(editDraft)) {
      setError(LOCK_MESSAGE)
      cancelEdit()
      return
    }
    const isFixed = editDraft.unloading_type === FIXED_WEIGHT_TYPE
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      truck_plate: editDraft.truck_plate.trim(),
      driver_name: editDraft.driver_name.trim(),
      unloading_type: editDraft.unloading_type,
      ticket_number: isFixed ? null : editDraft.ticket_number?.trim() || null,
      weight_tons: isFixed
        ? FIXED_WEIGHT_TONS
        : editDraft.weight_tons === '' || editDraft.weight_tons == null
          ? null
          : Number(editDraft.weight_tons),
      observations: editDraft.observations?.trim() || null,
    }
    const { data, error: updateError } = await supabase
      .from('entries')
      .update(payload)
      .eq('id', editingId)
      .select()
      .single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setEntries((current) => current.map((e) => (e.id === data.id ? data : e)))
    cancelEdit()
  }

  async function handleExport() {
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadExcel(filtered, {
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
    const ok = window.confirm(`Supprimer le bon n° ${entry.bon_number} (${entry.truck_plate}) ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('entries').delete().eq('id', entry.id)
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
            placeholder="Rechercher : bon, matricule, chauffeur, ticket…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Tous les types</option>
            {UNLOADING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleExport}
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

      <div className="flex gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
        <div>
          <p className="text-xs text-ink-muted">Bons</p>
          <p className="font-display text-xl text-ocre">{totals.count}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Tonnage cumulé</p>
          <p className="font-display text-xl text-ocre">{totals.weight.toFixed(2)} T</p>
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
        <p className="text-ink-muted">Aucune entrée.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1050px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Bon</Th>
                <Th>Date</Th>
                <Th>Heure</Th>
                <Th>Matricule</Th>
                <Th>Chauffeur</Th>
                <Th>Type</Th>
                <Th>Ticket</Th>
                <Th>Poids (T)</Th>
                <Th>Photo</Th>
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
                    <Td>{entry.bon_number}</Td>
                    <Td>{entry.entry_date}</Td>
                    <Td>{formatTime(entry.entry_time)}</Td>
                    <Td>{entry.truck_plate}</Td>
                    <Td>{entry.driver_name}</Td>
                    <Td>{entry.unloading_type}</Td>
                    <Td>{entry.ticket_number ?? '—'}</Td>
                    <Td>{entry.weight_tons ?? '—'}</Td>
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
                    <Td className="max-w-[200px] truncate" title={entry.observations ?? ''}>
                      {entry.observations ?? '—'}
                    </Td>
                    <Td>
                      <RowActions
                        entry={entry}
                        onEdit={() => startEdit(entry)}
                        onDelete={() => handleDelete(entry)}
                        onLockedAttempt={() => setError(LOCK_MESSAGE)}
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
          <img src={lightboxUrl} alt="Bon" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}

function RowActions({ entry, onEdit, onDelete, onLockedAttempt }) {
  const locked = isLocked(entry)
  const title = locked ? LOCK_MESSAGE : undefined
  const lockedClass = locked ? 'cursor-not-allowed opacity-40' : ''

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={locked ? onLockedAttempt : onEdit}
        title={title}
        className={`rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre ${lockedClass}`}
      >
        Modifier
      </button>
      <button
        type="button"
        onClick={locked ? onLockedAttempt : onDelete}
        title={title}
        className={`rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10 ${lockedClass}`}
      >
        Supprimer
      </button>
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  const isFixed = draft.unloading_type === FIXED_WEIGHT_TYPE

  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  function setType(nextType) {
    const wasFixed = draft.unloading_type === FIXED_WEIGHT_TYPE
    const becomesFixed = nextType === FIXED_WEIGHT_TYPE
    onChange({
      ...draft,
      unloading_type: nextType,
      weight_tons: becomesFixed ? FIXED_WEIGHT_TONS : wasFixed ? '' : draft.weight_tons,
      ticket_number: becomesFixed ? '' : draft.ticket_number,
    })
  }

  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>
        <input type="text" value={draft.truck_plate} onChange={(e) => set('truck_plate', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.driver_name} onChange={(e) => set('driver_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <select value={draft.unloading_type} onChange={(e) => setType(e.target.value)} className={editInputClass}>
          {UNLOADING_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Td>
      <Td>
        {isFixed ? (
          '—'
        ) : (
          <input type="text" value={draft.ticket_number ?? ''} onChange={(e) => set('ticket_number', e.target.value)} className={editInputClass} />
        )}
      </Td>
      <Td>
        <input
          type="number"
          step="0.01"
          value={draft.weight_tons ?? ''}
          onChange={(e) => set('weight_tons', e.target.value)}
          className={editInputClass}
          disabled={isFixed}
        />
      </Td>
      <Td>
        {draft.photo_url ? (
          <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" />
        ) : (
          '—'
        )}
      </Td>
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
