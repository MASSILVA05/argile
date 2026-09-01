// Constantes et helpers partagés par la page Magasin (Bejaia) : stock,
// ventes, crédits clients, import. Centralisés ici pour éviter la
// duplication entre MagasinStock / MagasinVenteForm / MagasinVentesRegistry /
// MagasinCredits / MagasinImport et les modules d'export Excel.

import { periodLabel } from './period'
import { todayISO } from './excelHelpers'

// Modes de paiement d'un bon de vente. "Crédit" ajoute le montant à la dette
// du client ; "Versement" = règlement partiel comptant enregistré comme une
// vente classique (pas un remboursement de dette -- ça, c'est is_payment).
export const PAYMENT_MODES = ['Espèces', 'Chèque', 'Crédit', 'Versement']

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Article en stock sous le seuil d'alerte (badge rouge). stock_min = 0 -> pas
// d'alerte.
export function isLowStock(row) {
  const min = Number(row.stock_min) || 0
  return min > 0 && Number(row.quantite) < min
}

// Résumé court des articles d'un bon pour l'affichage en liste.
export function itemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return '—'
  const first = items[0]?.designation ?? '—'
  return items.length === 1 ? first : `${first} +${items.length - 1}`
}

export function itemsText(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items
    .map((it) => `${it.designation} ×${formatQty(it.quantite)} = ${formatDA(it.total)}`)
    .join(' ; ')
}

export function computeVenteTotals(items, remise) {
  const totalHt = (items ?? []).reduce((s, it) => s + (Number(it.total) || 0), 0)
  const total = totalHt - (Number(remise) || 0)
  return { totalHt, total }
}

export function itemLineTotal(quantite, prixUnitaire) {
  return (Number(quantite) || 0) * (Number(prixUnitaire) || 0)
}

// Construit les données d'une fiche client (relevé) réutilisées par
// EntitySheetModal : mêmes colonnes/rows/totaux pour l'impression et l'export
// Excel. `ventes` = toutes les lignes magasin_ventes déjà chargées (ventes +
// règlements). Convention "solde" : une vente augmente la dette (mouvement
// négatif), un règlement la diminue (mouvement positif).
export function buildMagasinClientSheet(ventes, name, startDate, endDate) {
  const nameU = name.trim().toUpperCase()
  const rows = (ventes ?? [])
    .filter((v) => String(v.client_name ?? '').trim().toUpperCase() === nameU)
    .filter((v) => (!startDate || v.entry_date >= startDate) && (!endDate || v.entry_date <= endDate))
    .sort((a, b) =>
      a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.bon_number - b.bon_number
    )
    .map((v) => ({
      bon_number: v.bon_number,
      entry_date: v.entry_date,
      libelle: v.is_payment ? 'Règlement' : itemsSummary(v.items),
      payment_mode: v.payment_mode ?? '—',
      mouvement: v.is_payment ? Number(v.total) || 0 : -(Number(v.total) || 0),
    }))

  if (rows.length === 0) {
    return { error: `Aucune opération trouvée pour « ${name} » sur cette période.` }
  }

  const columns = [
    { key: 'bon_number', header: 'N° Bon' },
    { key: 'entry_date', header: 'Date' },
    { key: 'libelle', header: 'Libellé' },
    { key: 'payment_mode', header: 'Paiement' },
    { key: 'mouvement', header: 'Mouvement (DA)', align: 'right', format: (v) => formatDA(v) },
  ]

  const net = rows.reduce((s, r) => s + r.mouvement, 0)

  return {
    title: `Relevé client magasin — ${name}`,
    periodLabel: periodLabel(startDate, endDate),
    columns,
    rows,
    totalRows: [{ cells: { bon_number: 'SOLDE NET', mouvement: net }, highlight: true }],
    excelFilename: `Fiche_Magasin_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
  }
}
