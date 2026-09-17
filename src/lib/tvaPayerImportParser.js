import { read, utils, SSF } from 'xlsx'
import { ENTITIES } from './tvaPayment'

// Correspondance en-tête de colonne -> champ tva_payer_entries. Clés écrites
// en français lisible (accents compris) ; la comparaison réelle se fait
// après normalisation (accents/majuscules/parenthèses/ponctuation retirés,
// voir normalizeHeader) sur NORMALIZED_HEADER_MAP plus bas -- couvre aussi
// bien le format source externe "Etat Relevé Facture de Ventes" que l'export
// tvaPayerExcel.js ré-importé tel quel. Total TVA/Total TTC/Total net ne
// sont pas importés : colonnes générées côté base.
const HEADER_MAP = {
  'Numéro': 'invoice_number',
  'Numéro de facture': 'invoice_number',
  'N° Facture': 'invoice_number',
  'Entité': 'entity',
  'Du': 'entry_date',
  'Date': 'entry_date',
  'Client': 'client_name',
  'Total HT': 'total_ht',
  'Remise': 'discount_amount',
  'Timbre': 'stamp_duty',
  'Réf. Commande': 'ref_commande',
  'Réf Commande': 'ref_commande',
  'Réf. Livraison': 'ref_livraison',
  'Réf Livraison': 'ref_livraison',
}

function stripAccents(str) {
  return String(str ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeHeader(value) {
  return stripAccents(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
}

const NORMALIZED_HEADER_MAP = Object.fromEntries(
  Object.entries(HEADER_MAP).map(([k, v]) => [normalizeHeader(k), v])
)

const MAX_HEADER_SCAN_ROWS = 10

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

function excelSerialToISO(serial) {
  if (serial == null || Number.isNaN(Number(serial))) return null
  const { y, m, d } = SSF.parse_date_code(Number(serial))
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

function parseDateCell(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return excelSerialToISO(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  // Le fichier source externe affiche les dates en M/D/YY (ex: "6/1/26") ;
  // l'export tvaPayerExcel.js les écrit en DD/MM/YYYY (ex: "01/06/2026").
  // On tente d'abord DD/MM/YYYY (4 chiffres d'année = format export), sinon
  // on retombe sur M/D/YY (année à 2 chiffres = format source externe).
  const long = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (long) {
    const [, d, m, y] = long
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const short = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/)
  if (short) {
    const [, mo, d, y] = short
    return `20${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function parseEntity(value) {
  const str = String(value ?? '').trim()
  return ENTITIES.find((e) => e.toLowerCase() === str.toLowerCase()) ?? null
}

// Cherche, dans les MAX_HEADER_SCAN_ROWS premières lignes, celle qui
// contient le plus de colonnes reconnues (au moins "Numéro" et "Total HT").
function findHeaderRow(rows) {
  let best = { index: -1, columns: null, score: 0 }
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const columns = {}
    let score = 0
    row.forEach((cell, colIndex) => {
      const field = NORMALIZED_HEADER_MAP[normalizeHeader(cell)]
      if (field && columns[field] === undefined) {
        columns[field] = colIndex
        score += 1
      }
    })
    if (columns.invoice_number !== undefined && columns.total_ht !== undefined && score > best.score) {
      best = { index: i, columns, score }
    }
  }
  return best.index === -1 ? null : best
}

function findSheetWithHeader(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
    const header = findHeaderRow(rows)
    if (header) return { rows, ...header }
  }
  return null
}

// Lit un fichier .xls/.xlsx (ArrayBuffer) -- export tvaPayerExcel.js
// ré-importé tel quel, ou fichier source externe "Etat Relevé Facture de
// Ventes" -- et renvoie la liste des factures détectées. `entity` reste null
// si la colonne est absente/non reconnue (résolu dans TVAPayerImportTab
// avec l'entité sélectionnée sur la page). Le statut de paiement n'est pas
// dans ce fichier : jamais déterminé ici, voir TVAPayerImportTab pour la
// valeur par défaut appliquée uniquement aux nouvelles factures.
export function parseTvaPayerImportFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  const found = findSheetWithHeader(workbook)
  if (!found) {
    throw new Error('Aucun en-tête reconnu (Numéro / Total HT) trouvé dans le fichier.')
  }
  const { rows, index, columns } = found

  const results = []
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue

    const get = (field) => {
      const colIndex = columns[field]
      return colIndex === undefined ? null : row[colIndex]
    }

    const rawInvoiceNumber = get('invoice_number')
    if (rawInvoiceNumber == null || String(rawInvoiceNumber).trim() === '') continue
    const invoiceNumber = String(rawInvoiceNumber).trim()
    // Ligne de totaux (fichier source externe : "Nombre de lignes :").
    if (/^nombre de lignes/i.test(invoiceNumber)) continue
    if (/^TOTAL\b/i.test(invoiceNumber)) continue

    const clientName = String(get('client_name') ?? '').trim()
    if (!clientName) continue

    const entryDate = parseDateCell(get('entry_date')) ?? new Date().toISOString().slice(0, 10)

    results.push({
      invoice_number: invoiceNumber,
      entity: parseEntity(get('entity')),
      entry_date: entryDate,
      client_name: clientName,
      total_ht: Number(get('total_ht')) || 0,
      discount_amount: Number(get('discount_amount')) || 0,
      stamp_duty: Number(get('stamp_duty')) || 0,
      ref_commande: String(get('ref_commande') ?? '').trim() || null,
      ref_livraison: String(get('ref_livraison') ?? '').trim() || null,
    })
  }
  return results
}
