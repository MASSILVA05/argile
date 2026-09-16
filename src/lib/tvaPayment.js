export const PAYMENT_MODES = ['Espèces', 'Chèque', 'Versement', 'Virement', 'Non payé']

// Statuts affichés dans le filtre "Paiement" du registre : les 5 valeurs
// historiques (payment_mode fait aussi office de statut) + les 2 nouvelles
// issues du paiement partiel (voir tva_record_payment).
export const PAYMENT_STATUS_FILTERS = ['Non payé', 'Partiel', 'Payé', ...PAYMENT_MODES.filter((m) => m !== 'Non payé')]

// Modes utilisables pour un PAIEMENT (tva_payments.payment_mode) -- jamais
// 'Non payé', qui n'a pas de sens pour un paiement effectué.
export const TVA_PAYMENT_MODES = ['Espèces', 'Chèque', 'Virement', 'Versement']

export const ENTITIES = ['Briqueterie', 'AVADOU']

export const MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
]

export function monthLabel(month) {
  return MONTHS[Number(month) - 1] ?? String(month)
}

export function recoveryLabel(month, year) {
  if (!month || !year) return '—'
  return `${monthLabel(month)} ${year}`
}
