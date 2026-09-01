import { read, utils, SSF } from 'xlsx'

// Lecture des deux fichiers Excel du magasin Bejaia :
//  - stock  (format "magasin quatre chemin") : Reference, Designation,
//    Marque, Quantite, [Inventaire], Prix Achat, Prix Gros, Prix Detail,
//    Prix Euro, Stock Min, Rayonnage, Code Barre
//  - crédits clients (format "credclie2") : N°, Nom Client, N° Telephone,
//    Chiffre Affaires, Seuil Credit, Dern Operation, Credit
//
// La ligne d'en-tête est détectée par mots-clés (elle n'est pas forcément la
// 1re ligne : les fichiers ont un titre "stock du ..." / "CREDIT CLIENTS"
// au-dessus).

const MAX_HEADER_SCAN_ROWS = 15

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

function toNumber(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function excelSerialToISO(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n <= 0) return null
  const parsed = SSF.parse_date_code(n)
  if (!parsed) return null
  const pad = (x) => String(x).padStart(2, '0')
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`
}

function parseDateCell(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return excelSerialToISO(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = `20${y}`
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

// Cherche la ligne d'en-tête : celle qui contient le plus de colonnes
// reconnues parmi `headerMap`, avec un minimum de `required` colonnes clés.
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

function firstSheetRows(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  const out = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    out.push(utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }))
  }
  return out
}

// ---------- Stock ----------
const STOCK_HEADER_MAP = {
  REFERENCE: 'reference',
  'RÉFÉRENCE': 'reference',
  REF: 'reference',
  DESIGNATION: 'designation',
  'DÉSIGNATION': 'designation',
  MARQUE: 'marque',
  QUANTITE: 'quantite',
  'QUANTITÉ': 'quantite',
  QTE: 'quantite',
  'PRIX ACHAT': 'prix_achat',
  "PRIX D'ACHAT": 'prix_achat',
  'PRIX GROS': 'prix_gros',
  'PRIX DE GROS': 'prix_gros',
  'PRIX DETAIL': 'prix_detail',
  'PRIX DÉTAIL': 'prix_detail',
  'PRIX DE DETAIL': 'prix_detail',
  'PRIX EURO': 'prix_euro',
  'STOCK MIN': 'stock_min',
  'STOCK MINIMUM': 'stock_min',
  RAYONNAGE: 'rayonnage',
  'CODE BARRE': 'code_barre',
  'CODE-BARRE': 'code_barre',
  CODEBARRE: 'code_barre',
}

export function parseMagasinStockFile(arrayBuffer) {
  for (const rows of firstSheetRows(arrayBuffer)) {
    const header = findHeader(rows, STOCK_HEADER_MAP, ['designation', 'quantite'])
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
      results.push({
        reference: String(get(row, 'reference') ?? '').trim(),
        designation,
        marque: String(get(row, 'marque') ?? '').trim(),
        quantite: toNumber(get(row, 'quantite')),
        prix_achat: toNumber(get(row, 'prix_achat')),
        prix_gros: toNumber(get(row, 'prix_gros')),
        prix_detail: toNumber(get(row, 'prix_detail')),
        prix_euro: toNumber(get(row, 'prix_euro')),
        stock_min: toNumber(get(row, 'stock_min')),
        rayonnage: String(get(row, 'rayonnage') ?? '').trim(),
        code_barre: String(get(row, 'code_barre') ?? '').trim(),
      })
    }
    return results
  }
  throw new Error('Aucun en-tête reconnu (Designation / Quantite) trouvé dans le fichier stock.')
}

// ---------- Crédits clients ----------
const CLIENT_HEADER_MAP = {
  'NOM CLIENT': 'name',
  'NOM DU CLIENT': 'name',
  CLIENT: 'name',
  'N° TELEPHONE': 'phone',
  'N TELEPHONE': 'phone',
  TELEPHONE: 'phone',
  'TÉLÉPHONE': 'phone',
  'CHIFFRE AFFAIRES': 'chiffre_affaires',
  "CHIFFRE D'AFFAIRES": 'chiffre_affaires',
  'SEUIL CREDIT': 'seuil_credit',
  'SEUIL CRÉDIT': 'seuil_credit',
  'DERN OPERATION': 'last_operation_date',
  'DERNIERE OPERATION': 'last_operation_date',
  'DERNIÈRE OPÉRATION': 'last_operation_date',
  CREDIT: 'credit',
  'CRÉDIT': 'credit',
}

export function parseMagasinCreditsFile(arrayBuffer) {
  for (const rows of firstSheetRows(arrayBuffer)) {
    const header = findHeader(rows, CLIENT_HEADER_MAP, ['name', 'credit'])
    if (!header) continue
    const { index, columns } = header
    const get = (row, field) => (columns[field] === undefined ? null : row[columns[field]])
    const results = []
    for (let i = index + 1; i < rows.length; i++) {
      const row = rows[i]
      if (isBlankRow(row)) continue
      const name = String(get(row, 'name') ?? '').trim().toUpperCase()
      if (!name) continue
      if (/^TOTAL\b/i.test(name)) continue
      results.push({
        name,
        phone: String(get(row, 'phone') ?? '').trim(),
        chiffre_affaires: toNumber(get(row, 'chiffre_affaires')),
        seuil_credit: toNumber(get(row, 'seuil_credit')),
        credit: toNumber(get(row, 'credit')),
        last_operation_date: parseDateCell(get(row, 'last_operation_date')),
      })
    }
    return results
  }
  throw new Error('Aucun en-tête reconnu (Nom Client / Credit) trouvé dans le fichier crédits.')
}
