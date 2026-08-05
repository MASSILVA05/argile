import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifySandEntry } from '../lib/ntfy'
import { sendSandEmail } from '../lib/email'
import { uploadSandPhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { getSession } from '../lib/auth'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)
const MAX_QUANTITY_TONS = 35

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  supplier_name: '',
  transporter_name: '',
  truck_plate: '',
  driver_name: '',
  quantity_tons: '',
  sand_price: '',
  transport_price: '',
  photo_file: null,
  observations: '',
}

export default function SandForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [suppliers, setSuppliers] = useState([])
  const [transporters, setTransporters] = useState([])
  const [plates, setPlates] = useState([])
  const [drivers, setDrivers] = useState([])
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

  async function loadSuggestions() {
    const [{ data: bonRow }, { data: rows }] = await Promise.all([
      supabase.from('sand_entries').select('bon_number').order('bon_number', { ascending: false }).limit(1),
      supabase
        .from('sand_entries')
        .select('supplier_name, transporter_name, truck_plate, driver_name')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    const nextBon = bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1
    setDraft((d) => ({ ...d, bon_number: nextBon }))
    setSuppliers(dedupe(rows?.map((r) => r.supplier_name)))
    setTransporters(dedupe(rows?.map((r) => r.transporter_name)))
    setPlates(dedupe(rows?.map((r) => r.truck_plate)))
    setDrivers(dedupe(rows?.map((r) => r.driver_name)))
  }

  useEffect(() => {
    loadSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.supplier_name.trim()) return 'Le fournisseur de sable est obligatoire.'
    if (draft.quantity_tons === '') return 'La quantité est obligatoire.'
    if (Number(draft.quantity_tons) > MAX_QUANTITY_TONS) {
      return `La quantité ne peut pas dépasser ${MAX_QUANTITY_TONS} tonnes.`
    }
    if (draft.sand_price === '') return 'Le prix du sable est obligatoire.'
    if (draft.transport_price === '') return 'Le prix du transport est obligatoire.'
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
      .from('sand_entries')
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

    try {
      let photo_url = null
      if (draft.photo_file) {
        const compressed = await compressImage(draft.photo_file)
        photo_url = await uploadSandPhoto(compressed, bonNumber)
      }

      const payload = {
        bon_number: bonNumber,
        entry_date: draft.entry_date,
        entry_time: formatHHMM(new Date()),
        supplier_name: draft.supplier_name.trim(),
        transporter_name: draft.transporter_name.trim() || null,
        truck_plate: draft.truck_plate.trim() || null,
        driver_name: draft.driver_name.trim() || null,
        quantity_tons: Number(draft.quantity_tons),
        sand_price: Number(draft.sand_price),
        transport_price: Number(draft.transport_price),
        photo_url,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase
        .from('sand_entries')
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

      notifySandEntry(data)
      sendSandEmail(data)

      setSuppliers((p) => dedupe([payload.supplier_name, ...p]))
      setTransporters((p) => dedupe([payload.transporter_name, ...p]))
      setPlates((p) => dedupe([payload.truck_plate, ...p]))
      setDrivers((p) => dedupe([payload.driver_name, ...p]))

      setDraft({ ...emptyDraft, bon_number: bonNumber + 1, entry_date: draft.entry_date })
      setSuccess(`Bon n° ${bonNumber} enregistré.`)
    } catch (err) {
      setError(`Erreur d'enregistrement : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
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

      <Field label="Fournisseur de sable" required>
        <input
          type="text"
          list="sand-suppliers-list"
          value={draft.supplier_name}
          onChange={(e) => update('supplier_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          required
        />
        <datalist id="sand-suppliers-list">
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>

      <Field label="Transporteur">
        <input
          type="text"
          list="sand-transporters-list"
          value={draft.transporter_name}
          onChange={(e) => update('transporter_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="sand-transporters-list">
          {transporters.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>

      <Field label="Matricule du camion">
        <input
          type="text"
          list="sand-plates-list"
          value={draft.truck_plate}
          onChange={(e) => update('truck_plate', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="sand-plates-list">
          {plates.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Nom du chauffeur">
        <input
          type="text"
          list="sand-drivers-list"
          value={draft.driver_name}
          onChange={(e) => update('driver_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="sand-drivers-list">
          {drivers.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Field>

      <Field label="Quantité (T)" required>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          max={MAX_QUANTITY_TONS}
          value={draft.quantity_tons}
          onChange={(e) => update('quantity_tons', e.target.value)}
          className={inputClass}
          placeholder="obligatoire, max 35T"
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Prix sable (DA)" required>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.sand_price}
            onChange={(e) => update('sand_price', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Prix transport (DA)" required>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.transport_price}
            onChange={(e) => update('transport_price', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
      </div>

      <PhotoField
        label="Photo du bon"
        file={draft.photo_file}
        onChange={(f) => update('photo_file', f)}
      />

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
        {loading ? 'Enregistrement…' : 'Enregistrer la livraison'}
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

function PhotoField({ label, file, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
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

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
