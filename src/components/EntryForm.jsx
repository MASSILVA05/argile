import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyNewEntry } from '../lib/ntfy'
import { sendEmailNotification } from '../lib/email'
import { enqueueEntry } from '../lib/offlineQueue'
import { uploadBonPhoto } from '../lib/storage'
import { UNLOADING_TYPES, FIXED_WEIGHT_TYPE, FIXED_WEIGHT_TONS } from '../lib/unloadingTypes'

const todayISO = () => new Date().toISOString().slice(0, 10)

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  truck_plate: '',
  driver_name: '',
  unloading_type: 'Akbou',
  weight_tons: '',
  ticket_number: '',
  photo_file: null,
  observations: '',
}

export default function EntryForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [plates, setPlates] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadSuggestions() {
    const [{ data: bonRow }, { data: plateRows }, { data: driverRows }] = await Promise.all([
      supabase.from('entries').select('bon_number').order('bon_number', { ascending: false }).limit(1),
      supabase.from('entries').select('truck_plate').order('created_at', { ascending: false }).limit(500),
      supabase.from('entries').select('driver_name').order('created_at', { ascending: false }).limit(500),
    ])

    const nextBon = bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1
    setDraft((d) => ({ ...d, bon_number: nextBon }))
    setPlates(dedupe(plateRows?.map((r) => r.truck_plate)))
    setDrivers(dedupe(driverRows?.map((r) => r.driver_name)))
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

  function updateType(nextType) {
    setDraft((d) => {
      const wasFixed = d.unloading_type === FIXED_WEIGHT_TYPE
      const becomesFixed = nextType === FIXED_WEIGHT_TYPE
      return {
        ...d,
        unloading_type: nextType,
        weight_tons: becomesFixed ? FIXED_WEIGHT_TONS : wasFixed ? '' : d.weight_tons,
        ticket_number: becomesFixed ? '' : d.ticket_number,
      }
    })
  }

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return "La date d'entrée est obligatoire."
    if (!draft.truck_plate.trim()) return 'Le matricule du camion est obligatoire.'
    if (!draft.driver_name.trim()) return 'Le nom du chauffeur est obligatoire.'
    if (draft.unloading_type !== FIXED_WEIGHT_TYPE && draft.weight_tons === '') {
      return 'Le poids est obligatoire pour ce type de déchargement.'
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

    if (navigator.onLine) {
      const { data: existing, error: checkError } = await supabase
        .from('entries')
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
        setError(`Ce n° de bon existe déjà.`)
        return
      }
    }

    const basePayload = {
      bon_number: bonNumber,
      entry_date: draft.entry_date,
      truck_plate: draft.truck_plate.trim(),
      driver_name: draft.driver_name.trim(),
      unloading_type: draft.unloading_type,
      ticket_number: draft.unloading_type === FIXED_WEIGHT_TYPE ? null : draft.ticket_number.trim() || null,
      weight_tons: draft.unloading_type === FIXED_WEIGHT_TYPE ? FIXED_WEIGHT_TONS : Number(draft.weight_tons),
      observations: draft.observations.trim() || null,
    }

    if (!navigator.onLine) {
      enqueueEntry({ ...basePayload, photo_url: null })
      const suffix = draft.photo_file ? ' (photo non jointe, pas de réseau)' : ''
      finishSuccess(basePayload, `Bon n° ${basePayload.bon_number} enregistré hors-ligne : sera synchronisé au retour du réseau.${suffix}`)
      return
    }

    try {
      let photo_url = null
      if (draft.photo_file) {
        photo_url = await uploadBonPhoto(draft.photo_file, basePayload.bon_number)
      }

      const { data, error: insertError } = await supabase
        .from('entries')
        .insert({ ...basePayload, photo_url })
        .select()
        .single()

      if (insertError) {
        setLoading(false)
        if (insertError.code === '23505') {
          setError(`Ce n° de bon existe déjà.`)
        } else {
          setError(`Erreur d'enregistrement : ${insertError.message}`)
        }
        return
      }

      notifyNewEntry(data)
      sendEmailNotification(data)
      finishSuccess(basePayload, `Bon n° ${basePayload.bon_number} enregistré.`)
    } catch {
      enqueueEntry({ ...basePayload, photo_url: null })
      finishSuccess(basePayload, `Réseau indisponible : bon n° ${basePayload.bon_number} enregistré hors-ligne, sera synchronisé automatiquement.`)
    }
  }

  function finishSuccess(payload, message) {
    setPlates((p) => dedupe([payload.truck_plate, ...p]))
    setDrivers((p) => dedupe([payload.driver_name, ...p]))

    setDraft({
      ...emptyDraft,
      bon_number: payload.bon_number + 1,
      entry_date: draft.entry_date,
      unloading_type: payload.unloading_type,
    })
    setSuccess(message)
    setLoading(false)
  }

  const isFixedWeight = draft.unloading_type === FIXED_WEIGHT_TYPE

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

      <Field label="Type de déchargement" required>
        <select
          value={draft.unloading_type}
          onChange={(e) => updateType(e.target.value)}
          className={inputClass}
        >
          {UNLOADING_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Poids (T)" required={!isFixedWeight}>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={draft.weight_tons}
          onChange={(e) => update('weight_tons', e.target.value)}
          className={`${inputClass} ${isFixedWeight ? 'cursor-not-allowed opacity-60' : ''}`}
          placeholder={isFixedWeight ? '' : 'obligatoire'}
          disabled={isFixedWeight}
          required={!isFixedWeight}
        />
      </Field>

      {!isFixedWeight && (
        <Field label="N° Ticket de pesée">
          <input
            type="text"
            value={draft.ticket_number}
            onChange={(e) => update('ticket_number', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-muted">Photo du bon</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-soft px-3 py-2 text-center text-ink-muted hover:border-terracotta">
            {draft.photo_file ? draft.photo_file.name : 'Choisir une photo'}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => update('photo_file', e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
          <label className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ocre px-3 py-2 text-ocre hover:bg-ocre/10">
            Prendre une photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => update('photo_file', e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
        </div>
      </div>

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
