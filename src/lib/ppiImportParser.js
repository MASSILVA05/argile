import { read, utils } from 'xlsx'
import { ORIGIN_AR_TO_FR } from './ppi'

// Lecture du fichier « S2 PPI ACORDER.xlsx » (programme prévisionnel
// d'importation). Colonnes (mapping POSITIONNEL -- les en-têtes fusionnées
// « ORIGINE » / « TOTAL PAR PAYS » ne sont pas fiables) :
//
//   A: N°  B: Chapitre  C: Position tarifaire  D: Désignation
//   E: Stock actuel  F: Qté en cours  G: Quantité (autorisée)  H: Unité
//   I: Prix unitaire (€)  J: Origine (arabe)  K: (doublon Origine, ignoré)
//   L: Sous-total  M: Total par pays (ignoré -- les plafonds pays viennent
//      des lignes ppi_countries seedées en base, pas de ce fichier)
//
// La ligne d'en-tête n'est pas forcément la 1re (padding au-dessus possible).
// NOTE : position_tarifaire n'est PAS unique dans ce fichier (plusieurs
// désignations peuvent partager le même code) -- le rapprochement à l'import
// se fait sur (position_tarifaire, désignation), voir PPIImport.jsx.

const MAX_HEADER_SCAN_ROWS = 10
const COLS = {
  numero: 0,
  chapitre: 1,
  position_tarifaire: 2,
  designation: 3,
  stock_actuel: 4,
  qte_en_cours: 5,
  quantite_autorisee: 6,
  unite: 7,
  prix_unitaire: 8,
  origine: 9,
  sous_total: 11,
}

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

function firstNonBlank(value) {
  return String(value ?? '').trim()
}

function toNumber(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  let s = String(value).trim().replace(/\s| /g, '')
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function findHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (isBlankRow(rows[i])) continue
    const cells = rows[i].map((c) => String(c ?? '').toUpperCase())
    if (cells.some((c) => c.includes('DESIGNATION') || c.includes('POSITION TARIFAIRE') || c.includes('QUANTITER'))) {
      return i
    }
  }
  for (let i = 0; i < rows.length; i++) if (!isBlankRow(rows[i])) return i
  return 0
}

export function parsePpiFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  for (const name of workbook.SheetNames) {
    const rows = utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null })
    if (rows.length === 0) continue
    const headerIndex = findHeaderIndex(rows)

    const at = (row, key) => row[COLS[key]]
    const results = []
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i]
      if (isBlankRow(row)) continue
      const designation = firstNonBlank(at(row, 'designation'))
      const positionTarifaire = firstNonBlank(at(row, 'position_tarifaire'))
      if (!designation || !positionTarifaire) continue
      if (/^TOTAL\b/i.test(designation)) continue

      const originAr = firstNonBlank(at(row, 'origine'))
      const countryFr = ORIGIN_AR_TO_FR[originAr] || ''
      const quantiteAutorisee = toNumber(at(row, 'quantite_autorisee'))
      const prixUnitaire = toNumber(at(row, 'prix_unitaire'))
      let sousTotal = toNumber(at(row, 'sous_total'))
      if (!sousTotal && quantiteAutorisee && prixUnitaire) sousTotal = quantiteAutorisee * prixUnitaire

      results.push({
        numero: at(row, 'numero') != null ? Math.trunc(toNumber(at(row, 'numero'))) : null,
        chapitre: firstNonBlank(at(row, 'chapitre')),
        position_tarifaire: positionTarifaire,
        designation,
        stock_actuel: toNumber(at(row, 'stock_actuel')),
        qte_en_cours: toNumber(at(row, 'qte_en_cours')),
        quantite_autorisee: Math.trunc(quantiteAutorisee),
        unite: firstNonBlank(at(row, 'unite')) || 'U',
        prix_unitaire: prixUnitaire,
        sous_total: sousTotal,
        origin_ar: originAr,
        country_name_fr: countryFr,
      })
    }
    if (results.length > 0) return results
  }
  throw new Error(
    "Aucune donnée reconnue dans le fichier PPI (attendu : N°, Position tarifaire, Désignation, Stock, Qté en cours, Quantité, Unité, Prix U., Origine, Sous-total)."
  )
}
