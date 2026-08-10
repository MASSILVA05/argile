import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyTvaEntry } from '../lib/ntfy'
import { sendTvaEmail } from '../lib/email'
import { uploadTvaPhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { getSession } from '../lib/auth'
import { PAYMENT_MODES, MONTHS } from '../lib/tvaPayment'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)
const round2 = (n) => Math.round(n * 100) / 100

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

const emptyDraft = {
  invoice_number: '',
  piece_number: '',
  entry_date: todayISO(),
  recovery_month: '',
  recovery_year: '',
  supplier_name: '',
  supplier_address: '',
  nif: '',
  nis: '',
  article: '',
  rc_number: '',
  phone: '',
  total_ht: '',
  discount_amount: '0',
  tva_amount: '0',
  dd_amount: '0',
  stamp_duty: '0',
  payment_mode: 'Non payé',
  cheque_number: '',
  cheque_bank: '',
  payment_piece: '',
  photo_file: null,
  observations: '',
}

export default function TVAForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [suppliers, setSuppliers] = useState([])
  const [addresses, setAddresses] = useState([])
  const [banks, setBanks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))
  const [tvaTouched, setTvaTouched] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  function dedupe(list) {
    return [...new Set((list ?? []).filter(Boolean))]
  }

  async function loadSuggestions() {
    const { data: rows } = await supabase
      .from('tva_entries')
      .select('supplier_name, supplier_address, cheque_bank')
      .order('created_at', { ascending: false })
      .limit(500)

    setSuppliers(dedupe(rows?.map((r) => r.supplier_name)))
    setAddresses(dedupe(rows?.map((r) => r.supplier_address)))
    setBanks(dedupe(rows?.map((r) => r.cheque_bank)))
  }

  useEffect(() => {
    loadSuggestions()
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const totalHt = Number(draft.total_ht) || 0
  const discountAmount = Number(draft.discount_amount) || 0
  const htNet = totalHt - discountAmount
  const tvaAmount = Number(draft.tva_amount) || 0
  const ddAmount = Number(draft.dd_amount) || 0
  const totalTtc = htNet + tvaAmount
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalNet = totalTtc + stampDuty

  // Pré-calcule la TVA à HT Net * 0.19 tant que le gestionnaire ne l'a pas
  // modifiée à la main (cas des quittances douane, où la TVA réelle ne suit
  // pas ce taux).
  useEffect(() => {
    if (tvaTouched) return
    update('tva_amount', String(round2(htNet * 0.19)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalHt, discountAmount, tvaTouched])

  // Fournisseur déjà connu : propose de repartir de ses dernières
  // coordonnées fiscales, sans écraser des champs déjà saisis à la main.
  async function handleSupplierBlur() {
    const name = draft.supplier_name.trim()
    if (!name) return
    const { data } = await supabase
      .from('tva_entries')
      .select('supplier_address, nif, nis, article, rc_number, phone')
      .ilike('supplier_name', name)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!data) return
    setDraft((d) => ({
      ...d,
      supplier_address: d.supplier_address || data.supplier_address || '',
      nif: d.nif || data.nif || '',
      nis: d.nis || data.nis || '',
      article: d.article || data.article || '',
      rc_number: d.rc_number || data.rc_number || '',
      phone: d.phone || data.phone || '',
    }))
  }

  function validate() {
    if (!draft.invoice_number.trim()) return 'Le n° de facture est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.supplier_name.trim()) return 'Le nom du fournisseur est obligatoire.'
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
      .from('tva_entries')
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
        photo_url = await uploadTvaPhoto(compressed, invoiceNumber)
      }

      const payload = {
        invoice_number: invoiceNumber,
        piece_number: draft.piece_number.trim() || null,
        entry_date: draft.entry_date,
        entry_time: formatHHMM(new Date()),
        recovery_month: draft.recovery_month === '' ? null : Number(draft.recovery_month),
        recovery_year: draft.recovery_year === '' ? null : Number(draft.recovery_year),
        supplier_name: draft.supplier_name.trim(),
        supplier_address: draft.supplier_address.trim() || null,
        nif: draft.nif.trim() || null,
        nis: draft.nis.trim() || null,
        article: draft.article.trim() || null,
        rc_number: draft.rc_number.trim() || null,
        phone: draft.phone.trim() || null,
        total_ht: draft.total_ht === '' ? null : totalHt,
        discount_amount: discountAmount,
        tva_amount: tvaAmount,
        dd_amount: ddAmount,
        stamp_duty: stampDuty,
        payment_mode: draft.payment_mode,
        cheque_number: isCheque ? draft.cheque_number.trim() : null,
        cheque_bank: isCheque ? draft.cheque_bank.trim() || null : null,
        payment_piece: draft.payment_piece.trim() || null,
        photo_url,
        observations: draft.observations.trim() || null,
        entered_by_user: getSession()?.username ?? null,
      }

      const { data, error: insertError } = await supabase
        .from('tva_entries')
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

      notifyTvaEntry(data)
      sendTvaEmail(data)

      setSuppliers((p) => dedupe([payload.supplier_name, ...p]))
      setAddresses((p) => dedupe([payload.supplier_address, ...p]))
      setBanks((p) => dedupe([payload.cheque_bank, ...p]))

      setTvaTouched(false)
      setDraft((d) => ({ ...emptyDraft, entry_date: d.entry_date, recovery_month: d.recovery_month, recovery_year: d.recovery_year }))
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
        <Field label="N° Pièce">
          <input
            type="text"
            value={draft.piece_number}
            onChange={(e) => update('piece_number', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <input
            type="date"
            value={draft.entry_date}
            onChange={(e) => update('entry_date', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
      </div>

      <Field label="Mois de récupération TVA">
        <div className="grid grid-cols-2 gap-3">
          <select
            value={draft.recovery_month}
            onChange={(e) => update('recovery_month', e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={draft.recovery_year}
            onChange={(e) => update('recovery_year', e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-ink-muted">Optionnel, à compléter plus tard depuis le registre si besoin.</span>
      </Field>

      <Field label="Nom du fournisseur" required>
        <input
          type="text"
          list="tva-suppliers-list"
          value={draft.supplier_name}
          onChange={(e) => update('supplier_name', e.target.value)}
          onBlur={handleSupplierBlur}
          className={inputClass}
          autoComplete="off"
          required
        />
        <datalist id="tva-suppliers-list">
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>

      <Field label="Adresse du fournisseur">
        <input
          type="text"
          list="tva-addresses-list"
          value={draft.supplier_address}
          onChange={(e) => update('supplier_address', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="tva-addresses-list">
          {addresses.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="NIF (Numéro d'Identification Fiscale)">
          <input
            type="text"
            value={draft.nif}
            onChange={(e) => update('nif', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
        <Field label="NIS (Numéro d'Identification Statistique)">
          <input
            type="text"
            value={draft.nis}
            onChange={(e) => update('nis', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Article d'imposition">
          <input
            type="text"
            value={draft.article}
            onChange={(e) => update('article', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
        <Field label="N° RC (Registre de Commerce)">
          <input
            type="text"
            value={draft.rc_number}
            onChange={(e) => update('rc_number', e.target.value)}
            className={inputClass}
            placeholder="optionnel"
          />
        </Field>
      </div>

      <Field label="Téléphone">
        <input
          type="text"
          value={draft.phone}
          onChange={(e) => update('phone', e.target.value)}
          className={inputClass}
          placeholder="optionnel"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Total HT (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.total_ht}
            onChange={(e) => update('total_ht', e.target.value)}
            className={inputClass}
            placeholder="vide pour une quittance douane"
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
        <Field label="HT Net (DA)">
          <input
            type="text"
            value={htNet.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed opacity-60`}
          />
        </Field>
        <Field label="TVA (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={draft.tva_amount}
            onChange={(e) => {
              setTvaTouched(true)
              update('tva_amount', e.target.value)
            }}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">Pré-calculée (HT Net × 0,19), modifiable (ex : quittance douane).</span>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="DD (Droits de Douane) (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.dd_amount}
            onChange={(e) => update('dd_amount', e.target.value)}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">Informatif, n'entre pas dans le calcul du TTC.</span>
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
              list="tva-banks-list"
              value={draft.cheque_bank}
              onChange={(e) => update('cheque_bank', e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
            <datalist id="tva-banks-list">
              {banks.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
        </div>
      )}

      <Field label="Pièce de règlement">
        <input
          type="text"
          value={draft.payment_piece}
          onChange={(e) => update('payment_piece', e.target.value)}
          className={inputClass}
          placeholder="optionnel"
        />
      </Field>

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
