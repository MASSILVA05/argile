// Constantes et helpers du module Prodnet (suivi du coût de revient des
// produits finis) : produits finis, matières premières, fabrication.
//
// Fabrication = on consomme des matières premières pour produire un produit
// fini. Le coût de fabrication (somme quantité × prix moyen des matières)
// alimente le prix moyen pondéré du produit fini.

export const MATIERE_UNITES = ['U', 'KG', 'T', 'L', 'M', 'M²', 'M³', 'SAC', 'PALETTE']

export function toNum(value) {
  if (value === '' || value == null) return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })
}

// Total d'une ligne matière consommée = quantité utilisée × prix moyen.
export function ligneTotal(quantite, prixUnitaire) {
  return toNum(quantite) * toNum(prixUnitaire)
}

// Coût total de fabrication = somme des totaux de lignes matières.
export function computeCoutTotal(matieres) {
  return (matieres ?? []).reduce((s, m) => s + (Number(m.total) || 0), 0)
}

export function computeCoutUnitaire(coutTotal, quantiteProduite) {
  const q = toNum(quantiteProduite)
  return q > 0 ? toNum(coutTotal) / q : 0
}

// Résumé court des matières d'une fabrication pour l'affichage en liste.
export function matieresSummary(matieres) {
  if (!Array.isArray(matieres) || matieres.length === 0) return '—'
  const first = matieres[0]?.designation ?? '—'
  return matieres.length === 1 ? first : `${first} +${matieres.length - 1}`
}

export function matieresText(matieres) {
  if (!Array.isArray(matieres) || matieres.length === 0) return ''
  return matieres
    .map((m) => `${m.designation} ×${formatQty(m.quantite_utilisee)} @ ${formatDA(m.prix_unitaire)} = ${formatDA(m.total)}`)
    .join(' ; ')
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
