import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession, useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { notifyStationSalaire } from '../lib/ntfy'
import { downloadStationSalairesExcel } from '../lib/stationExcel'
import {
  STATION_EMPLOYEES,
  formatDA,
  formatQty,
  formatMonth,
  hourlyRate,
  periodToMonthInput,
  monthInputToPeriod,
} from '../lib/station'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import PrintSelectionModal from './PrintSelectionModal'

const currentMonth = () => new Date().toISOString().slice(0, 7)

const TABS = [
  { id: 'form', label: 'Nouveau salaire' },
  { id: 'registry', label: 'Registre' },
]

export default function StationSalaires() {
  const [view, setView] = useState('form')
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`min-h-11 flex-1 rounded-full border px-4 py-2 font-display transition-colors sm:flex-none ${
              view === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {view === 'form' ? <SalaireForm /> : <SalaireRegistry />}
    </div>
  )
}

// ============================================================
// Formulaire
// ============================================================
const emptyDraft = {
  month: currentMonth(),
  employee_name: '',
  hours: '',
  net_salary: '',
  irg_amount: '',
  observations: '',
}

function SalaireForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [employees, setEmployees] = useState(STATION_EMPLOYEES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('station_salaires').select('employee_name')
      const names = new Set(STATION_EMPLOYEES)
      for (const r of data ?? []) if (r.employee_name) names.add(r.employee_name)
      setEmployees([...names].sort())
    }
    load()
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const hours = Number(draft.hours) || 0
  const net = Number(draft.net_salary) || 0
  const rate = hourlyRate(hours, net)

  async function handleSubmit(e) {
    e.preventDefault()
    setSuccess('')
    if (!draft.month) return setError('Le mois est obligatoire.')
    if (!draft.employee_name.trim()) return setError("Le nom de l'employé est obligatoire.")
    if (!(hours > 0)) return setError('Le nombre d\'heures doit être supérieur à 0.')
    if (!(net > 0)) return setError('Le salaire net doit être supérieur à 0.')
    setError('')
    setLoading(true)

    const payload = {
      period: monthInputToPeriod(draft.month),
      employee_name: draft.employee_name.trim(),
      hours,
      net_salary: net,
      irg_amount: draft.irg_amount === '' ? null : Number(draft.irg_amount),
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: upsertError } = await supabase
      .from('station_salaires')
      .upsert(payload, { onConflict: 'period,employee_name' })
      .select()
      .single()
    setLoading(false)

    if (upsertError) {
      setError(`Erreur d'enregistrement : ${upsertError.message}`)
      return
    }
    notifyStationSalaire(data)
    setSuccess(`Salaire enregistré (${formatMonth(data.period)} — ${data.employee_name}).`)
    setDraft({ ...emptyDraft, month: draft.month })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mois" required>
          <input type="month" value={draft.month} onChange={(e) => update('month', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Employé" required>
          <input
            type="text"
            list="station-employees-list"
            value={draft.employee_name}
            onChange={(e) => update('employee_name', e.target.value)}
            className={inputClass}
            autoComplete="off"
            placeholder="Nom et prénom"
            required
          />
          <datalist id="station-employees-list">
            {employees.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Nombre d'heures" required>
          <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.hours} onChange={(e) => update('hours', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Salaire net (DA)" required>
          <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.net_salary} onChange={(e) => update('net_salary', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Taux horaire (calculé)">
          <input type="text" value={`${formatDA(rate)} DA/h`} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-70`} />
        </Field>
      </div>

      <Field label="Montant IRG (DA) — facultatif">
        <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.irg_amount} onChange={(e) => update('irg_amount', e.target.value)} className={inputClass} placeholder="absent du fichier — à renseigner si connu" />
      </Field>

      <Field label="Observations">
        <textarea value={draft.observations} onChange={(e) => update('observations', e.target.value)} className={`${inputClass} min-h-20 resize-y`} placeholder="optionnel" />
      </Field>

      <p className="text-xs text-ink-muted">
        Un salaire par mois et par employé : ré-enregistrer le même couple mois / employé met à jour la ligne existante.
      </p>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer le salaire'}
      </button>
    </form>
  )
}

// ============================================================
// Registre
// ============================================================
function SalaireRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
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
        .from('station_salaires')
        .select('*')
        .order('period', { ascending: false })
        .order('employee_name')
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
      .channel('station-salaires-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_salaires' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const employeeValues = useMemo(
    () => [...new Set(all.map((r) => r.employee_name).filter(Boolean))].sort(),
    [all]
  )
  const monthValues = useMemo(
    () => [...new Set(all.map((r) => periodToMonthInput(r.period)).filter(Boolean))].sort().reverse(),
    [all]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((r) => {
      if (monthFilter && periodToMonthInput(r.period) !== monthFilter) return false
      if (employeeFilter && r.employee_name !== employeeFilter) return false
      if (!q) return true
      return [r.employee_name, formatMonth(r.period), r.observations].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [all, query, monthFilter, employeeFilter])

  const totals = useMemo(() => {
    const heures = filtered.reduce((s, r) => s + (Number(r.hours) || 0), 0)
    const net = filtered.reduce((s, r) => s + (Number(r.net_salary) || 0), 0)
    const irg = filtered.reduce((s, r) => s + (Number(r.irg_amount) || 0), 0)
    return { heures, net, irg }
  }, [filtered])

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (monthFilter) parts.push(`Mois : ${formatMonth(monthFilter + '-01')}`)
    if (employeeFilter) parts.push(`Employé : ${employeeFilter}`)
    return {
      subtitle: 'Registre des salaires — Station',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'mois', label: 'Mois' },
        { key: 'employee_name', label: 'Employé' },
        { key: 'hours', label: "Nbr d'heures", align: 'right', format: (v) => formatQty(v) },
        { key: 'net_salary', label: 'Salaire net (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'hourly_rate', label: 'Taux horaire (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'irg_amount', label: 'IRG (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'observations', label: 'Observations' },
      ],
      rows: filtered.map((r) => ({
        ...r,
        mois: formatMonth(r.period),
        hourly_rate: Number(r.hourly_rate) || hourlyRate(r.hours, r.net_salary),
      })),
      totals: [
        { mois: 'TOTAUX', hours: totals.heures, net_salary: totals.net, irg_amount: totals.irg },
      ],
    }
  }

  function startEdit(r) {
    setEditingId(r.id)
    setEditDraft({ ...r, month: periodToMonthInput(r.period) })
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
      period: monthInputToPeriod(editDraft.month),
      employee_name: editDraft.employee_name?.trim() || null,
      hours: Number(editDraft.hours) || 0,
      net_salary: Number(editDraft.net_salary) || 0,
      irg_amount: editDraft.irg_amount === '' || editDraft.irg_amount == null ? null : Number(editDraft.irg_amount),
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_station_salaire', { p_id: editingId, p_admin_code: editAdminCode, p: patch })
      : await supabase.from('station_salaires').update(patch).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setAll((current) => current.map((r) => (r.id === data.id ? data : r)))
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
    const { error: rpcError } = await supabase.rpc('admin_delete_station_salaire', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((r) => r.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(r) {
    if (isLocked(r)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer le salaire de ${r.employee_name} (${formatMonth(r.period)}) ?`)) return
    const { error: deleteError } = await supabase.from('station_salaires').delete().eq('id', r.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((x) => x.id !== r.id))
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadStationSalairesExcel(filtered)
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
            placeholder="Rechercher : employé, mois…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta">
            <option value="">Tous les mois</option>
            {monthValues.map((m) => (
              <option key={m} value={m}>{formatMonth(m + '-01')}</option>
            ))}
          </select>
          <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta">
            <option value="">Tous les employés</option>
            {employeeValues.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted">
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun salaire.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Stat label="Heures" value={formatQty(totals.heures)} />
            <Stat label="Salaires nets" value={`${formatDA(totals.net)} DA`} className="text-ocre" />
            {totals.irg > 0 && <Stat label="IRG" value={`${formatDA(totals.irg)} DA`} />}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Mois</Th>
                  <Th>Employé</Th>
                  <Th>Saisie le</Th>
                  <Th>Heures</Th>
                  <Th>Salaire net</Th>
                  <Th>Taux horaire</Th>
                  <Th>IRG</Th>
                  <Th>Observations</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) =>
                  editingId === r.id ? (
                    <EditRow key={r.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <Td>{formatMonth(r.period)}</Td>
                      <Td className="font-medium text-ink">{r.employee_name}</Td>
                      <Td>{formatDateTime(r.created_at)}</Td>
                      <Td className="text-right">{formatQty(r.hours)}</Td>
                      <Td className="text-right font-medium text-ocre">{formatDA(r.net_salary)}</Td>
                      <Td className="text-right">{formatDA(Number(r.hourly_rate) || hourlyRate(r.hours, r.net_salary))}</Td>
                      <Td className="text-right">{r.irg_amount == null ? '—' : formatDA(r.irg_amount)}</Td>
                      <Td className="max-w-[220px] truncate" title={r.observations ?? ''}>{r.observations ?? '—'}</Td>
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
        </>
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
      <Td>
        <input type="month" value={draft.month} onChange={(e) => set('month', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.employee_name ?? ''} onChange={(e) => set('employee_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.hours ?? ''} onChange={(e) => set('hours', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.net_salary ?? ''} onChange={(e) => set('net_salary', e.target.value)} className={editInputClass} />
      </Td>
      <Td className="text-right">{formatDA(hourlyRate(draft.hours, draft.net_salary))}</Td>
      <Td>
        <input type="number" step="0.01" value={draft.irg_amount ?? ''} onChange={(e) => set('irg_amount', e.target.value)} className={editInputClass} placeholder="—" />
      </Td>
      <Td>
        <input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={editInputClass} />
      </Td>
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

function Stat({ label, value, className = 'text-ink' }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${className}`}>{value}</p>
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

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((r) => r.id === payload.new.id)) return current
    return [payload.new, ...current]
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

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
