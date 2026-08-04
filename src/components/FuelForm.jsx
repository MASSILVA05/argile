import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyFuelEntry } from '../lib/ntfy'
import { sendFuelEmail } from '../lib/email'
import { getSession } from '../lib/auth'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const OPERATION_TYPES = [
  { value: 'Remplissage', label: 'Remplissage véhicule' },
  { value: 'Approvisionnement', label: 'Approvisionnement citerne' },
]

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  operation_type: 'Remplissage',
  truck_plate: '',
  driver_name: '',
  volume_liters: '',
  supplier_name: '',
  observations: '',
}

export default function FuelForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [plates, setPlates] = useState([])
  const [drivers, setDrivers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [tank, setTank] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  function dedupe(list) {
    return [...new Set((list ?? []).filter(Boolean))]
  }

  async function loadTank() {
    const { data } = await supabase.from('fuel_tank').select('*').eq('id', 1).maybeSingle()
    if (data) setTank(data)
  }

  async function loadSuggestions() {
    const [{ data: bonRow }, { data: rows }] = await Promise.all([
      supabase.from('fuel_entries').select('bon_number').order('bon_number', { ascending: false }).limit(1),
      supabase
        .from('fuel_entries')
        .select('truck_plate, driver_name, supplier_name')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    const nextBon = bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1
    setDraft((d) => ({ ...d, bon_number: nextBon }))
    setPlates(dedupe(rows?.map((r) => r.truck_plate)))
    setDrivers(dedupe(rows?.map((r) => r.driver_name)))
    setSuppliers(dedupe(rows?.map((r) => r.supplier_name)))
  }

  useEffect(() => {
    loadTank()
    loadSuggestions()

    const channel = supabase
      .channel('fuel-tank-form')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_tank' }, (payload) => {
        setTank(payload.new)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const isRefill = draft.operation_type === 'Remplissage'

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (isRefill) {
      if (!draft.truck_plate.trim()) return 'Le matricule du camion est obligatoire.'
      if (!draft.driver_name.trim()) return 'Le nom du chauffeur est obligatoire.'
    }
    if (draft.volume_liters === '' || Number(draft.volume_liters) <= 0) {
      return 'Le volume est obligatoire.'
    }
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

    const bonNumber = Number(draft.bon_number)

    const { data: existing, error: checkError } = await supabase
      .from('fuel_entries')
      .select('id')
      .eq('bon_number', bonNumber)
      .maybeSingle()

    if (checkError) {
      setLoading(false)
      setError(`Erreur de vérification : ${checkError.message}`)
      return
    }
    if (existing) {
      setLoading(false)
      setError('Ce n° de bon existe déjà.')
      return
    }

    const payload = {
      bon_number: bonNumber,
      entry_date: draft.entry_date,
      entry_time: formatHHMM(new Date()),
      operation_type: draft.operation_type,
      truck_plate: isRefill ? draft.truck_plate.trim() : null,
      driver_name: isRefill ? draft.driver_name.trim() : null,
      volume_liters: Number(draft.volume_liters),
      supplier_name: !isRefill ? draft.supplier_name.trim() || null : null,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: insertError } = await supabase
      .from('fuel_entries')
      .insert(payload)
      .select()
      .single()

    if (insertError) {
      setLoading(false)
      if (insertError.code === '23505') {
        setError('Ce n° de bon existe déjà.')
      } else {
        setError(`Erreur d'enregistrement : ${insertError.message}`)
      }
      return
    }

    notifyFuelEntry(data)
    sendFuelEmail(data)
    loadTank()

    setPlates((p) => dedupe([payload.truck_plate, ...p]))
    setDrivers((p) => dedupe([payload.driver_name, ...p]))
    setSuppliers((p) => dedupe([payload.supplier_name, ...p]))

    setDraft({ ...emptyDraft, bon_number: bonNumber + 1, entry_date: draft.entry_date, operation_type: draft.operation_type })
    setSuccess(`Bon n° ${bonNumber} enregistré.`)
    setLoading(false)
  }

  const percent = tank ? Math.max(0, Math.min(100, (tank.current_volume / tank.max_capacity) * 100)) : null
  const isLow = percent != null && percent < 20

  return (
    <div className="flex flex-col gap-4">
      {tank && (
        <div className="rounded-lg border border-border bg-bg-soft p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-ink-muted">Réserve actuelle</p>
            <p className={`font-display text-lg ${isLow ? 'text-terracotta' : 'text-ocre'}`}>
              {Number(tank.current_volume).toLocaleString('fr-FR')} L / {Number(tank.max_capacity).toLocaleString('fr-FR')} L
            </p>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-bg">
            <div
              className={`h-full rounded-full transition-all ${isLow ? 'bg-terracotta' : 'bg-ocre'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {isLow && <p className="mt-2 text-sm text-terracotta">⚠ Réserve faible (moins de 20%)</p>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="N° de bon" required>
            <input
              type="number"
              inputMode="numeric"
              value={draft.bon_number}
              onChange={(e) => update('bon_number', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Date" required>
            <input
              type="date"
              value={draft.entry_date}
              onChange={(e) => update('entry_date', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>

        <Field label="Type d'opération" required>
          <select
            value={draft.operation_type}
            onChange={(e) => update('operation_type', e.target.value)}
            className={inputClass}
          >
            {OPERATION_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {isRefill && (
          <>
            <Field label="Matricule du camion" required>
              <input
                type="text"
                list="fuel-plates-list"
                value={draft.truck_plate}
                onChange={(e) => update('truck_plate', e.target.value)}
                className={inputClass}
                autoComplete="off"
                required
              />
              <datalist id="fuel-plates-list">
                {plates.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>

            <Field label="Nom du chauffeur" required>
              <input
                type="text"
                list="fuel-drivers-list"
                value={draft.driver_name}
                onChange={(e) => update('driver_name', e.target.value)}
                className={inputClass}
                autoComplete="off"
                required
              />
              <datalist id="fuel-drivers-list">
                {drivers.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
          </>
        )}

        <Field label="Volume (litres)" required>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.volume_liters}
            onChange={(e) => update('volume_liters', e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        {!isRefill && (
          <Field label="Fournisseur">
            <input
              type="text"
              list="fuel-suppliers-list"
              value={draft.supplier_name}
              onChange={(e) => update('supplier_name', e.target.value)}
              className={inputClass}
              autoComplete="off"
              placeholder="optionnel"
            />
            <datalist id="fuel-suppliers-list">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        )}

        <Field label="Observations">
          <textarea
            value={draft.observations}
            onChange={(e) => update('observations', e.target.value)}
            className={`${inputClass} min-h-20 resize-y`}
            placeholder="optionnel"
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
        >
          {loading ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </div>
  )
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
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
