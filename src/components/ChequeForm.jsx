import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyCheque } from '../lib/ntfy'
import { uploadChequePhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { CHEQUE_TYPES, CHEQUE_STATUTS, CHEQUE_BANKS, CHEQUE_MOTIFS } from '../lib/cheques'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const emptyDraft = {
  type: 'Émis',
  cheque_number: '',
  cheque_date: todayISO(),
  beneficiary: '',
  amount: '',
  bank: '',
  bank_account: '',
  motif: '',
  statut: 'En attente',
  date_remise: '',
  date_encaissement: '',
  motif_rejet: '',
  photo_file: null,
  observations: '',
}

export default function ChequeForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [beneficiaries, setBeneficiaries] = useState([])
  const [banks, setBanks] = useState(CHEQUE_BANKS)
  const [motifs, setMotifs] = useState(CHEQUE_MOTIFS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function dedupe(list) {
    return [...new Set((list ?? []).filter(Boolean))]
  }

  async function loadSuggestions() {
    const { data: rows } = await supabase
      .from('cheques')
      .select('beneficiary, bank, motif')
      .order('created_at', { ascending: false })
      .limit(500)
    setBeneficiaries(dedupe(rows?.map((r) => r.beneficiary)))
    setBanks(dedupe([...CHEQUE_BANKS, ...(rows?.map((r) => r.bank) ?? [])]))
    setMotifs(dedupe([...CHEQUE_MOTIFS, ...(rows?.map((r) => r.motif) ?? [])]))
  }

  useEffect(() => {
    loadSuggestions()
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function setStatut(statut) {
    setDraft((d) => ({
      ...d,
      statut,
      date_remise: statut === 'Remis en banque' && !d.date_remise ? todayISO() : d.date_remise,
      date_encaissement: statut === 'Encaissé' && !d.date_encaissement ? todayISO() : d.date_encaissement,
    }))
  }

  const isRemis = draft.statut === 'Remis en banque'
  const isEncaisse = draft.statut === 'Encaissé'
  const isRejete = draft.statut === 'Rejeté'

  function validate() {
    if (!draft.cheque_number.trim()) return 'Le n° de chèque est obligatoire.'
    if (!draft.cheque_date) return 'La date du chèque est obligatoire.'
    if (!draft.beneficiary.trim()) return 'Le bénéficiaire / émetteur est obligatoire.'
    if (draft.amount === '' || Number(draft.amount) <= 0) return 'Le montant est obligatoire.'
    if (!draft.bank.trim()) return 'La banque est obligatoire.'
    if (isRemis && !draft.date_remise) return 'La date de remise est obligatoire pour ce statut.'
    if (isEncaisse && !draft.date_encaissement) return "La date d'encaissement est obligatoire pour ce statut."
    if (isRejete && !draft.motif_rejet.trim()) return 'Le motif de rejet est obligatoire pour ce statut.'
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
        photo_url = await uploadChequePhoto(compressed, `${draft.cheque_number}-${Date.now()}`)
      }

      const payload = {
        type: draft.type,
        cheque_number: draft.cheque_number.trim(),
        cheque_date: draft.cheque_date,
        entry_time: formatHHMM(new Date()),
        beneficiary: draft.beneficiary.trim(),
        amount: Number(draft.amount),
        bank: draft.bank.trim(),
        bank_account: draft.bank_account.trim() || null,
        motif: draft.motif.trim() || null,
        statut: draft.statut,
        date_remise: isRemis || isEncaisse ? draft.date_remise || null : null,
        date_encaissement: isEncaisse ? draft.date_encaissement || null : null,
        motif_rejet: isRejete ? draft.motif_rejet.trim() : null,
        photo_url,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase.from('cheques').insert(payload).select().single()

      if (insertError) {
        setError(`Erreur d'enregistrement : ${insertError.message}`)
        return
      }

      notifyCheque(data)
      setBeneficiaries((p) => dedupe([payload.beneficiary, ...p]))
      setBanks((p) => dedupe([payload.bank, ...p]))
      if (payload.motif) setMotifs((p) => dedupe([payload.motif, ...p]))

      setSuccess(`Chèque n° ${payload.cheque_number} (${payload.type}) enregistré.`)
      setDraft({ ...emptyDraft, type: draft.type, cheque_date: draft.cheque_date })
    } catch (err) {
      setError(`Erreur d'upload de la photo : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type" required>
          <select value={draft.type} onChange={(e) => update('type', e.target.value)} className={inputClass}>
            {CHEQUE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="N° Chèque" required>
          <input type="text" value={draft.cheque_number} onChange={(e) => update('cheque_number', e.target.value)} className={inputClass} required />
        </Field>
      </div>

      <Field label="Date du chèque" required>
        <input type="date" value={draft.cheque_date} onChange={(e) => update('cheque_date', e.target.value)} className={inputClass} required />
      </Field>

      <Field label={draft.type === 'Émis' ? 'Bénéficiaire' : 'Émetteur'} required>
        <input
          type="text"
          list="cheque-beneficiaries-list"
          value={draft.beneficiary}
          onChange={(e) => update('beneficiary', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder={draft.type === 'Émis' ? 'à qui on paie' : "de qui on reçoit"}
          required
        />
        <datalist id="cheque-beneficiaries-list">
          {beneficiaries.map((b) => <option key={b} value={b} />)}
        </datalist>
      </Field>

      <Field label="Montant (DA)" required>
        <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.amount} onChange={(e) => update('amount', e.target.value)} className={inputClass} required />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Banque" required>
          <input
            type="text"
            list="cheque-banks-list"
            value={draft.bank}
            onChange={(e) => update('bank', e.target.value)}
            className={inputClass}
            autoComplete="off"
            required
          />
          <datalist id="cheque-banks-list">
            {banks.map((b) => <option key={b} value={b} />)}
          </datalist>
        </Field>
        <Field label="N° Compte bancaire">
          <input type="text" value={draft.bank_account} onChange={(e) => update('bank_account', e.target.value)} className={inputClass} placeholder="optionnel" />
        </Field>
      </div>

      <Field label="Motif">
        <input
          type="text"
          list="cheque-motifs-list"
          value={draft.motif}
          onChange={(e) => update('motif', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="cheque-motifs-list">
          {motifs.map((m) => <option key={m} value={m} />)}
        </datalist>
      </Field>

      <Field label="Statut" required>
        <select value={draft.statut} onChange={(e) => setStatut(e.target.value)} className={inputClass}>
          {CHEQUE_STATUTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Field>

      {(isRemis || isEncaisse) && (
        <Field label="Date de remise en banque" required={isRemis}>
          <input type="date" value={draft.date_remise} onChange={(e) => update('date_remise', e.target.value)} className={inputClass} />
        </Field>
      )}

      {isEncaisse && (
        <Field label="Date d'encaissement" required>
          <input type="date" value={draft.date_encaissement} onChange={(e) => update('date_encaissement', e.target.value)} className={inputClass} />
        </Field>
      )}

      {isRejete && (
        <Field label="Motif de rejet" required>
          <input type="text" value={draft.motif_rejet} onChange={(e) => update('motif_rejet', e.target.value)} className={inputClass} placeholder="ex : provision insuffisante" required />
        </Field>
      )}

      <PhotoField label="Photo du chèque" file={draft.photo_file} onChange={(f) => update('photo_file', f)} />

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
        {loading ? 'Enregistrement…' : 'Enregistrer le chèque'}
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
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
