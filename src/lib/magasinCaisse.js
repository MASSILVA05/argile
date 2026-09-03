// Constantes et helpers de la caisse DU MAGASIN Bejaia (sous-onglet "Caisse"
// de la page Magasin). Table `magasin_caisse`, totalement séparée de la
// caisse principale de la briqueterie (`caisse_entries`).

export const MC_OPERATION_TYPES = ['Encaissement', 'Décaissement', 'Dépense']
export const MC_PAYMENT_MODES = ['Espèces', 'Chèque', 'Versement', 'Virement']
export const MC_CATEGORIES = ['Fournisseur', 'Client', 'Salaire', 'Frais généraux', 'Autre']

// Encaissement = entrée d'argent (positif). Décaissement / Dépense = sortie.
export function mcSignedAmount(entry) {
  const amount = Number(entry.amount) || 0
  return entry.operation_type === 'Encaissement' ? amount : -amount
}

export function mcIsInflow(operationType) {
  return operationType === 'Encaissement'
}

export function mcCategoryLabel(entry) {
  return entry.category === 'Autre' && entry.category_other ? entry.category_other : entry.category
}

export function mcComputeSolde(entries) {
  return (entries ?? []).reduce((sum, e) => sum + mcSignedAmount(e), 0)
}

export function mcFormatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
