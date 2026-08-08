export const PAYMENT_STATUSES = ['Espèces', 'Versement', 'Chèque', 'Non payé']
export const DESIGNATIONS = ['Brique B12', 'Brique B8', 'Autre']
export const PAYMENT_TYPES = ['A TERME', 'COMPTANT', 'AVANCE']
export const ADVANCE_PAYMENT_MODES = ['Espèces', 'Versement', 'Chèque']

export function isInvoicePaid(status) {
  return status !== 'Non payé'
}
