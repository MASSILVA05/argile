import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyTvaPayerEntry } from '../lib/ntfy'
import { sendTvaPayerEmail } from '../lib/email'
import { uploadTvaPayerPhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { getSession } from '../lib/auth'
import { PAYMENT_MODES } from '../lib/tvaPayment'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const emptyDraft = {
  invoice_number: '',
  entry_date: todayISO(),
  client_name: '',
  total_ht: '',
  discount_amount: '0',
  stamp_duty: '0',
  ref_commande: '',
  ref_livraison: '',
  payment_mode: 'Non payé',
  cheque_number: '',
  cheque_bank: '',
  photo_file: null,
  observations: '',
}

export default function TVAPayerForm() {
  const [draft, setDraft] = useState(emptyDraft)
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
    const [{ data: clientRows }, { data: entryRows }] = await Promise.all([
      supabase.from('clients').select('name').order('name'),
      supabase.from('tva_payer_entries').select('cheque_bank').order('created_at', { ascending: false }).limit(500),
    ])
    setClients(dedupe(clientRows?.map((r) => r.name)))
    setBanks(dedupe(entryRows?.map((r) => r.cheque_bank)))
  }

  useEffect(() => {
    loadSuggestions()
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const totalHt = Number(draft.total_ht) || 0
  const discountAmount = Number(draft.discount_amount) || 0
  const totalTva = (totalHt - discountAmount) * 0.19
  const totalTtc = (totalHt - discountAmount) * 1.19
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalNet = totalTtc + stampDuty

  function validate() {
    if (!draft.invoice_number.trim()) return 'Le n° de facture est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.client_name.trim()) return 'Le client est obligatoire.'
    if (draft.total_ht === '') return 'Le total HT est obligatoire.'
    if (draft.payment_mode === 'Chèque' && !draft.cheque_number.trim()) {
      return 'Le n° de chèque est obligatoire.'
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

    const invoiceNumber = draft.invoice_number.trim()

    const { data: existing, error: checkError } = await supabase
      .from('tva_payer_entries')
      .select('id')
      .eq('invoice_number', invoiceNumber)
      .maybeSingle()

    if (checkError) {
      setLoading(false)
      setError(`Erreur de vérification : ${checkError.message}`)
      return
    }
    if (existing) {
      setLoading(false)
      setError('Ce n° de facture existe déjà.')
      return
    }

    const isCheque = draft.payment_mode === 'Chèque'

    try {
      let photo_url = null
      if (draft.photo_file) {
        const compressed = await compressImage(draft.photo_file)
        photo_url = await uploadTvaPayerPhoto(compressed, invoiceNumber)
      }

      const payload = {
        invoice_number: invoiceNumber,
        entry_date: draft.entry_date,
        entry_time: formatHHMM(new Date()),
        client_name: draft.client_name.trim(),
        total_ht: totalHt,
        discount_amount: discountAmount,
        stamp_duty: stampDuty,
        ref_commande: draft.ref_commande.trim() || null,
        ref_livraison: draft.ref_livraison.trim() || null,
        payment_mode: draft.payment_mode,
        cheque_number: isCheque ? draft.cheque_number.trim() : null,
        cheque_bank: isCheque ? draft.cheque_bank.trim() || null : null,
        photo_url,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase
        .from('tva_payer_entries')
        .insert(payload)
        .select()
        .single()

      if (insertError) {
        setLoading(false)
        if (insertError.code === '23505') {
          setError('Ce n° de facture existe déjà.')
        } else {
          setError(`Erreur d'enregistrement : ${insertError.message}`)
        }
        return
      }

      notifyTvaPayerEntry(data)
      sendTvaPayerEmail(data)

      setClients((p) => dedupe([payload.client_name, ...p]))
      setBanks((p) => dedupe([payload.cheque_bank, ...p]))

      setDraft((d) => ({ ...emptyDraft, entry_date: d.entry_date }))
      setSuccess(`Facture n° ${invoiceNumber} enregistrée.`)
    } catch (err) {
      setError(`Erreur d'enregistrement : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="N° Facture" required>
          <input
            type="text"
            value={draft.invoice_number}
            onChange={(e) => update('invoice_number', e.target.value)}
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

      <Field label="Client" required>
        <input
          type="text"
          list="tva-payer-clients-list"
          value={draft.client_name}
          onChange={(e) => update('client_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          required
        />
        <datalist id="tva-payer-clients-list">
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Total HT (DA)" required>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.total_ht}
            onChange={(e) => update('total_ht', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Remise (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.discount_amount}
            onChange={(e) => update('discount_amount', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Total TVA (DA)">
          <input
            type="text"
            value={totalTva.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed opacity-60`}
          />
        </Field>
        <Field label="Total TTC (DA)">
          <input
            type="text"
            value={totalTtc.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed opacity-60 font-display text-ocre`}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Timbre (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.stamp_duty}
            onChange={(e) => update('stamp_duty', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Total Net (DA)">
          <input
            type="text"
            value={totalNet.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed font-display text-ocre`}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Réf. Commande">
          <input
            type="text"
            value={draft.ref_commande}
            onChange={(e) => update('ref_commande', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
        <Field label="Réf. Livraison">
          <input
            type="text"
            value={draft.ref_livraison}
            onChange={(e) => update('ref_livraison', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
      </div>

      <Field label="Mode de paiement">
        <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
          {PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>

      {draft.payment_mode === 'Chèque' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="N° de chèque" required>
            <input
              type="text"
              value={draft.cheque_number}
              onChange={(e) => update('cheque_number', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Banque">
            <input
              type="text"
              list="tva-payer-banks-list"
              value={draft.cheque_bank}
              onChange={(e) => update('cheque_bank', e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
            <datalist id="tva-payer-banks-list">
              {banks.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-muted">Photo de facture</span>
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
        <span className="text-xs text-ink-muted">optionnel</span>
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
        {loading ? 'Enregistrement…' : 'Enregistrer la facture'}
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
