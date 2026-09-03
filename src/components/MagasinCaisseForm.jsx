import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyMagasinCaisseEntry } from '../lib/ntfy'
import { uploadMagasinPhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { MC_OPERATION_TYPES, MC_PAYMENT_MODES, MC_CATEGORIES } from '../lib/magasinCaisse'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  operation_type: 'Décaissement',
  description: '',
  amount: '',
  beneficiary: '',
  client_name: '',
  payment_mode: 'Espèces',
  cheque_number: '',
  cheque_bank: '',
  piece_number: '',
  photo_file: null,
  category: 'Autre',
  category_other: '',
  observations: '',
}

export default function MagasinCaisseForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [beneficiaries, setBeneficiaries] = useState([])
  const [clients, setClients] = useState([])
  const [banks, setBanks] = useState([])
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
      supabase.from('magasin_caisse').select('bon_number').order('bon_number', { ascending: false }).limit(1),
      supabase
        .from('magasin_caisse')
        .select('beneficiary, client_name, cheque_bank')
        .order('created_at', { ascending: false })
        .limit(500),
    ])
    const nextBon = bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1
    setDraft((d) => ({ ...d, bon_number: nextBon }))
    setBeneficiaries(dedupe(rows?.map((r) => r.beneficiary)))
    setClients(dedupe(rows?.map((r) => r.client_name)))
    setBanks(dedupe(rows?.map((r) => r.cheque_bank)))
  }

  useEffect(() => {
    loadSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const isCheque = draft.payment_mode === 'Chèque'
  const isOtherCategory = draft.category === 'Autre'

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.description.trim()) return 'Le motif / libellé est obligatoire.'
    if (draft.amount === '' || Number(draft.amount) <= 0) return 'Le montant est obligatoire.'
    if (isCheque) {
      if (!draft.cheque_number.trim()) return 'Le n° de chèque est obligatoire.'
      if (!draft.cheque_bank.trim()) return 'La banque du chèque est obligatoire.'
    }
    if (isOtherCategory && !draft.category_other.trim()) return 'Précisez la catégorie « Autre ».'
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
      .from('magasin_caisse')
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
        photo_url = await uploadMagasinPhoto(compressed, `caisse-${bonNumber}`)
      }

      const payload = {
        bon_number: bonNumber,
        entry_date: draft.entry_date,
        entry_time: formatHHMM(new Date()),
        operation_type: draft.operation_type,
        description: draft.description.trim(),
        amount: Number(draft.amount),
        beneficiary: draft.beneficiary.trim() || null,
        client_name: draft.client_name.trim() || null,
        payment_mode: draft.payment_mode,
        cheque_number: isCheque ? draft.cheque_number.trim() : null,
        cheque_bank: isCheque ? draft.cheque_bank.trim() : null,
        piece_number: draft.piece_number.trim() || null,
        photo_url,
        category: draft.category,
        category_other: isOtherCategory ? draft.category_other.trim() : null,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase
        .from('magasin_caisse')
        .insert(payload)
        .select()
        .single()

      if (insertError) {
        setLoading(false)
        setError(insertError.code === '23505' ? 'Ce n° de bon existe déjà.' : `Erreur d'enregistrement : ${insertError.message}`)
        return
      }

      notifyMagasinCaisseEntry(data)

      setBeneficiaries((p) => dedupe([payload.beneficiary, ...p]))
      setClients((p) => dedupe([payload.client_name, ...p]))
      setBanks((p) => dedupe([payload.cheque_bank, ...p]))

      setDraft({
        ...emptyDraft,
        bon_number: bonNumber + 1,
        entry_date: draft.entry_date,
        operation_type: draft.operation_type,
      })
      setSuccess(`Bon caisse magasin n° ${bonNumber} enregistré.`)
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
          <input type="number" inputMode="numeric" value={draft.bon_number} onChange={(e) => update('bon_number', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Date" required>
          <input type="date" value={draft.entry_date} onChange={(e) => update('entry_date', e.target.value)} className={inputClass} required />
        </Field>
      </div>

      <Field label="Heure">
        <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
      </Field>

      <Field label="Type d'opération" required>
        <select value={draft.operation_type} onChange={(e) => update('operation_type', e.target.value)} className={inputClass}>
          {MC_OPERATION_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>

      <Field label="Motif / Libellé" required>
        <input type="text" value={draft.description} onChange={(e) => update('description', e.target.value)} className={inputClass} placeholder="ex : Achat pièce, Paiement client X, Salaire vendeur" required />
      </Field>

      <Field label="Montant (DA)" required>
        <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.amount} onChange={(e) => update('amount', e.target.value)} className={inputClass} required />
      </Field>

      <Field label="Fournisseur / Bénéficiaire">
        <input type="text" list="mc-beneficiaries-list" value={draft.beneficiary} onChange={(e) => update('beneficiary', e.target.value)} className={inputClass} autoComplete="off" placeholder="qui reçoit ou donne l'argent" />
        <datalist id="mc-beneficiaries-list">
          {beneficiaries.map((b) => <option key={b} value={b} />)}
        </datalist>
      </Field>

      <Field label="Client">
        <input type="text" list="mc-clients-list" value={draft.client_name} onChange={(e) => update('client_name', e.target.value)} className={inputClass} autoComplete="off" placeholder="optionnel" />
        <datalist id="mc-clients-list">
          {clients.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>

      <Field label="Mode de paiement" required>
        <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
          {MC_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>

      {isCheque && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="N° de chèque" required>
            <input type="text" value={draft.cheque_number} onChange={(e) => update('cheque_number', e.target.value)} className={inputClass} required />
          </Field>
          <Field label="Banque" required>
            <input type="text" list="mc-banks-list" value={draft.cheque_bank} onChange={(e) => update('cheque_bank', e.target.value)} className={inputClass} autoComplete="off" required />
            <datalist id="mc-banks-list">
              {banks.map((b) => <option key={b} value={b} />)}
            </datalist>
          </Field>
        </div>
      )}

      <Field label="N° Pièce justificative">
        <input type="text" value={draft.piece_number} onChange={(e) => update('piece_number', e.target.value)} className={inputClass} placeholder="optionnel" />
      </Field>

      <PhotoField label="Photo du justificatif" file={draft.photo_file} onChange={(f) => update('photo_file', f)} />

      <Field label="Catégorie" required>
        <select value={draft.category} onChange={(e) => update('category', e.target.value)} className={inputClass}>
          {MC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      {isOtherCategory && (
        <Field label="Préciser la catégorie" required>
          <input type="text" value={draft.category_other} onChange={(e) => update('category_other', e.target.value)} className={inputClass} required />
        </Field>
      )}

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
        {loading ? 'Enregistrement…' : 'Enregistrer'}
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
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
      </div>
    </div>
  )
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
