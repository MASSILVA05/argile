export const PAYMENT_STATUSES = ['Espèces', 'Chèque', 'Virement', 'Non payé']

export function isInvoicePaid(status) {
  return status !== 'Non payé'
}
