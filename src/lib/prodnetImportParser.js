import { read, utils } from 'xlsx'

// Lecture des fichiers Excel du module Prodnet :
//  - produits finis : LISTE_DES_PRODUITS_FINI.xlsx
//      Reference, Famille de produits, Quantité, Prix moyen HT, Montant HT
//  - matières premières : STOCK_AU_31122025.xlsx (2 onglets, l'utilisateur
//    choisit lequel importer)
//      « STOCK AU 31122025 »          : Désignation, Quantité totale, Unité,
//                                       Prix moyen pondéré, Valeur totale
//      « MATIERE PREMIERE AU 30062026 » : Désignation, Position Tarifaire,
//                                       Quantité Totale, Prix Unitaire
//                                       Pondéré, Valeur Totale
//
// L'en-tête est détectée par mots-clés (pas forcément la 1re ligne).

const MAX_HEADER_SCAN_ROWS = 20

function normalizeHeader(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

function toNumber(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(/ /g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function findHeader(rows, headerMap, requiredFields) {
  let best = { index: -1, columns: null, score: 0 }
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (isBlankRow(rows[i])) continue
    const columns = {}
    let score = 0
    rows[i].forEach((cell, colIndex) => {
      const field = headerMap[normalizeHeader(cell)]
      if (field && columns[field] === undefined) {
        columns[field] = colIndex
        score += 1
      }
    })
    if (requiredFields.every((f) => columns[f] !== undefined) && score > best.score) {
      best = { index: i, columns, score }
    }
  }
  return best.index === -1 ? null : best
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  return utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
}

// ---------- Produits finis ----------
const PRODUCT_HEADER_MAP = {
  REFERENCE: 'reference',
  'RÉFÉRENCE': 'reference',
  REF: 'reference',
  CODE: 'reference',
  'FAMILLE DE PRODUITS': 'designation',
  'FAMILLE DE PRODUIT': 'designation',
  FAMILLE: 'designation',
  DESIGNATION: 'designation',
  'DÉSIGNATION': 'designation',
  'PRODUIT FINI': 'designation',
  PRODUIT: 'designation',
  QUANTITE: 'quantite',
  'QUANTITÉ': 'quantite',
  QTE: 'quantite',
  'QUANTITE TOTALE': 'quantite',
  'PRIX MOYEN HT': 'prix_moyen_ht',
  'PRIX MOYEN': 'prix_moyen_ht',
  'PRIX MOYEN PONDERE': 'prix_moyen_ht',
  'PRIX MOYEN PONDÉRÉ': 'prix_moyen_ht',
  'MONTANT HT': 'montant_ht',
  'VALEUR TOTALE': 'montant_ht',
  MONTANT: 'montant_ht',
}

export function parseProdnetProductsFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook, name)
    const header = findHeader(rows, PRODUCT_HEADER_MAP, ['designation'])
    if (!header) continue
    const { index, columns } = header
    const get = (row, field) => (columns[field] === undefined ? null : row[columns[field]])
    const results = []
    for (let i = index + 1; i < rows.length; i++) {
      const row = rows[i]
      if (isBlankRow(row)) continue
      const designation = String(get(row, 'designation') ?? '').trim()
      if (!designation) continue
      if (/^TOTAL\b/i.test(designation)) continue
      const quantite = toNumber(get(row, 'quantite'))
      const prix = toNumber(get(row, 'prix_moyen_ht'))
      let montant = toNumber(get(row, 'montant_ht'))
      if (!montant && quantite && prix) montant = quantite * prix
      results.push({
        reference: String(get(row, 'reference') ?? '').trim(),
        designation,
        quantite,
        prix_moyen_ht: prix,
        montant_ht: montant,
      })
    }
    return results
  }
  throw new Error('Aucun en-tête reconnu (Désignation / Famille de produits) dans le fichier produits finis.')
}

// ---------- Matières premières ----------
const MATIERE_HEADER_MAP = {
  DESIGNATION: 'designation',
  'DÉSIGNATION': 'designation',
  DESIGNATIONS: 'designation',
  'POSITION TARIFAIRE': 'position_tarifaire',
  'POSITION TARIF': 'position_tarifaire',
  'POSITION': 'position_tarifaire',
  UNITE: 'unite',
  'UNITÉ': 'unite',
  UM: 'unite',
  QUANTITE: 'quantite',
  'QUANTITÉ': 'quantite',
  'QUANTITE TOTALE': 'quantite',
  'QUANTITÉ TOTALE': 'quantite',
  QTE: 'quantite',
  'PRIX MOYEN PONDERE': 'prix_moyen',
  'PRIX MOYEN PONDÉRÉ': 'prix_moyen',
  'PRIX UNITAIRE PONDERE': 'prix_moyen',
  'PRIX UNITAIRE PONDÉRÉ': 'prix_moyen',
  'PRIX MOYEN': 'prix_moyen',
  'PRIX UNITAIRE': 'prix_moyen',
  'VALEUR TOTALE': 'valeur_totale',
  VALEUR: 'valeur_totale',
}

// Renvoie la liste des onglets et une fonction pour parser un onglet donné.
export function readProdnetMatieresWorkbook(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  return {
    sheetNames: workbook.SheetNames,
    parseSheet(sheetName) {
      if (!workbook.Sheets[sheetName]) throw new Error(`Onglet « ${sheetName} » introuvable.`)
      const rows = sheetRows(workbook, sheetName)
      const header = findHeader(rows, MATIERE_HEADER_MAP, ['designation'])
      if (!header) {
        throw new Error(`Aucun en-tête reconnu (Désignation) dans l'onglet « ${sheetName} ».`)
      }
      const { index, columns } = header
      const get = (row, field) => (columns[field] === undefined ? null : row[columns[field]])
      const results = []
      for (let i = index + 1; i < rows.length; i++) {
        const row = rows[i]
        if (isBlankRow(row)) continue
        const designation = String(get(row, 'designation') ?? '').trim()
        if (!designation) continue
        if (/^TOTAL\b/i.test(designation)) continue
        const quantite = toNumber(get(row, 'quantite'))
        const prix = toNumber(get(row, 'prix_moyen'))
        let valeur = toNumber(get(row, 'valeur_totale'))
        if (!valeur && quantite && prix) valeur = quantite * prix
        results.push({
          designation,
          position_tarifaire: String(get(row, 'position_tarifaire') ?? '').trim(),
          unite: String(get(row, 'unite') ?? '').trim() || 'U',
          quantite,
          prix_moyen: prix,
          valeur_totale: valeur,
        })
      }
      return results
    },
  }
}
