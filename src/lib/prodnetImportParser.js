import { read, utils } from 'xlsx'

// Lecture des fichiers Excel du module Prodnet :
//
//  - produits finis : « LISTE DES PRODUITS FINI.xlsx »
//      colonne A (sans en-tête) : Référence (DPR0001…)
//      B: Famille de produits (désignation)  C: Quantité
//      D: Prix moyen HT                      E: Montant HT
//
//  - matières premières : « STOCK AU 31122025.xlsx » — 2 onglets, structures
//    DIFFÉRENTES, l'utilisateur choisit lequel importer :
//
//      onglet « STOCK AU 31122025 » (5 colonnes, PAS de position tarifaire) :
//        A: Désignation  B: Quantité totale  C: Unité
//        D: Prix moyen pondéré  E: Valeur totale
//
//      onglet « MATIERE PREMIERE AU 30062026 » (5 colonnes) :
//        A: Désignation  B: Position Tarifaire  C: Quantité Totale
//        D: Prix Unitaire Pondéré (DZD)  E: Valeur Totale (DZD)
//
// L'en-tête n'est pas forcément la 1re ligne (titres au-dessus). Le mapping
// des colonnes est fait par mots-clés d'en-tête AVEC repli positionnel selon
// la structure détectée de l'onglet (nom + en-têtes présentes).

const MAX_HEADER_SCAN_ROWS = 25

// Normalise un libellé d'en-tête : sans accents, majuscules, sans le contenu
// entre parenthèses (« (DZD) »…), espaces compactés.
function stripAccents(str) {
  return String(str ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeHeader(value) {
  return stripAccents(value)
    .replace(/\([^)]*\)/g, ' ') // supprime « (DZD) », « (DA) »…
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
}

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

// Extraction numérique tolérante : accepte les nombres bruts d'Excel comme les
// chaînes « 1 234,56 » / « 1234.56 » / « 12 345 ».
function toNumber(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  let s = String(value).trim().replace(/\s| /g, '')
  // Si des virgules ET des points : le dernier séparateur est le décimal.
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function firstNonBlank(str) {
  return String(str ?? '').trim()
}

function sheetRows(workbook, sheetName) {
  return utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null })
}

// Trouve la ligne d'en-tête (celle qui contient le plus de mots-clés connus)
// et renvoie { index, headerCells (normalisées), columns par mot-clé }.
function detectHeader(rows, keywordMap) {
  let best = { index: -1, score: 0, headerCells: [], columns: {} }
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const headerCells = row.map(normalizeHeader)
    const columns = {}
    let score = 0
    headerCells.forEach((cell, colIndex) => {
      const field = keywordMap[cell]
      if (field && columns[field] === undefined) {
        columns[field] = colIndex
        score += 1
      }
    })
    if (score > best.score) best = { index: i, score, headerCells, columns }
  }
  return best.index === -1 ? null : best
}

// ============================================================
// Produits finis
// ============================================================
const PRODUCT_KEYWORDS = {
  REFERENCE: 'reference',
  REF: 'reference',
  CODE: 'reference',
  'CODE ARTICLE': 'reference',
  'FAMILLE DE PRODUITS': 'designation',
  'FAMILLE DE PRODUIT': 'designation',
  FAMILLE: 'designation',
  DESIGNATION: 'designation',
  'PRODUIT FINI': 'designation',
  PRODUIT: 'designation',
  QUANTITE: 'quantite',
  'QUANTITE TOTALE': 'quantite',
  QTE: 'quantite',
  STOCK: 'quantite',
  'PRIX MOYEN HT': 'prix_moyen_ht',
  'PRIX MOYEN': 'prix_moyen_ht',
  'PRIX MOYEN PONDERE': 'prix_moyen_ht',
  'PRIX UNITAIRE': 'prix_moyen_ht',
  'MONTANT HT': 'montant_ht',
  MONTANT: 'montant_ht',
  'VALEUR HT': 'montant_ht',
  'VALEUR TOTALE': 'montant_ht',
}

export function parseProdnetProductsFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook, name)
    const header = detectHeader(rows, PRODUCT_KEYWORDS)
    if (!header || header.columns.designation === undefined) continue

    const col = { ...header.columns }
    // La référence est souvent dans une colonne sans en-tête, juste avant la
    // désignation (colonne A). Repli si non détectée par mot-clé.
    if (col.reference === undefined && col.designation > 0) col.reference = col.designation - 1

    const get = (row, field) => (col[field] === undefined ? null : row[col[field]])
    const results = []
    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i]
      if (isBlankRow(row)) continue
      const designation = firstNonBlank(get(row, 'designation'))
      if (!designation) continue
      if (/^TOTAL\b/i.test(designation)) continue
      const quantite = toNumber(get(row, 'quantite'))
      const prix = toNumber(get(row, 'prix_moyen_ht'))
      let montant = toNumber(get(row, 'montant_ht'))
      if (!montant && quantite && prix) montant = quantite * prix
      results.push({
        reference: firstNonBlank(get(row, 'reference')),
        designation,
        quantite,
        prix_moyen_ht: prix,
        montant_ht: montant,
      })
    }
    if (results.length > 0) return results
  }
  throw new Error("Aucune donnée reconnue dans le fichier produits finis (attendu : Référence, Famille de produits, Quantité, Prix moyen HT, Montant HT).")
}

// ============================================================
// Matières premières — 2 structures d'onglet distinctes
// ============================================================
const MATIERE_KEYWORDS = {
  DESIGNATION: 'designation',
  DESIGNATIONS: 'designation',
  ARTICLE: 'designation',
  'POSITION TARIFAIRE': 'position_tarifaire',
  'POSITION TARIF': 'position_tarifaire',
  POSITION: 'position_tarifaire',
  'NOMENCLATURE': 'position_tarifaire',
  UNITE: 'unite',
  UM: 'unite',
  'UNITE DE MESURE': 'unite',
  QUANTITE: 'quantite',
  'QUANTITE TOTALE': 'quantite',
  QTE: 'quantite',
  'PRIX MOYEN PONDERE': 'prix_moyen',
  'PRIX UNITAIRE PONDERE': 'prix_moyen',
  'PRIX MOYEN': 'prix_moyen',
  'PRIX UNITAIRE': 'prix_moyen',
  'PRIX PONDERE': 'prix_moyen',
  'VALEUR TOTALE': 'valeur_totale',
  VALEUR: 'valeur_totale',
  'VALEUR STOCK': 'valeur_totale',
}

// Structures connues des 2 onglets (repli positionnel si l'en-tête d'une
// colonne numérique n'est pas reconnue).
const MATIERE_LAYOUTS = [
  {
    id: 'stock',
    // onglet « STOCK AU 31122025 » : A désignation, B qté, C unité,
    // D prix moyen, E valeur totale — PAS de position tarifaire.
    matches: (sheetName, headerCells) =>
      /STOCK/i.test(sheetName) ||
      (headerCells.includes('UNITE') && !headerCells.includes('POSITION TARIFAIRE')),
    positions: { designation: 0, quantite: 1, unite: 2, prix_moyen: 3, valeur_totale: 4 },
    defaultUnite: null,
  },
  {
    id: 'matiere',
    // onglet « MATIERE PREMIERE AU 30062026 » : A désignation,
    // B position tarifaire, C qté, D prix unitaire pondéré, E valeur totale.
    matches: (sheetName, headerCells) =>
      /MATIERE\s*PREMIERE/i.test(sheetName) || headerCells.includes('POSITION TARIFAIRE'),
    positions: { designation: 0, position_tarifaire: 1, quantite: 2, prix_moyen: 3, valeur_totale: 4 },
    defaultUnite: 'U',
  },
]

// Onglets + parseur d'un onglet donné (choix par l'utilisateur).
export function readProdnetMatieresWorkbook(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  return {
    sheetNames: workbook.SheetNames,
    parseSheet(sheetName) {
      if (!workbook.Sheets[sheetName]) throw new Error(`Onglet « ${sheetName} » introuvable.`)
      const rows = sheetRows(workbook, sheetName)

      const header = detectHeader(rows, MATIERE_KEYWORDS)
      const headerCells = header?.headerCells ?? []
      const layout =
        MATIERE_LAYOUTS.find((l) => l.matches(sheetName, headerCells)) ??
        MATIERE_LAYOUTS[headerCells.includes('POSITION TARIFAIRE') ? 1 : 0]

      // Colonnes : mot-clé détecté prioritaire, sinon position connue de la
      // structure. Garantit prix_moyen / valeur_totale même si l'en-tête
      // porte un suffixe « (DZD) » non reconnu.
      const col = { ...layout.positions, ...(header?.columns ?? {}) }
      const headerIndex = header ? header.index : firstDataHeaderIndex(rows)

      const get = (row, field) => (col[field] === undefined ? null : row[col[field]])
      const results = []
      for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i]
        if (isBlankRow(row)) continue
        const designation = firstNonBlank(get(row, 'designation'))
        if (!designation) continue
        if (/^TOTAL\b/i.test(designation)) continue
        const quantite = toNumber(get(row, 'quantite'))
        const prix = toNumber(get(row, 'prix_moyen'))
        let valeur = toNumber(get(row, 'valeur_totale'))
        if (!valeur && quantite && prix) valeur = quantite * prix
        results.push({
          designation,
          position_tarifaire: firstNonBlank(get(row, 'position_tarifaire')),
          unite: firstNonBlank(get(row, 'unite')) || layout.defaultUnite || 'U',
          quantite,
          prix_moyen: prix,
          valeur_totale: valeur,
        })
      }
      if (results.length === 0) {
        throw new Error(`Aucune ligne exploitable dans l'onglet « ${sheetName} ».`)
      }
      return results
    },
  }
}

function firstDataHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (!isBlankRow(rows[i])) return i
  }
  return 0
}
