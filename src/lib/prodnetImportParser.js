import { read, utils } from 'xlsx'
import { translateUniteLabel } from './prodnet'

// Lecture des fichiers Excel du module Prodnet :
//
//  - produits finis, format V1 (historique) : « LISTE DES PRODUITS
//    FINI.xlsx » -- mapping POSITIONNEL, colonne A sans en-tête :
//      A: Référence (DPR0001…)  B: Famille de produits (désignation)
//      C: Quantité              D: Prix moyen HT        E: Montant HT
//
//  - produits finis, format V2 (nouveau) : « produitfinis_template.xlsx »
//    (export type ERP tiers, en-têtes nommées, PAS de référence) :
//      A: Produit Fini        -> designation (clé de rapprochement)
//      B: Unite                  ignoré (constant sur tout le fichier)
//      C: Prod Quantite          ignoré (cumul de production, pas le stock)
//      D: Prod Valeur          -> prix_moyen_ht
//      E: (sans en-tête, =C*D)   ignoré
//      F: Stock Quantite       -> quantite (stock ACTUEL)
//      G: (sans en-tête, vide)   ignoré
//      H: Stock Valeur         -> montant_ht (repli : F*D si absent)
//      I: Site Production        ignoré
//    Détecté par la présence de l'en-tête « Produit Fini » ; sans quoi on
//    retombe sur le mapping V1 positionnel.
//
//  - matières premières, format V1 (historique) : « STOCK AU
//    31122025.xlsx » — 2 onglets, structures DIFFÉRENTES, l'utilisateur
//    choisit lequel importer :
//
//      onglet « STOCK AU 31122025 » (5 colonnes, PAS de position tarifaire) :
//        A: Désignation  B: Quantité totale  C: Unité
//        D: Prix moyen pondéré  E: Valeur totale
//
//      onglet « MATIERE PREMIERE AU 30062026 » (5 colonnes) :
//        A: Désignation  B: Position Tarifaire  C: Quantité Totale
//        D: Prix Unitaire Pondéré (DZD)  E: Valeur Totale (DZD)
//
//  - matières premières, format V2 (nouveau) : « erreurs_import_template.xlsx »
//    (export type ERP tiers, en-têtes nommées, PAS de position tarifaire,
//    stock scindé Importé/Local) :
//      A: Matiere Premiere    -> designation (clé de rapprochement)
//      B: Unite               -> unite (traduit vers un code court, voir
//                                 translateUniteLabel dans lib/prodnet.js)
//      C-F: Conso Importé/Local Quantité/Valeur   ignorés (pas de colonne
//           de consommation dans le schéma actuel)
//      G: Stock Importé Quantite  ┐
//      I: Stock Local Quantite    ┴-> quantite = G + I
//      H: Stock Importé Valeur    ┐
//      J: Stock Local Valeur      ┴-> valeur_totale = H + J
//                                     prix_moyen = valeur_totale / quantite
//      K: Site Production        ignoré
//    Détecté par la présence de l'en-tête « Matiere Premiere ». Ces lignes
//    sont marquées `format: 'v2'` : n'ayant aucune position tarifaire, elles
//    ne doivent JAMAIS écraser position_tarifaire à l'import (voir
//    ProdnetImport.jsx, qui exclut ce champ du payload UPDATE pour ce format).
//
// L'en-tête n'est pas forcément la 1re ligne (titres au-dessus). Le mapping
// des colonnes V1 est fait par mots-clés d'en-tête AVEC repli positionnel
// selon la structure détectée de l'onglet (nom + en-têtes présentes). Le
// mapping V2 est fait PAR NOM DE COLONNE (position libre), plus robuste.

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
// Détection d'en-tête PAR NOM DE COLONNE (position libre) -- utilisée par
// les formats V2. `resolve(headerNormalisé)` renvoie un nom de champ logique
// ou null ; la ligne d'en-tête retenue est la première (dans les
// MAX_HEADER_SCAN_ROWS premières lignes) où TOUS les champs de
// `requiredFields` sont résolus.
// ============================================================
function findHeaderByName(rows, resolve, requiredFields) {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (isBlankRow(rows[i])) continue
    const columns = {}
    rows[i].forEach((cell, colIndex) => {
      const field = resolve(normalizeHeader(cell))
      if (field && columns[field] === undefined) columns[field] = colIndex
    })
    if (requiredFields.every((f) => columns[f] !== undefined)) return { index: i, columns }
  }
  return null
}

// ============================================================
// Produits finis — format V2 : en-têtes nommées, colonnes en position libre.
// Voir le détail du mapping dans le commentaire d'en-tête du fichier.
// ============================================================
function resolveProductV2(h) {
  if (!h) return null
  if (h === 'PRODUIT FINI') return 'designation'
  if (h === 'PROD VALEUR') return 'prod_valeur'
  if (h === 'STOCK QUANTITE') return 'stock_quantite'
  if (h === 'STOCK VALEUR') return 'stock_valeur'
  return null
}

function parseProductsV2(rows, header) {
  const { index, columns } = header
  const get = (row, f) => (columns[f] === undefined ? null : row[columns[f]])
  const results = []
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const designation = firstNonBlank(get(row, 'designation'))
    if (!designation) continue
    if (/^TOTAL\b/i.test(designation)) continue
    const quantite = toNumber(get(row, 'stock_quantite'))
    const prix = toNumber(get(row, 'prod_valeur'))
    let montant = toNumber(get(row, 'stock_valeur'))
    if (!montant && quantite && prix) montant = quantite * prix
    results.push({
      reference: '',
      designation,
      quantite,
      prix_moyen_ht: prix,
      montant_ht: montant,
    })
  }
  return results
}

// ============================================================
// Produits finis — mapping POSITIONNEL V1 (col A = Référence SANS en-tête).
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

function parseProductsV1(rows) {
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
  return results
}

export function parseProdnetProductsFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })

  // Format V2 (en-tête nommée « Produit Fini ») : essayé en premier sur
  // chaque onglet, sans quoi le mapping positionnel V1 pourrait mal
  // interpréter ses colonnes (voir commentaire d'en-tête du fichier).
  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook, name)
    if (rows.length === 0) continue
    const header = findHeaderByName(rows, resolveProductV2, ['designation', 'stock_quantite'])
    if (!header) continue
    const results = parseProductsV2(rows, header)
    if (results.length > 0) return results
  }

  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook, name)
    if (rows.length === 0) continue
    const results = parseProductsV1(rows)
    if (results.length > 0) return results
  }
  throw new Error("Aucune donnée reconnue dans le fichier produits finis (attendu : Référence, Famille de produits, Quantité, Prix moyen HT, Montant HT -- ou, format V2, Produit Fini, Stock Quantite, Prod Valeur, Stock Valeur).")
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

function parseMatieresV1(rows, sheetName) {
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
      format: 'v1',
    })
  }
  return results
}

// ============================================================
// Matières premières — format V2 : en-têtes nommées, colonnes en position
// libre, stock scindé Importé/Local (voir commentaire d'en-tête du fichier).
// Pas de position tarifaire dans ce format -- `format: 'v2'` sur chaque
// ligne indique à ProdnetImport.jsx de ne jamais écraser ce champ à l'import.
// ============================================================
function resolveMatiereV2(h) {
  if (!h) return null
  if (h === 'MATIERE PREMIERE') return 'designation'
  if (h === 'UNITE') return 'unite'
  if (h === 'STOCK IMPORTE QUANTITE') return 'stock_imp_qte'
  if (h === 'STOCK IMPORTE VALEUR') return 'stock_imp_val'
  if (h === 'STOCK LOCAL QUANTITE') return 'stock_loc_qte'
  if (h === 'STOCK LOCAL VALEUR') return 'stock_loc_val'
  return null
}

function parseMatieresV2(rows, header) {
  const { index, columns } = header
  const get = (row, f) => (columns[f] === undefined ? null : row[columns[f]])
  const results = []
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const designation = firstNonBlank(get(row, 'designation'))
    if (!designation) continue
    if (/^TOTAL\b/i.test(designation)) continue
    const quantite = toNumber(get(row, 'stock_imp_qte')) + toNumber(get(row, 'stock_loc_qte'))
    const valeur = toNumber(get(row, 'stock_imp_val')) + toNumber(get(row, 'stock_loc_val'))
    const prix = quantite > 0 ? valeur / quantite : 0
    results.push({
      designation,
      position_tarifaire: '',
      unite: translateUniteLabel(get(row, 'unite')),
      quantite,
      prix_moyen: prix,
      valeur_totale: valeur,
      format: 'v2',
    })
  }
  return results
}

// Onglets + parseur d'un onglet donné (choix par l'utilisateur).
export function readProdnetMatieresWorkbook(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  return {
    sheetNames: workbook.SheetNames,
    parseSheet(sheetName) {
      if (!workbook.Sheets[sheetName]) throw new Error(`Onglet « ${sheetName} » introuvable.`)
      const rows = sheetRows(workbook, sheetName)

      // Format V2 (en-tête nommée « Matiere Premiere ») essayé en premier :
      // sans cette détection, le mapping positionnel V1 lirait ses colonnes
      // Conso/Stock Importé/Local n'importe comment (voir en-tête du fichier).
      const headerV2 = findHeaderByName(rows, resolveMatiereV2, ['designation', 'stock_imp_qte'])
      const results = headerV2 ? parseMatieresV2(rows, headerV2) : parseMatieresV1(rows, sheetName)

      if (results.length === 0) {
        throw new Error(`Aucune ligne exploitable dans l'onglet « ${sheetName} ».`)
      }
      return results
    },
  }
}
