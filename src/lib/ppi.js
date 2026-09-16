// Constantes et helpers partagés par la page PPI (Programme Prévisionnel
// d'Importation) : Saisie / Registre / Budget / Import.

import { periodLabel } from './period'

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function formatEUR(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Origine (arabe, colonne "ORIGINE" du fichier PPI ACORDER) -> nom français,
// tel qu'enregistré dans ppi_countries.name_fr.
export const ORIGIN_AR_TO_FR = {
  'بلجيكا': 'Belgique',
  'تركيا': 'Turquie',
  'الهند': 'Inde',
  'الصين': 'Chine',
}

// % du budget consommé (0-100), pour la barre de progression du sous-onglet
// Budget : vert (< 70%) -> orange (70-90%) -> rouge (>= 90%).
export function budgetPct(country) {
  const autorise = Number(country.budget_autorise) || 0
  if (autorise <= 0) return 0
  return Math.min(100, (Number(country.budget_consomme) || 0) / autorise * 100)
}

export function budgetColor(pct) {
  if (pct >= 90) return 'terracotta'
  if (pct >= 70) return 'ocre'
  return 'green'
}

// Produit : quantité restante autorisée (quota - déjà importé, via stock_actuel).
export function productQtyRestante(product) {
  return (Number(product.quantite_autorisee) || 0) - (Number(product.stock_actuel) || 0)
}

// --- Fiche fournisseur : relevé des importations d'un fournisseur sur une
// période (réutilisé par EntitySheetModal, impression + export Excel). ------
export function buildPpiFournisseurSheet(rows, name, startDate, endDate) {
  const nameU = name.trim().toUpperCase()
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
  const matched = (rows ?? []).filter(
    (r) => String(r.fournisseur ?? '').trim().toUpperCase() === nameU && inRange(r.entry_date)
  )

  if (matched.length === 0) {
    return { error: `Aucune importation trouvée pour « ${name} » sur cette période.` }
  }

  const sorted = [...matched].sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0))

  const columns = [
    { key: 'entry_date', header: 'Date' },
    { key: 'country_name_fr', header: 'Pays' },
    { key: 'product_designation', header: 'Produit' },
    { key: 'quantite', header: 'Qté', align: 'right', format: (v) => formatQty(v) },
    { key: 'prix_unitaire', header: 'P.U. (€)', align: 'right', format: (v) => formatEUR(v) },
    { key: 'montant', header: 'Montant (€)', align: 'right', format: (v) => formatEUR(v) },
    { key: 'numero_facture', header: 'Facture' },
  ]

  const totalGeneral = sorted.reduce((s, r) => s + (Number(r.montant) || 0), 0)

  return {
    title: `Fiche fournisseur PPI — ${name}`,
    periodLabel: periodLabel(startDate, endDate),
    columns,
    rows: sorted,
    totalRows: [
      { cells: { entry_date: `${sorted.length} importation(s)`, montant: totalGeneral }, highlight: true },
    ],
    excelFilename: `Fiche_PPI_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
  }
}
