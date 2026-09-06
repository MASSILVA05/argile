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

// ============================================================
// Produits finis — mapping POSITIONNEL (col A = Référence SANS en-tête).
//   A reference | B designation (Famille de produits) | C quantite
//   D prix_moyen_ht | E montant_ht
// La ligne d'en-tête est celle qui contient « Famille » ou « Désignation » ;
// les données commencent juste en dessous.
// ============================================================
const PRODUCT_COLS = { reference: 0, designation: 1, quantite: 2, prix_moyen_ht: 3, montant_ht: 4 }

function findProductHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (isBlankRow(rows[i])) continue
    const cells = rows[i].map(normalizeHeader)
    if (cells.some((c) => c.includes('FAMILLE') || c.includes('DESIGNATION'))) return i
  }
  // Repli : 1re ligne non vide.
  for (let i = 0; i < rows.length; i++) if (!isBlankRow(rows[i])) return i
  return 0
}

export function parseProdnetProductsFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook, name)
    if (rows.length === 0) continue
    const headerIndex = findProductHeaderIndex(rows)

    const at = (row, pos) => row[pos]
    const results = []
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i]
      if (isBlankRow(row)) continue
      const designation = firstNonBlank(at(row, PRODUCT_COLS.designation))
      if (!designation) continue
      if (/^TOTAL\b/i.test(designation)) continue
      const quantite = toNumber(at(row, PRODUCT_COLS.quantite))
      const prix = toNumber(at(row, PRODUCT_COLS.prix_moyen_ht))
      let montant = toNumber(at(row, PRODUCT_COLS.montant_ht))
      if (!montant && quantite && prix) montant = quantite * prix
      results.push({
        reference: firstNonBlank(at(row, PRODUCT_COLS.reference)),
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
// Matières premières — mapping POSITIONNEL (les en-têtes ne sont PAS fiables :
// « Prix Unitaire Pondéré (DZD) », « Valeur Totale (DZD) », « Prix moyen
// pondéré »… ne matchent aucun libellé standard). On détecte l'onglet par son
// nom et on lit les colonnes par position, en ignorant les en-têtes.
//
//   onglet « MATIERE PREMIERE … » :
//     A designation | B position_tarifaire | C quantite | D prix_moyen | E valeur_totale   (unite = 'U')
//   onglet « STOCK AU … » (ou tout autre) :
//     A designation | B quantite | C unite | D prix_moyen | E valeur_totale               (pas de position tarifaire)
// ============================================================
const MATIERE_LAYOUTS = {
  // onglet MATIERE PREMIERE
  matiere: {
    designation: 0,
    position_tarifaire: 1,
    quantite: 2,
    prix_moyen: 3,
    valeur_totale: 4,
    unite: null,
    defaultUnite: 'U',
  },
  // onglet STOCK AU … (défaut)
  stock: {
    designation: 0,
    quantite: 1,
    unite: 2,
    prix_moyen: 3,
    valeur_totale: 4,
    position_tarifaire: null,
    defaultUnite: null,
  },
}

function pickLayout(sheetName) {
  return /MATIERE\s*PREMIERE/i.test(sheetName) ? MATIERE_LAYOUTS.matiere : MATIERE_LAYOUTS.stock
}

// Onglets + parseur d'un onglet donné (choix par l'utilisateur).
export function readProdnetMatieresWorkbook(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  return {
    sheetNames: workbook.SheetNames,
    parseSheet(sheetName) {
      if (!workbook.Sheets[sheetName]) throw new Error(`Onglet « ${sheetName} » introuvable.`)
      const rows = sheetRows(workbook, sheetName)
      const layout = pickLayout(sheetName)

      // Ligne d'en-tête = 1re ligne non vide (souvent la ligne 1, parfois
      // précédée d'un titre). Les données commencent juste après ; on saute
      // les lignes vides intercalaires.
      let headerIndex = 0
      for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
        if (!isBlankRow(rows[i])) {
          headerIndex = i
          break
        }
      }

      const at = (row, pos) => (pos == null ? null : row[pos])
      const results = []
      for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i]
        if (isBlankRow(row)) continue
        const designation = firstNonBlank(at(row, layout.designation))
        if (!designation) continue
        if (/^TOTAL\b/i.test(designation)) continue
        const quantite = toNumber(at(row, layout.quantite))
        const prix = toNumber(at(row, layout.prix_moyen))
        let valeur = toNumber(at(row, layout.valeur_totale))
        if (!valeur && quantite && prix) valeur = quantite * prix
        results.push({
          designation,
          position_tarifaire: firstNonBlank(at(row, layout.position_tarifaire)),
          unite: firstNonBlank(at(row, layout.unite)) || layout.defaultUnite || 'U',
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
