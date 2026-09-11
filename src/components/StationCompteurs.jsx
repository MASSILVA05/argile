import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession, useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { notifyStationCompteur } from '../lib/ntfy'
import { uploadStationPhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { downloadStationCompteursExcel } from '../lib/stationExcel'
import { buildExportFilename } from '../lib/exportFilters'
import {
  STATION_PUMPS,
  COMPTEUR_TYPES,
  STATION_EMPLOYEES,
  formatQty,
  computeCompteurRecap,
} from '../lib/station'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import PrintSelectionModal from './PrintSelectionModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)
const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

const TABS = [
  { id: 'form', label: 'Nouveau relevé' },
  { id: 'registry', label: 'Registre' },
]

// Débit associé à une ligne "Fin de service" = son index - celui du relevé
// "Début de service" le plus proche (même pompe, même jour). Null sinon
// (relevé de début, ou début manquant).
function rowDebit(row, allRows) {
  if (row.type_releve !== 'Fin de service') return null
  const start = allRows
    .filter((r) => r.pompe === row.pompe && r.entry_date === row.entry_date && r.type_releve === 'Début de service')
    .sort((a, b) => ((a.entry_time ?? '') < (b.entry_time ?? '') ? -1 : 1))[0]
  if (!start) return null
  return Number(row.index_compteur) - Number(start.index_compteur)
}

export default function StationCompteurs() {
  const [view, setView] = useState('form')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('station_compteurs')
        .select('*')
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) setLoadError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setRows(data ?? [])
        setLoadError('')
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('station-compteurs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_compteurs' }, (payload) => {
        setRows((current) => applyRealtime(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const recap = useMemo(() => computeCompteurRecap(rows, todayISO()), [rows])
  const operateurs = useMemo(() => {
    const names = new Set(STATION_EMPLOYEES)
    for (const r of rows) if (r.operateur) names.add(r.operateur)
    return [...names].sort()
  }, [rows])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Récapitulatif du jour — 5 pompes</span>
        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : (
          <RecapTable recap={recap} />
        )}
      </div>

      {loadError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{loadError}</p>}

      <nav className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`min-h-11 flex-1 rounded-lg border px-4 py-2 font-display transition-colors sm:flex-none ${
              view === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === 'form' ? (
        <CompteurForm operateurs={operateurs} />
      ) : (
        <CompteurRegistry rows={rows} loading={loading} />
      )}
    </div>
  )
}

// ============================================================
// Récapitulatif des 5 pompes
// ============================================================
function RecapTable({ recap }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[560px] border-collapse text-[11px] sm:text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
            <Th>Pompe</Th>
            <Th>Dernier index</Th>
            <Th>Débit du jour (L)</Th>
            <Th>Statut</Th>
          </tr>
        </thead>
        <tbody>
          {recap.map((r) => (
            <tr key={r.pompe} className="border-b border-border last:border-0">
              <Td className="font-display text-ink">{r.pompe}</Td>
              <Td>{r.lastIndex == null ? '—' : formatQty(r.lastIndex)}</Td>
              <Td>{r.debit == null ? '—' : formatQty(r.debit)}</Td>
              <Td>
                {r.hasEnd ? (
                  <span className="text-green-500" title="Relevé de fin de service fait">✓</span>
                ) : (
                  <span className="text-terracotta" title="Relevé de fin de service manquant">⚠</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================
// Formulaire
// ============================================================
const emptyDraft = {
  entry_date: todayISO(),
  pompe: STATION_PUMPS[0],
  type_releve: COMPTEUR_TYPES[0],
  index_compteur: '',
  photo_file: null,
  operateur: '',
  observations: '',
}

function CompteurForm({ operateurs }) {
  const [draft, setDraft] = useState(emptyDraft)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.pompe) return 'La pompe est obligatoire.'
    if (!draft.type_releve) return 'Le type de relevé est obligatoire.'
    if (draft.index_compteur === '' || Number(draft.index_compteur) < 0) return "L'index du compteur est obligatoire."
    if (!draft.photo_file) return 'La photo du compteur est obligatoire.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSuccess('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setLoading(true)

    try {
      const compressed = await compressImage(draft.photo_file)
      const photo_url = await uploadStationPhoto(compressed, `${draft.pompe}-${Date.now()}`)

      const payload = {
        entry_date: draft.entry_date,
        entry_time: formatHHMM(new Date()),
        pompe: draft.pompe,
        type_releve: draft.type_releve,
        index_compteur: Number(draft.index_compteur),
        photo_url,
        operateur: draft.operateur.trim() || null,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase
        .from('station_compteurs')
        .insert(payload)
        .select()
        .single()

      if (insertError) {
        setError(`Erreur d'enregistrement : ${insertError.message}`)
        return
      }

      notifyStationCompteur(data)
      setSuccess(`Relevé « ${draft.type_releve} » enregistré pour ${draft.pompe}.`)
      setDraft({ ...emptyDraft, entry_date: draft.entry_date, pompe: draft.pompe, type_releve: draft.type_releve })
    } catch (err) {
      setError(`Erreur d'upload de la photo : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" required>
          <input type="date" value={draft.entry_date} onChange={(e) => update('entry_date', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
        <Field label="Pompe" required>
          <select value={draft.pompe} onChange={(e) => update('pompe', e.target.value)} className={inputClass}>
            {STATION_PUMPS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Type de relevé" required>
        <select value={draft.type_releve} onChange={(e) => update('type_releve', e.target.value)} className={inputClass}>
          {COMPTEUR_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>

      <Field label="Index compteur" required>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={draft.index_compteur}
          onChange={(e) => update('index_compteur', e.target.value)}
          className={inputClass}
          placeholder="chiffre affiché sur le compteur"
          required
        />
      </Field>

      <PhotoField label="Photo du compteur" required file={draft.photo_file} onChange={(f) => update('photo_file', f)} />

      <Field label="Opérateur">
        <input
          type="text"
          list="station-operateurs-list"
          value={draft.operateur}
          onChange={(e) => update('operateur', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="nom du pompiste"
        />
        <datalist id="station-operateurs-list">
          {operateurs.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>

      <Field label="Observations">
        <textarea value={draft.observations} onChange={(e) => update('observations', e.target.value)} className={`${inputClass} min-h-20 resize-y`} placeholder="optionnel" />
      </Field>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer le relevé'}
      </button>
    </form>
  )
}

// ============================================================
// Registre
// ============================================================
function CompteurRegistry({ rows, loading }) {
  const { isAdmin } = useAuth()
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [pompeFilter, setPompeFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [exportProgress, setExportProgress] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)

  const withDebit = useMemo(() => rows.map((r) => ({ ...r, debit: rowDebit(r, rows) })), [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return withDebit.filter((r) => {
      if (pompeFilter && r.pompe !== pompeFilter) return false
      if (typeFilter && r.type_releve !== typeFilter) return false
      if (dateFilter && r.entry_date !== dateFilter) return false
      if (!q) return true
      return [r.operateur, r.observations].some((f) => String(f ?? '').toLowerCase().includes(q))
    })
  }, [withDebit, query, pompeFilter, typeFilter, dateFilter])

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (pompeFilter) parts.push(`Pompe : ${pompeFilter}`)
    if (typeFilter) parts.push(`Type : ${typeFilter}`)
    if (dateFilter) parts.push(`Date : ${dateFilter}`)
    return {
      subtitle: 'Registre des compteurs — Station',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: fmtTime },
        { key: 'pompe', label: 'Pompe' },
        { key: 'type_releve', label: 'Type' },
        { key: 'index_compteur', label: 'Index', align: 'right', format: (v) => formatQty(v) },
        { key: 'debit', label: 'Débit (L)', align: 'right', format: (v) => (v == null ? '—' : formatQty(v)) },
        { key: 'operateur', label: 'Opérateur' },
        { key: 'observations', label: 'Observations' },
        { key: 'entered_by_user', label: 'Saisi par' },
      ],
      rows: filtered,
    }
  }

  function startEdit(r) {
    setEditingId(r.id)
    setEditDraft({ ...r })
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
    const patch = {
      entry_date: editDraft.entry_date,
      pompe: editDraft.pompe,
      type_releve: editDraft.type_releve,
      index_compteur: Number(editDraft.index_compteur) || 0,
      operateur: editDraft.operateur?.trim() || null,
      observations: editDraft.observations?.trim() || null,
    }

    const { error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_station_compteur', { p_id: editingId, p_admin_code: editAdminCode, p: patch })
      : await supabase.from('station_compteurs').update(patch).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
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
    const { error: rpcError } = await supabase.rpc('admin_delete_station_compteur', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    closeAdminPrompt()
  }

  async function handleDelete(r) {
    if (isLocked(r)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer le relevé ${r.pompe} — ${r.type_releve} du ${r.entry_date} ?`)) return
    const { error: deleteError } = await supabase.from('station_compteurs').delete().eq('id', r.id)
    if (deleteError) setError(`Erreur de suppression : ${deleteError.message}`)
  }

  async function handleExport() {
    if (filtered.length === 0) {
      setError('Aucune donnée à exporter.')
      return
    }
    setError('')
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadStationCompteursExcel(filtered, {
        filename: buildExportFilename('Compteurs_Station', dateFilter, dateFilter),
        onProgress: (current, total) => setExportProgress({ current, total }),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExportProgress(null)
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
            placeholder="Rechercher : opérateur, observations…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={pompeFilter} onChange={(e) => setPompeFilter(e.target.value)} className={filterClass}>
            <option value="">Toutes pompes</option>
            {STATION_PUMPS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterClass}>
            <option value="">Tous types</option>
            {COMPTEUR_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
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
            onClick={handleExport}
            disabled={exportProgress != null}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportProgress != null
              ? exportProgress.total > 0
                ? `Génération… ${exportProgress.current}/${exportProgress.total} photos`
                : 'Génération…'
              : 'Exporter Excel'}
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun relevé.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1150px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Date</Th>
                <Th>Heure</Th>
                <Th>Saisie le</Th>
                <Th>Pompe</Th>
                <Th>Type</Th>
                <Th>Index</Th>
                <Th>Débit (L)</Th>
                <Th className="no-print">Photo</Th>
                <Th>Opérateur</Th>
                <Th>Observations</Th>
                <Th>Saisi par</Th>
                <Th className="no-print">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) =>
                editingId === r.id ? (
                  <EditRow key={r.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                ) : (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <Td>{r.entry_date}</Td>
                    <Td>{fmtTime(r.entry_time)}</Td>
                    <Td>{formatDateTime(r.created_at)}</Td>
                    <Td className="font-medium text-ink">{r.pompe}</Td>
                    <Td>{r.type_releve}</Td>
                    <Td className="text-right">{formatQty(r.index_compteur)}</Td>
                    <Td className="text-right">{r.debit == null ? '—' : formatQty(r.debit)}</Td>
                    <Td className="no-print">
                      {r.photo_url ? (
                        <button type="button" onClick={() => setLightboxUrl(r.photo_url)} className="block">
                          <img src={r.photo_url} alt={`Compteur ${r.pompe}`} className="h-10 w-10 rounded object-cover" />
                        </button>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>{r.operateur ?? '—'}</Td>
                    <Td className="max-w-[200px] truncate" title={r.observations ?? ''}>{r.observations ?? '—'}</Td>
                    <Td>{r.entered_by_user ?? '—'}</Td>
                    <Td className="no-print">
                      <RowActions
                        entry={r}
                        onEdit={() => startEdit(r)}
                        onDelete={() => handleDelete(r)}
                        onLockedAttempt={(action) => openAdminPrompt(action, r)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Compteur" className="max-h-full max-w-full rounded-lg" />
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
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td><input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} /></Td>
      <Td>{fmtTime(draft.entry_time)}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <select value={draft.pompe} onChange={(e) => set('pompe', e.target.value)} className={editInputClass}>
          {STATION_PUMPS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Td>
      <Td>
        <select value={draft.type_releve} onChange={(e) => set('type_releve', e.target.value)} className={editInputClass}>
          {COMPTEUR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Td>
      <Td><input type="number" step="0.01" value={draft.index_compteur ?? ''} onChange={(e) => set('index_compteur', e.target.value)} className={editInputClass} /></Td>
      <Td>—</Td>
      <Td className="no-print">{draft.photo_url ? <img src={draft.photo_url} alt="" className="h-10 w-10 rounded object-cover" /> : '—'}</Td>
      <Td><input type="text" value={draft.operateur ?? ''} onChange={(e) => set('operateur', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={editInputClass} /></Td>
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

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((r) => r.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((r) => (r.id === payload.new.id ? payload.new : r))
  if (payload.eventType === 'DELETE') return current.filter((r) => r.id !== payload.old.id)
  return current
}

function Field({ label, required, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">
        {label}
        {required && <span className="text-terracotta"> *</span>}
      </span>
      {children}
    </label>
  )
}

function PhotoField({ label, required, file, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">
        {label}
        {required && <span className="text-terracotta"> *</span>}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-soft px-3 py-2 text-center text-ink-muted hover:border-terracotta">
          {file ? file.name : 'Choisir une photo'}
          <input type="file" accept="image/*" onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
        <label className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ocre px-3 py-2 text-ocre hover:bg-ocre/10">
          Prendre une photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      </div>
    </div>
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

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
