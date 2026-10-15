import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { REGULARIZE_MODES, formatInvoiceBon } from '../lib/invoicePayment'
import { CHEQUE_BANKS } from '../lib/cheques'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Régularisation d'un bon non payé (BNP) depuis le registre des factures.
// Même logique que le paiement partiel (liaison Factures ↔ Chèques ↔ Caisse) :
//   - Chèque : record_cheque_with_invoice (chèque Reçu + entrée caisse auto)
//   - Espèces / Versement / Virement : record_caisse_with_invoice (entrée
//     caisse Encaissement liée à la facture)
// Les deux RPC mettent à jour montant_paye / payment_status ('Partiel' ou
// 'Payé') ; à 'Payé', le trigger invoices_assign_bon_number fait passer le
// bon de BNP à BP. L'entrée caisse est donc créée ici, jamais à la saisie.
export default function BnpRegularizeModal({ invoice, onClose, onDone }) {
  const reste = invoice ? (Number(invoice.montant_solde) || 0) - (Number(invoice.montant_paye) || 0) : 0
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!invoice) return
    setDraft({
      entry_date: todayISO(),
      amount: String(Math.max(0, reste)),
      mode: 'Espèces',
      cheque_number: '',
      bank: '',
      reference: '',
    })
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id])

  if (!invoice || !draft) return null

  const amount = Number(draft.amount) || 0
  const isCheque = draft.mode === 'Chèque'
  const needsBank = draft.mode !== 'Espèces'

  function set(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  async function nextCaisseBon() {
    const { data } = await supabase.from('caisse_entries').select('bon_number').order('bon_number', { ascending: false }).limit(1)
    return (data?.[0]?.bon_number ?? 0) + 1
  }

  async function submit(e) {
    e.preventDefault()
    if (amount <= 0) return setError('Le montant doit être supérieur à 0.')
    if (amount > reste + 0.001) return setError(`Le montant dépasse le reste à payer (${formatDA(reste)} DA).`)
    if (isCheque && !draft.cheque_number.trim()) return setError('Le n° de chèque est obligatoire.')
    if (isCheque && !draft.bank.trim()) return setError('La banque est obligatoire pour un chèque.')
    setError('')
    setBusy(true)

    const enteredBy = getSession()?.username ?? null
    const reference = draft.reference.trim() || null
    const bonLabel = formatInvoiceBon(invoice)
    let rpcError

    if (isCheque) {
      ;({ error: rpcError } = await supabase.rpc('record_cheque_with_invoice', {
        p: {
          type: 'Reçu',
          cheque_number: draft.cheque_number.trim(),
          cheque_date: draft.entry_date,
          entry_date: draft.entry_date,
          entry_time: formatHHMM(new Date()),
          beneficiary: invoice.client_name,
          amount,
          bank: draft.bank.trim(),
          motif: 'Paiement client',
          statut: 'En attente',
          observations: `Régularisation ${bonLabel}${reference ? ` — Réf. ${reference}` : ''}`,
          entered_by_user: enteredBy,
          entity: invoice.entity,
          linked_invoice_id: invoice.id,
        },
      }))
    } else {
      // N° de bon caisse : max + 1, nouvel essai si un autre poste vient de
      // prendre le même numéro (contrainte unique).
      for (let attempt = 0; attempt < 3; attempt++) {
        ;({ error: rpcError } = await supabase.rpc('record_caisse_with_invoice', {
          p: {
            bon_number: await nextCaisseBon(),
            entry_date: draft.entry_date,
            entry_time: formatHHMM(new Date()),
            operation_type: 'Encaissement',
            description: `Régularisation ${bonLabel} — Facture N° ${invoice.invoice_number}`,
            amount,
            client_name: invoice.client_name,
            payment_mode: draft.mode,
            // Banque du versement / virement : reprise par le brouillard banque.
            cheque_bank: needsBank ? draft.bank.trim() || null : null,
            piece_number: reference,
            category: 'Client',
            observations: `Régularisation ${bonLabel}`,
            entered_by_user: enteredBy,
            entity: invoice.entity,
            linked_invoice_id: invoice.id,
          },
        }))
        if (rpcError?.code !== '23505') break
      }
    }

    if (!rpcError && reference && !invoice.bank_reference) {
      await supabase.from('invoices').update({ bank_reference: reference }).eq('id', invoice.id)
    }

    setBusy(false)
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    const { data: fresh } = await supabase.from('invoices').select('*').eq('id', invoice.id).maybeSingle()
    onDone?.(fresh)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Régulariser {formatInvoiceBon(invoice)}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>

        <div className="rounded-lg border border-warning/50 bg-warning-bg px-3 py-2 text-sm">
          <p className="text-ink">Facture N° {invoice.invoice_number} — {invoice.client_name}</p>
          <p className="text-ink-muted">
            Total : {formatDA(invoice.montant_solde)} DA • Déjà payé : {formatDA(invoice.montant_paye)} DA
          </p>
          <p className="font-display text-warning">Reste à payer : {formatDA(reste)} DA</p>
        </div>

        <Field label="Date du paiement">
          <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Montant (DA)">
          <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.amount} onChange={(e) => set('amount', e.target.value)} className={inputClass} required />
          <span className="text-xs text-ink-muted">
            {amount >= reste - 0.001 ? 'Paiement intégral : le bon passera en BP.' : 'Paiement partiel : le bon reste BNP.'}
          </span>
        </Field>
        <Field label="Mode de paiement">
          <select value={draft.mode} onChange={(e) => set('mode', e.target.value)} className={inputClass}>
            {REGULARIZE_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        {isCheque && (
          <Field label="N° de chèque">
            <input type="text" value={draft.cheque_number} onChange={(e) => set('cheque_number', e.target.value)} className={inputClass} />
          </Field>
        )}
        {needsBank && (
          <Field label={isCheque ? 'Banque' : 'Banque (optionnel)'}>
            <input type="text" list="bnp-regularize-banks" value={draft.bank} onChange={(e) => set('bank', e.target.value)} className={inputClass} autoComplete="off" />
            <datalist id="bnp-regularize-banks">
              {CHEQUE_BANKS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
        )}
        <Field label="Référence bancaire (optionnel)">
          <input type="text" value={draft.reference} onChange={(e) => set('reference', e.target.value)} className={inputClass} placeholder="N° virement, référence…" />
        </Field>

        {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-lg border border-border px-4 py-3 text-ink-muted hover:border-ink-muted">
            Annuler
          </button>
          <button type="submit" disabled={busy} className="min-h-12 flex-1 rounded-lg bg-terracotta px-4 py-3 font-display text-ink hover:bg-terracotta-hover disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Enregistrer le paiement'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
