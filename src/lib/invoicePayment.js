export const PAYMENT_STATUSES = ['Espèces', 'Versement', 'Chèque', 'Non payé']
export const DESIGNATIONS = ['Brique B12', 'Brique B8', 'Autre']
export const PAYMENT_TYPES = ['A TERME', 'COMPTANT', 'AVANCE']
export const ADVANCE_PAYMENT_MODES = ['Espèces', 'Versement', 'Chèque']

export function isInvoicePaid(status) {
  return status !== 'Non payé'
}

// Bons d'enlèvement : BP = payé à l'enlèvement, BNP = non payé (créance à
// régulariser). Numérotation séparée par type, attribuée par le trigger
// invoices_assign_bon_number (schema.sql).
export const BON_TYPES = [
  { value: 'BNP', label: "Bon d'enlèvement non payé (BNP)" },
  { value: 'BP', label: "Bon d'enlèvement payé (BP)" },
]

// Modes de règlement d'un BP (tout sauf 'Non payé').
export const BP_PAYMENT_STATUSES = PAYMENT_STATUSES.filter((s) => s !== 'Non payé')

// Modes acceptés pour la régularisation d'un BNP (modal du registre).
export const REGULARIZE_MODES = ['Espèces', 'Versement', 'Virement', 'Chèque']

export function bonNumberOf(inv) {
  return inv?.bon_type === 'BNP' ? inv.bon_number_bnp : inv?.bon_number_bp
}

// "BP 0011" / "BNP 0004" ; type seul si le bon n'a pas de numéro (factures
// antérieures à la numérotation).
export function formatBonNumber(type, number) {
  if (!type) return ''
  return number ? `${type} ${String(number).padStart(4, '0')}` : type
}

export function formatInvoiceBon(inv) {
  return formatBonNumber(inv?.bon_type, bonNumberOf(inv))
}
