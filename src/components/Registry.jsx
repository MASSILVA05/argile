import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadCsv } from '../lib/csv'

export default function Registry() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)

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
    if (!q) return entries
    return entries.filter((e) =>
      [e.bon_number, e.truck_plate, e.driver_name, e.unloading_location]
        .some((field) => String(field ?? '').toLowerCase().includes(q))
    )
  }, [entries, query])

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
    const payload = {
      bon_number: Number(editDraft.bon_number),
      entry_date: editDraft.entry_date,
      truck_plate: editDraft.truck_plate.trim(),
      driver_name: editDraft.driver_name.trim(),
      unloading_location: editDraft.unloading_location.trim() || 'Akbou',
      weight_tons: editDraft.weight_tons === '' || editDraft.weight_tons == null ? null : Number(editDraft.weight_tons),
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

  async function handleDelete(entry) {
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
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher : bon, matricule, chauffeur, lieu…"
          className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
        />
        <button
          type="button"
          onClick={() => downloadCsv(filtered)}
          className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
        >
          Exporter CSV
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
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Bon</Th>
                <Th>Date</Th>
                <Th>Matricule</Th>
                <Th>Chauffeur</Th>
                <Th>Lieu</Th>
                <Th>Poids (T)</Th>
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
                    <Td>{entry.truck_plate}</Td>
                    <Td>{entry.driver_name}</Td>
                    <Td>{entry.unloading_location}</Td>
                    <Td>{entry.weight_tons ?? '—'}</Td>
                    <Td className="max-w-[200px] truncate" title={entry.observations ?? ''}>
                      {entry.observations ?? '—'}
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10"
                        >
                          Supprimer
                        </button>
                      </div>
                    </Td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="number" value={draft.bon_number} onChange={(e) => set('bon_number', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.truck_plate} onChange={(e) => set('truck_plate', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.driver_name} onChange={(e) => set('driver_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.unloading_location} onChange={(e) => set('unloading_location', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.weight_tons ?? ''} onChange={(e) => set('weight_tons', e.target.value)} className={editInputClass} />
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
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'

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
