export const PAYMENT_MODES = ['Espèces', 'Chèque', 'Versement', 'Virement', 'Non payé']

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
