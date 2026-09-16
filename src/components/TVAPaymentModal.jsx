import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyTvaPayment } from '../lib/ntfy'
import { TVA_PAYMENT_MODES } from '../lib/tvaPayment'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Modal "Enregistrer un paiement" -- paiement partiel ou de solde d'une
// facture TVA, via la RPC atomique tva_record_payment (refuse si le montant
// dépasse le reste à payer).
export default function TVAPaymentModal({ entry, onClose, onSaved }) {
  const resteAPayer = Number(entry.reste_a_payer ?? (entry.total_net ?? 0) - (entry.montant_paye ?? 0))

  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState(TVA_PAYMENT_MODES[0])
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeBank, setChequeBank] = useState('')
  const [observations, setObservations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isCheque = paymentMode === 'Chèque'
  const montantNum = Number(amount) || 0

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!(montantNum > 0)) {
      setError('Le montant du paiement doit être supérieur à 0.')
      return
    }
    if (montantNum > resteAPayer) {
      setError(`Le paiement dépasse le montant restant (${formatDA(resteAPayer)} DA).`)
      return
    }
    if (isCheque && (!chequeNumber.trim() || !chequeBank.trim())) {
      setError('N° de chèque et banque obligatoires pour un paiement par chèque.')
      return
    }

    setBusy(true)
    const enteredBy = getSession()?.username ?? null
    const { data, error: rpcError } = await supabase.rpc('tva_record_payment', {
      p_tva_entry_id: entry.id,
      p_amount: montantNum,
      p_payment_mode: paymentMode,
      p_cheque_number: isCheque ? chequeNumber.trim() : null,
      p_cheque_bank: isCheque ? chequeBank.trim() : null,
      p_observations: observations.trim() || null,
      p_entered_by_user: enteredBy,
    })
    setBusy(false)

    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }

    notifyTvaPayment({
      payment: {
        amount: montantNum,
        payment_mode: paymentMode,
        cheque_number: isCheque ? chequeNumber.trim() : null,
        cheque_bank: isCheque ? chequeBank.trim() : null,
        observations: observations.trim() || null,
        entered_by_user: enteredBy,
      },
      entry: data,
    })

    onSaved(data)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:w-full sm:max-w-md sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">Enregistrer un paiement</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          Facture n° {entry.invoice_number} — Fournisseur : {entry.supplier_name}
        </p>

        <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-border bg-bg-soft px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Total facture</span>
            <span className="font-medium text-ink">{formatDA(entry.total_net)} DA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Déjà payé</span>
            <span className="font-medium text-green-500">{formatDA(entry.montant_paye)} DA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Reste à payer</span>
            <span className="font-display text-lg font-bold text-terracotta">{formatDA(resteAPayer)} DA</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Montant du paiement (DA)" required>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max={resteAPayer}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
              autoFocus
              required
            />
          </Field>

          <Field label="Mode de paiement" required>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputClass}>
              {TVA_PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>

          {isCheque && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="N° de chèque" required>
                <input type="text" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className={inputClass} required />
              </Field>
              <Field label="Banque" required>
                <input type="text" value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} className={inputClass} required />
              </Field>
            </div>
          )}

          <Field label="Observations">
            <textarea value={observations} onChange={(e) => setObservations(e.target.value)} className={`${inputClass} min-h-16 resize-y`} placeholder="optionnel" />
          </Field>

          {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm text-ink-muted hover:border-ink-muted">
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer le paiement'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
