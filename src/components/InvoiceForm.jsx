import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyInvoiceEntry } from '../lib/ntfy'
import { sendInvoiceEmail } from '../lib/email'
import { getSession } from '../lib/auth'
import { PAYMENT_STATUSES, DESIGNATIONS, PAYMENT_TYPES } from '../lib/invoicePayment'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const emptyDraft = {
  invoice_number: '',
  entry_date: todayISO(),
  client_name: '',
  designation: 'Brique B12',
  designation_other: '',
  bl_number: '',
  qty_b8: '0',
  qty_b12: '0',
  qty_h: '0',
  price_b8: '',
  price_b12: '',
  price_h: '',
  discount_amount: '0',
  settlement: '0',
  disbursement: '0',
  stamp_duty: '0',
  driver_name: '',
  truck_plate: '',
  payment_type: 'A TERME',
  payment_status: 'Non payé',
  cheque_number: '',
  cheque_bank: '',
  previous_balance: '0',
  observations: '',
}

export default function InvoiceForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [clients, setClients] = useState([])
  const [clientCodes, setClientCodes] = useState([])
  const [banks, setBanks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [plates, setPlates] = useState([])
  const [paymentTypes, setPaymentTypes] = useState(PAYMENT_TYPES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))
  const [clientInfo, setClientInfo] = useState(null)
  const [advanceInfo, setAdvanceInfo] = useState(null)
  const [clientPlates, setClientPlates] = useState([])
  const [previousBalanceTouched, setPreviousBalanceTouched] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  // Recherche le client dans `clients` (solde historique), dans
  // `client_advances` (avance active) et ses matricules connues (factures
  // précédentes du même client) à chaque changement du nom saisi, avec un
  // léger debounce pour ne pas interroger la base à chaque frappe.
  useEffect(() => {
    const name = draft.client_name.trim()
    setPreviousBalanceTouched(false)
    if (!name) {
      setClientInfo(null)
      setAdvanceInfo(null)
      setClientPlates([])
      return
    }
    let cancelled = false
    const id = setTimeout(async () => {
      const [{ data: clientByName }, { data: clientByCode }, { data: advances }, { data: invoiceRows }] = await Promise.all([
        supabase
          .from('clients')
          .select('name, client_code, total_invoiced, total_paid, balance')
          .ilike('name', name)
          .maybeSingle(),
        supabase
          .from('clients')
          .select('name, client_code, total_invoiced, total_paid, balance')
          .ilike('client_code', name)
          .maybeSingle(),
        supabase.from('client_advances').select('bons_remaining').ilike('client_name', name).gt('bons_remaining', 0),
        supabase.from('invoices').select('truck_plate').ilike('client_name', name).not('truck_plate', 'is', null),
      ])
      if (cancelled) return
      const client = clientByName ?? clientByCode
      setClientInfo(client ? { found: true, ...client } : { found: false })
      // Trouvé par code (pas par nom exact) : corrige le champ avec le vrai
      // nom du client, pour que la suite (solde, matricules, enregistrement)
      // utilise systématiquement le nom, jamais le code.
      if (!clientByName && clientByCode) {
        update('client_name', clientByCode.name)
      }
      const bonsRemaining = (advances ?? []).reduce((sum, a) => sum + (a.bons_remaining || 0), 0)
      setAdvanceInfo(bonsRemaining > 0 ? { bonsRemaining } : null)
      setClientPlates(dedupe(invoiceRows?.map((r) => r.truck_plate)))
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.client_name])

  // Pré-remplit "Solde précédent" depuis le solde client trouvé, sauf si le
  // gestionnaire l'a déjà modifié à la main (correction manuelle).
  useEffect(() => {
    if (previousBalanceTouched) return
    const value = clientInfo?.found ? clientInfo.balance : 0
    setDraft((d) => ({ ...d, previous_balance: String(value ?? 0) }))
  }, [clientInfo, previousBalanceTouched])

  // Si l'immatriculation est saisie avant le client et qu'elle est déjà
  // connue, propose le nom du client associé (dernière facture avec cette
  // immatriculation) -- sans écraser un nom déjà saisi.
  async function handlePlateBlur() {
    const plate = draft.truck_plate.trim()
    if (!plate || draft.client_name.trim()) return
    const { data } = await supabase
      .from('invoices')
      .select('client_name')
      .eq('truck_plate', plate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.client_name) update('client_name', data.client_name)
  }

  function dedupe(list) {
    return [...new Set((list ?? []).filter(Boolean))]
  }

  async function loadSuggestions() {
    const [{ data: clientRows }, { data: invoiceRows }] = await Promise.all([
      supabase.from('clients').select('name, client_code').order('name'),
      supabase
        .from('invoices')
        .select('invoice_number, cheque_bank, driver_name, truck_plate, payment_type')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    setClients(dedupe(clientRows?.map((r) => r.name)))
    setClientCodes(dedupe(clientRows?.map((r) => r.client_code)))
    setBanks(dedupe(invoiceRows?.map((r) => r.cheque_bank)))
    setDrivers(dedupe(invoiceRows?.map((r) => r.driver_name)))
    setPlates(dedupe(invoiceRows?.map((r) => r.truck_plate)))
    setPaymentTypes(dedupe([...PAYMENT_TYPES, ...(invoiceRows?.map((r) => r.payment_type) ?? [])]))

    const maxNumber = (invoiceRows ?? []).reduce((max, r) => {
      const n = Number(r.invoice_number)
      return Number.isFinite(n) && n > max ? n : max
    }, 0)
    setDraft((d) => ({ ...d, invoice_number: String(maxNumber + 1) }))
  }

  useEffect(() => {
    loadSuggestions()
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const qtyB8 = Number(draft.qty_b8) || 0
  const qtyB12 = Number(draft.qty_b12) || 0
  const qtyH = Number(draft.qty_h) || 0
  const priceB8 = Number(draft.price_b8) || 0
  const priceB12 = Number(draft.price_b12) || 0
  const priceH = Number(draft.price_h) || 0
  const discountAmount = Number(draft.discount_amount) || 0
  const settlement = Number(draft.settlement) || 0

  const amount = qtyB8 * priceB8 + qtyB12 * priceB12 + qtyH * priceH
  const total = amount - discountAmount
  const balance = total - settlement
  const stampDuty = Number(draft.stamp_duty) || 0
  const totalTva = total * 0.19
  const totalTtc = total * 1.19
  const totalNet = totalTtc + stampDuty
  const previousBalance = Number(draft.previous_balance) || 0
  const newClientBalance = previousBalance + totalNet - settlement

  function validate() {
    if (!draft.invoice_number.trim()) return 'Le n° de facture est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.client_name.trim()) return 'Le client est obligatoire.'
    if (draft.designation === 'Autre' && !draft.designation_other.trim()) {
      return 'La désignation libre est obligatoire.'
    }
    if (qtyB8 === 0 && qtyB12 === 0 && qtyH === 0) {
      return 'Au moins une quantité (B8, B12 ou Autre) doit être renseignée.'
    }
    if (qtyB8 > 0 && draft.price_b8 === '') return 'Le prix unitaire B8 est obligatoire.'
    if (qtyB12 > 0 && draft.price_b12 === '') return 'Le prix unitaire B12 est obligatoire.'
    if (qtyH > 0 && draft.price_h === '') return 'Le prix unitaire Autre (H) est obligatoire.'
    if (draft.payment_status === 'Chèque' && !draft.cheque_number.trim()) {
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
      .from('invoices')
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

    const isCheque = draft.payment_status === 'Chèque'

    const clientName = draft.client_name.trim().toUpperCase()

    const payload = {
      invoice_number: invoiceNumber,
      entry_date: draft.entry_date,
      entry_time: formatHHMM(new Date()),
      client_name: clientName,
      designation: draft.designation,
      designation_other: draft.designation === 'Autre' ? draft.designation_other.trim() : null,
      bl_number: draft.bl_number.trim() || null,
      qty_b8: qtyB8,
      qty_b12: qtyB12,
      qty_h: qtyH,
      price_b8: qtyB8 > 0 ? priceB8 : 0,
      price_b12: qtyB12 > 0 ? priceB12 : 0,
      price_h: qtyH > 0 ? priceH : 0,
      discount_amount: discountAmount,
      settlement: settlement,
      disbursement: Number(draft.disbursement) || 0,
      stamp_duty: stampDuty,
      driver_name: draft.driver_name.trim() || null,
      truck_plate: draft.truck_plate.trim() || null,
      payment_type: draft.payment_type.trim() || 'A TERME',
      payment_status: draft.payment_status,
      cheque_number: isCheque ? draft.cheque_number.trim() : null,
      cheque_bank: isCheque ? draft.cheque_bank.trim() || null : null,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    try {
      const { data, error: insertError } = await supabase
        .from('invoices')
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

      notifyInvoiceEntry(data)
      sendInvoiceEmail(data)

      // Le trigger invoices_sync_client_balance vient déjà d'appliquer
      // l'effet normal de cette facture sur clients.total_invoiced/total_paid
      // (à partir du VRAI solde précédent). Si le gestionnaire a modifié
      // manuellement "Solde précédent" (correction), on applique en plus
      // l'écart entre sa valeur et la valeur réelle trouvée au départ --
      // sans quoi la correction manuelle n'aurait aucun effet persistant.
      if (clientInfo?.found && previousBalanceTouched) {
        const correction = previousBalance - (Number(clientInfo.balance) || 0)
        if (correction !== 0) {
          const { data: freshClient } = await supabase
            .from('clients')
            .select('id, total_invoiced, balance')
            .ilike('name', clientName)
            .maybeSingle()
          if (freshClient) {
            await supabase
              .from('clients')
              .update({
                total_invoiced: Number(freshClient.total_invoiced) + correction,
                balance: Number(freshClient.balance) + correction,
                updated_at: new Date().toISOString(),
              })
              .eq('id', freshClient.id)
          }
        }
      }

      setDrivers((p) => dedupe([payload.driver_name, ...p]))
      setPlates((p) => dedupe([payload.truck_plate, ...p]))
      setBanks((p) => dedupe([payload.cheque_bank, ...p]))
      setPaymentTypes((p) => dedupe([payload.payment_type, ...p]))

      setDraft((d) => ({
        ...emptyDraft,
        invoice_number: String((Number(invoiceNumber) || 0) + 1),
        entry_date: d.entry_date,
      }))
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

      <Field label="Client (Nom & Prénom / Raison Sociale)" required>
        <input
          type="text"
          list="invoice-clients-list"
          value={draft.client_name}
          onChange={(e) => update('client_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          required
        />
        <datalist id="invoice-clients-list">
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
          {clientCodes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <ClientInfoPanel info={clientInfo} />
        {advanceInfo && (
          <p className="mt-1.5 rounded-lg border border-ocre/50 bg-ocre/10 px-3 py-2 text-sm text-ocre">
            Avance active : {advanceInfo.bonsRemaining} bon{advanceInfo.bonsRemaining > 1 ? 's' : ''} restant
            {advanceInfo.bonsRemaining > 1 ? 's' : ''}
          </p>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Solde précédent (DA)">
          <input
            type="number"
            step="0.01"
            value={draft.previous_balance}
            onChange={(e) => {
              setPreviousBalanceTouched(true)
              update('previous_balance', e.target.value)
            }}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">Pré-rempli depuis le solde client, modifiable (correction manuelle).</span>
        </Field>
        <Field label="Nouveau solde (DA)">
          <input
            type="text"
            value={newClientBalance.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed font-display ${newClientBalance > 0 ? 'text-terracotta' : 'text-green-500'}`}
          />
        </Field>
      </div>

      <Field label="Désignation" required>
        <select value={draft.designation} onChange={(e) => update('designation', e.target.value)} className={inputClass}>
          {DESIGNATIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>

      {draft.designation === 'Autre' && (
        <Field label="Désignation (libre)" required>
          <input
            type="text"
            value={draft.designation_other}
            onChange={(e) => update('designation_other', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
      )}

      <Field label="N° BL">
        <input
          type="text"
          value={draft.bl_number}
          onChange={(e) => update('bl_number', e.target.value)}
          className={inputClass}
          placeholder="optionnel"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Quantité B8 (T)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.qty_b8}
            onChange={(e) => update('qty_b8', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Quantité B12 (T)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.qty_b12}
            onChange={(e) => update('qty_b12', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Autre (H)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.qty_h}
            onChange={(e) => update('qty_h', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {(qtyB8 > 0 || qtyB12 > 0 || qtyH > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {qtyB8 > 0 && (
            <Field label="Prix unitaire B8 (DA)" required>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.price_b8}
                onChange={(e) => update('price_b8', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          )}
          {qtyB12 > 0 && (
            <Field label="Prix unitaire B12 (DA)" required>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.price_b12}
                onChange={(e) => update('price_b12', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          )}
          {qtyH > 0 && (
            <Field label="Prix unitaire Autre (H) (DA)" required>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.price_h}
                onChange={(e) => update('price_h', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          )}
        </div>
      )}

      <Field label="Montant (DA)">
        <input
          type="text"
          value={amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
          readOnly
          disabled
          className={`${inputClass} cursor-not-allowed opacity-60`}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <Field label="Total (DA)">
          <input
            type="text"
            value={total.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed opacity-60 font-display text-ocre`}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="TVA (DA)">
          <input
            type="text"
            value={totalTva.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed opacity-60`}
          />
        </Field>
        <Field label="TTC (DA)">
          <input
            type="text"
            value={totalTtc.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed opacity-60`}
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
        <Field label="Règlement (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.settlement}
            onChange={(e) => update('settlement', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Décaissement (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.disbursement}
            onChange={(e) => update('disbursement', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Chauffeur">
        <input
          type="text"
          list="invoice-drivers-list"
          value={draft.driver_name}
          onChange={(e) => update('driver_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="invoice-drivers-list">
          {drivers.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Field>

      <Field label="Immatriculation">
        <input
          type="text"
          list="invoice-plates-list"
          value={draft.truck_plate}
          onChange={(e) => update('truck_plate', e.target.value)}
          onBlur={handlePlateBlur}
          className={inputClass}
          autoComplete="off"
          placeholder="optionnel"
        />
        <datalist id="invoice-plates-list">
          {(clientPlates.length > 0 ? clientPlates : plates).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Type de paiement (N/B)">
        <input
          type="text"
          list="invoice-payment-types-list"
          value={draft.payment_type}
          onChange={(e) => update('payment_type', e.target.value)}
          className={inputClass}
          autoComplete="off"
        />
        <datalist id="invoice-payment-types-list">
          {paymentTypes.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>

      <Field label="Solde (DA)">
        <input
          type="text"
          value={balance.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
          readOnly
          disabled
          className={`${inputClass} cursor-not-allowed font-display ${balance > 0 ? 'text-terracotta' : 'text-green-500'}`}
        />
      </Field>

      <Field label="Mode de paiement">
        <select
          value={draft.payment_status}
          onChange={(e) => update('payment_status', e.target.value)}
          className={inputClass}
        >
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      {draft.payment_status === 'Chèque' && (
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
              list="invoice-banks-list"
              value={draft.cheque_bank}
              onChange={(e) => update('cheque_bank', e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
            <datalist id="invoice-banks-list">
              {banks.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
        </div>
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

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function ClientInfoPanel({ info }) {
  if (!info) return null

  if (!info.found) {
    return <p className="text-xs text-ink-muted">Nouveau client — pas d'historique</p>
  }

  const balancePositive = Number(info.balance) > 0

  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm">
      <p className={`font-display ${balancePositive ? 'text-terracotta' : 'text-green-500'}`}>
        Dernier solde : {formatDA(info.balance)} DA
        {info.client_code && <span className="ml-2 font-mono text-xs text-ink-muted">Code : {info.client_code}</span>}
      </p>
      <p className="text-xs text-ink-muted">
        Total facturé : {formatDA(info.total_invoiced)} DA | Total réglé : {formatDA(info.total_paid)} DA
      </p>
    </div>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
