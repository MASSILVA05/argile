import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyResidenceReservation } from '../lib/ntfy'
import { uploadResidencePhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import {
  RESIDENCES,
  RESA_PAYMENT_MODES,
  RESERVATION_STATUTS,
  formatDA,
  nightsBetween,
  isUnitFree,
} from '../lib/residence'

const todayISO = () => new Date().toISOString().slice(0, 10)
const addDaysISO = (iso, n) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'

function emptyDraft(defaults = {}) {
  const arrivee = defaults.dateArrivee || todayISO()
  return {
    residence: defaults.residence || RESIDENCES[0],
    unit_id: defaults.unitId || '',
    client_name: '',
    client_phone: '',
    nb_personnes: 1,
    date_arrivee: arrivee,
    date_depart: defaults.dateDepart || addDaysISO(arrivee, 1),
    prix_nuit: '',
    arrhes: '',
    payment_mode: 'Espèces',
    statut: 'Confirmée',
    photo_file: null,
    observations: '',
  }
}

export default function ResidenceReservationForm({ defaults, onSaved, embedded = false }) {
  const [draft, setDraft] = useState(() => emptyDraft(defaults))
  const [units, setUnits] = useState([])
  const [reservations, setReservations] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const [{ data: u }, { data: r }, { data: c }] = await Promise.all([
        supabase.from('residence_units').select('*').order('code'),
        supabase.from('residence_reservations').select('*'),
        supabase.from('residence_clients').select('name, phone').order('name'),
      ])
      if (!active) return
      setUnits(u ?? [])
      setReservations(r ?? [])
      setClients(c ?? [])
    }
    load()
    return () => {
      active = false
    }
  }, [])

  // Pré-remplit le prix / nuit depuis le logement choisi (si champ vide).
  useEffect(() => {
    if (!draft.unit_id) return
    const unit = units.find((u) => u.id === draft.unit_id)
    if (unit && (draft.prix_nuit === '' || draft.prix_nuit == null)) {
      setDraft((d) => ({ ...d, prix_nuit: unit.prix_nuit ? String(unit.prix_nuit) : '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.unit_id, units])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const availableUnits = useMemo(() => {
    return units
      .filter((u) => u.residence === draft.residence)
      .filter(
        (u) =>
          u.id === draft.unit_id ||
          isUnitFree(u, reservations, draft.date_arrivee, draft.date_depart)
      )
  }, [units, reservations, draft.residence, draft.unit_id, draft.date_arrivee, draft.date_depart])

  const selectedUnit = units.find((u) => u.id === draft.unit_id) || null
  const nights = nightsBetween(draft.date_arrivee, draft.date_depart)
  const prixNuit = Number(draft.prix_nuit) || 0
  const montantTotal = nights * prixNuit
  const arrhes = Number(draft.arrhes) || 0
  const resteAPayer = montantTotal - arrhes
  const overCapacity =
    selectedUnit && Number(draft.nb_personnes) > Number(selectedUnit.capacite || 0)

  function onClientPick(name) {
    update('client_name', name)
    const existing = clients.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
    if (existing?.phone && !draft.client_phone) update('client_phone', existing.phone)
  }

  function validate() {
    if (!draft.residence) return 'La résidence est obligatoire.'
    if (!draft.unit_id) return 'Le logement est obligatoire.'
    if (!draft.client_name.trim()) return 'Le nom du client est obligatoire.'
    if (!draft.date_arrivee || !draft.date_depart) return 'Les dates sont obligatoires.'
    if (draft.date_depart <= draft.date_arrivee) return 'La date de départ doit suivre la date d’arrivée.'
    if (!Number(draft.nb_personnes) || Number(draft.nb_personnes) < 1) return 'Le nombre de personnes est obligatoire.'
    if (prixNuit <= 0) return 'Le prix par nuit est obligatoire.'
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
      let photo_url = null
      if (draft.photo_file) {
        const compressed = await compressImage(draft.photo_file)
        photo_url = await uploadResidencePhoto(compressed, `resa-${Date.now()}`)
      }

      const payload = {
        unit_id: draft.unit_id,
        unit_code: selectedUnit?.code ?? '',
        unit_nom: selectedUnit?.nom ?? '',
        residence: draft.residence,
        client_name: draft.client_name.trim(),
        client_phone: draft.client_phone.trim() || null,
        nb_personnes: Number(draft.nb_personnes),
        date_arrivee: draft.date_arrivee,
        date_depart: draft.date_depart,
        prix_nuit: prixNuit,
        arrhes,
        payment_mode: draft.payment_mode,
        statut: draft.statut,
        photo_url,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: rpcError } = await supabase.rpc('residence_record_reservation', { p: payload })
      if (rpcError) {
        setLoading(false)
        setError(`Erreur d'enregistrement : ${rpcError.message}`)
        return
      }

      notifyResidenceReservation(data)
      setSuccess(`Réservation « ${data.unit_nom} » enregistrée pour ${data.client_name}.`)
      setDraft(emptyDraft({ residence: draft.residence }))
      onSaved?.(data)
    } catch (err) {
      setError(`Erreur d'enregistrement : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${embedded ? '' : ''}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Résidence" required>
          <select
            value={draft.residence}
            onChange={(e) => setDraft((d) => ({ ...d, residence: e.target.value, unit_id: '' }))}
            className={inputClass}
          >
            {RESIDENCES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Logement" required>
          <select value={draft.unit_id} onChange={(e) => update('unit_id', e.target.value)} className={inputClass} required>
            <option value="">— Choisir —</option>
            {availableUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nom} · {u.type} · {u.capacite} pers.{u.capacite_note ? ` (${u.capacite_note})` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date d'arrivée" required>
          <input type="date" value={draft.date_arrivee} onChange={(e) => update('date_arrivee', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Date de départ" required>
          <input type="date" value={draft.date_depart} onChange={(e) => update('date_depart', e.target.value)} className={inputClass} required />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client" required>
          <input type="text" list="residence-clients-list" value={draft.client_name} onChange={(e) => onClientPick(e.target.value)} className={inputClass} autoComplete="off" required />
          <datalist id="residence-clients-list">
            {clients.map((c) => <option key={c.name} value={c.name} />)}
          </datalist>
        </Field>
        <Field label="Téléphone">
          <input type="tel" value={draft.client_phone} onChange={(e) => update('client_phone', e.target.value)} className={inputClass} autoComplete="off" />
        </Field>
      </div>

      <Field label="Nombre de personnes" required>
        <input type="number" inputMode="numeric" min="1" value={draft.nb_personnes} onChange={(e) => update('nb_personnes', e.target.value)} className={inputClass} required />
      </Field>
      {overCapacity && (
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-2 text-sm text-ocre">
          Attention : {draft.nb_personnes} personnes pour une capacité de {selectedUnit.capacite}.
          {selectedUnit.capacite_note ? ` (${selectedUnit.capacite_note})` : ''}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Prix par nuit (DA)" required>
          <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.prix_nuit} onChange={(e) => update('prix_nuit', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Arrhes / acompte versé (DA)">
          <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.arrhes} onChange={(e) => update('arrhes', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-bg-soft px-4 py-3 text-center">
        <Calc label="Nuits" value={nights} />
        <Calc label="Montant total" value={`${formatDA(montantTotal)} DA`} />
        <Calc label="Reste à payer" value={`${formatDA(resteAPayer)} DA`} tone={resteAPayer > 0 ? 'warn' : 'good'} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mode de paiement" required>
          <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
            {RESA_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Statut" required>
          <select value={draft.statut} onChange={(e) => update('statut', e.target.value)} className={inputClass}>
            {RESERVATION_STATUTS.filter((s) => s !== 'Terminée').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <PhotoField label="Photo du bon / reçu" file={draft.photo_file} onChange={(f) => update('photo_file', f)} />

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
        {loading ? 'Enregistrement…' : 'Enregistrer la réservation'}
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

function Calc({ label, value, tone }) {
  const cls = tone === 'warn' ? 'text-terracotta' : tone === 'good' ? 'text-green-500' : 'text-ink'
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${cls}`}>{value}</p>
    </div>
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
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
      </div>
    </div>
  )
}
