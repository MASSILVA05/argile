// Constantes et helpers partagés par la page Caisse (formulaire, registre,
// export Excel, bandeau de solde) -- centralisés ici pour éviter la
// duplication entre CaisseForm / CaisseRegistry / caisseExcel / CaissePage.

export const OPERATION_TYPES = ['Encaissement', 'Décaissement', 'Dépense']
export const PAYMENT_MODES = ['Espèces', 'Chèque', 'Versement', 'Virement']
export const CATEGORIES = [
  'Fournisseur',
  'Client',
  'Salaire',
  'Carburant',
  'Maintenance',
  'Frais généraux',
  'Autre',
]

// Encaissement = entrée d'argent (positif).
// Décaissement / Dépense = sortie d'argent (négatif).
export function signedAmount(entry) {
  const amount = Number(entry.amount) || 0
  return entry.operation_type === 'Encaissement' ? amount : -amount
}

export function isInflow(operationType) {
  return operationType === 'Encaissement'
}

// Libellé de catégorie affiché : la valeur libre si "Autre", sinon la catégorie.
export function categoryLabel(entry) {
  return entry.category === 'Autre' && entry.category_other ? entry.category_other : entry.category
}

export function computeSolde(entries) {
  return entries.reduce((sum, e) => sum + signedAmount(e), 0)
}

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
