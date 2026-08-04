import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyMaintenanceEntry } from '../lib/ntfy'
import { sendMaintenanceEmail } from '../lib/email'
import { uploadMaintenancePhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { getSession, useAuth } from '../lib/auth'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const PAID_OPTIONS = ['Non', 'Oui', 'En attente']

const emptyDraft = {
  fiche_number: '',
  entry_date: todayISO(),
  machine_name: '',
  problem_description: '',
  machine_photo_file: null,
  receipt_photo_file: null,
  supplier_name: '',
  purchased_by: '',
  entered_by: '',
  requested_by: '',
  amount: '',
  is_paid: 'Non',
  observations: '',
}

export default function MaintenanceForm() {
  const { isViewer } = useAuth()
  const [draft, setDraft] = useState(emptyDraft)
  const [machines, setMachines] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [purchasers, setPurchasers] = useState([])
  const [enterers, setEnterers] = useState([])
  const [requesters, setRequesters] = useState([])
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
    const [{ data: ficheRow }, { data: rows }] = await Promise.all([
      supabase.from('maintenance').select('fiche_number').order('fiche_number', { ascending: false }).limit(1),
      supabase
        .from('maintenance')
        .select('machine_name, supplier_name, purchased_by, entered_by, requested_by')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    const nextFiche = ficheRow?.[0]?.fiche_number ? ficheRow[0].fiche_number + 1 : 1
    setDraft((d) => ({ ...d, fiche_number: nextFiche }))
    setMachines(dedupe(rows?.map((r) => r.machine_name)))
    setSuppliers(dedupe(rows?.map((r) => r.supplier_name)))
    setPurchasers(dedupe(rows?.map((r) => r.purchased_by)))
    setEnterers(dedupe(rows?.map((r) => r.entered_by)))
    setRequesters(dedupe(rows?.map((r) => r.requested_by)))
  }

  useEffect(() => {
    loadSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (!draft.fiche_number) return 'Le n° de fiche est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.machine_name.trim()) return "La machine/l'équipement est obligatoire."
    if (!draft.problem_description.trim()) return 'La description du problème est obligatoire.'
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

    const ficheNumber = Number(draft.fiche_number)

    const { data: existing, error: checkError } = await supabase
      .from('maintenance')
      .select('id')
      .eq('fiche_number', ficheNumber)
      .maybeSingle()

    if (checkError) {
      setLoading(false)
      setError(`Erreur de vérification : ${checkError.message}`)
      return
    }
    if (existing) {
      setLoading(false)
      setError('Ce n° de fiche existe déjà.')
      return
    }

    try {
      let machine_photo_url = null
      if (draft.machine_photo_file) {
        const compressed = await compressImage(draft.machine_photo_file)
        machine_photo_url = await uploadMaintenancePhoto(compressed, ficheNumber, 'machine')
      }
      let receipt_photo_url = null
      if (draft.receipt_photo_file) {
        const compressed = await compressImage(draft.receipt_photo_file)
        receipt_photo_url = await uploadMaintenancePhoto(compressed, ficheNumber, 'bon')
      }

      const payload = {
        fiche_number: ficheNumber,
        entry_date: draft.entry_date,
        entry_time: formatHHMM(new Date()),
        machine_name: draft.machine_name.trim(),
        problem_description: draft.problem_description.trim(),
        machine_photo_url,
        receipt_photo_url,
        supplier_name: draft.supplier_name.trim() || null,
        purchased_by: draft.purchased_by.trim() || null,
        entered_by: draft.entered_by.trim() || null,
        requested_by: draft.requested_by.trim() || null,
        amount: draft.amount === '' ? null : Number(draft.amount),
        is_paid: draft.is_paid,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase
        .from('maintenance')
        .insert(payload)
        .select()
        .single()

      if (insertError) {
        setLoading(false)
        if (insertError.code === '23505') {
          setError('Ce n° de fiche existe déjà.')
        } else {
          setError(`Erreur d'enregistrement : ${insertError.message}`)
        }
        return
      }

      notifyMaintenanceEntry(data)
      sendMaintenanceEmail(data)

      setMachines((p) => dedupe([payload.machine_name, ...p]))
      setSuppliers((p) => dedupe([payload.supplier_name, ...p]))
      setPurchasers((p) => dedupe([payload.purchased_by, ...p]))
      setEnterers((p) => dedupe([payload.entered_by, ...p]))
      setRequesters((p) => dedupe([payload.requested_by, ...p]))

      setDraft({ ...emptyDraft, fiche_number: ficheNumber + 1, entry_date: draft.entry_date })
      setSuccess(`Fiche n° ${ficheNumber} enregistrée.`)
    } catch (err) {
      setError(`Erreur d'enregistrement : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  if (isViewer) {
    return <p className="text-ink-muted">Accès non autorisé pour ce compte.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="N° de fiche" required>
          <input
            type="number"
            inputMode="numeric"
            value={draft.fiche_number}
            onChange={(e) => update('fiche_number', e.target.value)}
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

      <Field label="Machine / Équipement" required>
        <input
          type="text"
          list="machines-list"
          value={draft.machine_name}
          onChange={(e) => update('machine_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          required
        />
        <datalist id="machines-list">
          {machines.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      <Field label="Description du problème" required>
        <textarea
          value={draft.problem_description}
          onChange={(e) => update('problem_description', e.target.value)}
          className={`${inputClass} min-h-20 resize-y`}
          required
        />
      </Field>

      <PhotoField
        label="Photo de la machine défectueuse"
        file={draft.machine_photo_file}
        onChange={(f) => update('machine_photo_file', f)}
      />

      <PhotoField
        label="Photo du bon d'achat de la pièce"
        file={draft.receipt_photo_file}
        onChange={(f) => update('receipt_photo_file', f)}
      />

      <Field label="Nom du fournisseur">
        <input
          type="text"
          list="suppliers-list"
          value={draft.supplier_name}
          onChange={(e) => update('supplier_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="suppliers-list">
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>

      <Field label="Acheté par">
        <input
          type="text"
          list="purchasers-list"
          value={draft.purchased_by}
          onChange={(e) => update('purchased_by', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="purchasers-list">
          {purchasers.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Saisi par">
        <input
          type="text"
          list="enterers-list"
          value={draft.entered_by}
          onChange={(e) => update('entered_by', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="enterers-list">
          {enterers.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Demandé par">
        <input
          type="text"
          list="requesters-list"
          value={draft.requested_by}
          onChange={(e) => update('requested_by', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="requesters-list">
          {requesters.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Montant (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.amount}
            onChange={(e) => update('amount', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
        <Field label="Payé">
          <select value={draft.is_paid} onChange={(e) => update('is_paid', e.target.value)} className={inputClass}>
            {PAID_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
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
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer la fiche'}
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
