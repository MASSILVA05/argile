// Constantes et helpers partagés par la page Caisse (formulaire, registre,
// export Excel, bandeau de solde) -- centralisés ici pour éviter la
// duplication entre CaisseForm / CaisseRegistry / caisseExcel / CaissePage.

export const OPERATION_TYPES = ['Encaissement', 'Décaissement', 'Dépense', 'Transfert']

// Transfert de fond : mouvement interne qui bascule de l'argent des
// décaissements vers les dépenses. Compté comme une sortie dans le solde,
// totalisé avec les dépenses (et à part dans "dont transferts"), jamais avec
// les décaissements. Exclu du brouillard banque (pas de mouvement bancaire).
export const TRANSFER_TYPE = 'Transfert'
export const TRANSFER_DESCRIPTION = 'Transfert de fond vers dépenses'

export function operationTypeLabel(operationType) {
  return operationType === TRANSFER_TYPE ? 'Transfert de fond' : operationType
}
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
// Décaissement / Dépense / Transfert = sortie d'argent (négatif).
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

// Totaux des cartes / impressions / exports, communs aux trois caisses
// (Briqueterie, Magasin, Résidence) : depenses INCLUT les transferts
// (transferts = leur part), decaissements les EXCLUT.
// solde = encaissements - decaissements - depenses (transferts compris).
export function caisseTotals(entries) {
  const sumBy = (type) =>
    (entries ?? []).filter((e) => e.operation_type === type).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const encaissements = sumBy('Encaissement')
  const decaissements = sumBy('Décaissement')
  const transferts = sumBy(TRANSFER_TYPE)
  const depenses = sumBy('Dépense') + transferts
  return { encaissements, decaissements, depenses, transferts, solde: encaissements - decaissements - depenses }
}

// Solde de la caisse APRÈS chaque opération (Map id -> solde), cumulé dans
// l'ordre chronologique (date d'opération puis date de saisie). Sert au reçu
// imprimé : solde avant = solde après - montant signé de l'opération.
export function runningBalances(entries) {
  const sorted = [...(entries ?? [])].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })
  const balances = new Map()
  let solde = 0
  for (const e of sorted) {
    solde += signedAmount(e)
    balances.set(e.id, solde)
  }
  return balances
}

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
