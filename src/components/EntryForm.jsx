import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyNewEntry } from '../lib/ntfy'
import { enqueueEntry } from '../lib/offlineQueue'

const todayISO = () => new Date().toISOString().slice(0, 10)

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  truck_plate: '',
  driver_name: '',
  unloading_location: 'Akbou',
  weight_tons: '',
  observations: '',
}

export default function EntryForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [plates, setPlates] = useState([])
  const [drivers, setDrivers] = useState([])
  const [locations, setLocations] = useState(['Akbou'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadSuggestions() {
    const [{ data: bonRow }, { data: plateRows }, { data: driverRows }, { data: locRows }] =
      await Promise.all([
        supabase.from('entries').select('bon_number').order('bon_number', { ascending: false }).limit(1),
        supabase.from('entries').select('truck_plate').order('created_at', { ascending: false }).limit(500),
        supabase.from('entries').select('driver_name').order('created_at', { ascending: false }).limit(500),
        supabase.from('entries').select('unloading_location').order('created_at', { ascending: false }).limit(500),
      ])

    const nextBon = bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1
    setDraft((d) => ({ ...d, bon_number: nextBon }))
    setPlates(dedupe(plateRows?.map((r) => r.truck_plate)))
    setDrivers(dedupe(driverRows?.map((r) => r.driver_name)))
    setLocations(dedupe(['Akbou', ...(locRows?.map((r) => r.unloading_location) ?? [])]))
  }

  useEffect(() => {
    loadSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dedupe(list) {
    return [...new Set((list ?? []).filter(Boolean))]
  }

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return "La date d'entrée est obligatoire."
    if (!draft.truck_plate.trim()) return 'Le matricule du camion est obligatoire.'
    if (!draft.driver_name.trim()) return 'Le nom du chauffeur est obligatoire.'
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

    const payload = {
      bon_number: Number(draft.bon_number),
      entry_date: draft.entry_date,
      truck_plate: draft.truck_plate.trim(),
      driver_name: draft.driver_name.trim(),
      unloading_location: draft.unloading_location.trim() || 'Akbou',
      weight_tons: draft.weight_tons === '' ? null : Number(draft.weight_tons),
      observations: draft.observations.trim() || null,
    }

    if (!navigator.onLine) {
      enqueueEntry(payload)
      finishSuccess(payload, `Bon n° ${payload.bon_number} enregistré hors-ligne : sera synchronisé au retour du réseau.`)
      return
    }

    try {
      const { data, error: insertError } = await supabase
        .from('entries')
        .insert(payload)
        .select()
        .single()

      if (insertError) {
        setLoading(false)
        if (insertError.code === '23505') {
          setError(`Le n° de bon ${payload.bon_number} existe déjà. Merci de vérifier.`)
        } else {
          setError(`Erreur d'enregistrement : ${insertError.message}`)
        }
        return
      }

      notifyNewEntry(data)
      finishSuccess(payload, `Bon n° ${payload.bon_number} enregistré.`)
    } catch {
      enqueueEntry(payload)
      finishSuccess(payload, `Réseau indisponible : bon n° ${payload.bon_number} enregistré hors-ligne, sera synchronisé automatiquement.`)
    }
  }

  function finishSuccess(payload, message) {
    setPlates((p) => dedupe([payload.truck_plate, ...p]))
    setDrivers((p) => dedupe([payload.driver_name, ...p]))
    setLocations((p) => dedupe([payload.unloading_location, ...p]))

    setDraft({
      ...emptyDraft,
      bon_number: payload.bon_number + 1,
      entry_date: draft.entry_date,
      unloading_location: payload.unloading_location,
    })
    setSuccess(message)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="N° Bon" required>
          <input
            type="number"
            inputMode="numeric"
            value={draft.bon_number}
            onChange={(e) => update('bon_number', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Date d'entrée" required>
          <input
            type="date"
            value={draft.entry_date}
            onChange={(e) => update('entry_date', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
      </div>

      <Field label="Matricule du camion" required>
        <input
          type="text"
          list="plates-list"
          value={draft.truck_plate}
          onChange={(e) => update('truck_plate', e.target.value)}
          className={inputClass}
          placeholder="ex : 06123-115-06"
          autoComplete="off"
          required
        />
        <datalist id="plates-list">
          {plates.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Nom du chauffeur" required>
        <input
          type="text"
          list="drivers-list"
          value={draft.driver_name}
          onChange={(e) => update('driver_name', e.target.value)}
          className={inputClass}
          placeholder="ex : Karim Belaïd"
          autoComplete="off"
          required
        />
        <datalist id="drivers-list">
          {drivers.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Field>

      <Field label="Lieu de déchargement">
        <input
          type="text"
          list="locations-list"
          value={draft.unloading_location}
          onChange={(e) => update('unloading_location', e.target.value)}
          className={inputClass}
          autoComplete="off"
        />
        <datalist id="locations-list">
          {locations.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </Field>

      <Field label="Poids (T)">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={draft.weight_tons}
          onChange={(e) => update('weight_tons', e.target.value)}
          className={inputClass}
          placeholder="optionnel"
        />
      </Field>

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
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer le chargement'}
      </button>
    </form>
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
