export const PAYMENT_MODES = ['Espèces', 'Versement', 'Chèque']
export const PAID_OPTIONS = ['Non payé', 'Payé']

// Construit les champs `${prefix}_*` à envoyer à Supabase : les champs de
// détail (mode, chèque, banque, date, montant) sont remis à null dès que le
// statut repasse à "Non payé", pour ne pas garder d'infos de paiement obsolètes.
export function buildPaymentPayload(draft, prefix) {
  const paid = draft[`${prefix}_paid`]
  const mode = draft[`${prefix}_payment_mode`]
  const isCheque = paid === 'Payé' && mode === 'Chèque'
  return {
    [`${prefix}_paid`]: paid,
    [`${prefix}_payment_mode`]: paid === 'Payé' ? mode : null,
    [`${prefix}_cheque_number`]: isCheque ? (draft[`${prefix}_cheque_number`] || '').trim() : null,
    [`${prefix}_cheque_bank`]: isCheque ? (draft[`${prefix}_cheque_bank`] || '').trim() || null : null,
    [`${prefix}_payment_date`]: paid === 'Payé' ? draft[`${prefix}_payment_date`] || null : null,
    [`${prefix}_amount_paid`]: paid === 'Payé' ? Number(draft[`${prefix}_amount_paid`] || 0) : null,
  }
}
