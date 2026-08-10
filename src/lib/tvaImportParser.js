import { read, utils, SSF } from 'xlsx'
import { PAYMENT_MODES } from './tvaPayment'

// Correspondance en-tête de colonne (normalisé) -> champ tva_entries. Les
// colonnes calculées du fichier (HT NET, TOTAL TTC, TOTAL NET) ne sont pas
// importées : elles sont recalculées côté base (colonnes générées).
const HEADER_MAP = {
  'N° FACT': 'invoice_number',
  'N FACT': 'invoice_number',
  'NUMERO FACTURE': 'invoice_number',
  'N° PIECE': 'piece_number',
  'DATE': 'entry_date',
  'NOM DE FOURNISSEUR': 'supplier_name',
  'FOURNISSEUR': 'supplier_name',
  'ADRESSE DE FOURNISSEUR': 'supplier_address',
  'ADRESSE': 'supplier_address',
  'NIF': 'nif',
  'NIS': 'nis',
  'ARTICLE': 'article',
  'N° RC': 'rc_number',
  'RC': 'rc_number',
  'TELEPHONE': 'phone',
  'TOTAL HT': 'total_ht',
  'REMISE': 'discount_amount',
  'TVA': 'tva_amount',
  'DD': 'dd_amount',
  'TIMBRE': 'stamp_duty',
  'MODE DE PAIEMENT': 'payment_mode',
  'PIECE DE REGLEMENT': 'payment_piece',
}

const MAX_HEADER_SCAN_ROWS = 20

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

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
  const match = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (match) {
    const [, d, m, y] = match
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function normalizePaymentMode(value) {
  const str = String(value ?? '').trim()
  if (!str) return 'Non payé'
  const match = PAYMENT_MODES.find((m) => m.toLowerCase() === str.toLowerCase())
  return match ?? 'Non payé'
}

// Cherche, dans les MAX_HEADER_SCAN_ROWS premières lignes, celle qui
// contient le plus de colonnes reconnues (au moins "N° FACT"/"FOURNISSEUR"
// et "TOTAL HT" ou "TVA") -- reste robuste si la mise en page exacte varie
// (ligne d'en-tête à un index différent, colonnes réordonnées).
function findHeaderRow(rows) {
  let best = { index: -1, columns: null, score: 0 }
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const columns = {}
    let score = 0
    row.forEach((cell, colIndex) => {
      const key = normalizeHeader(cell)
      const field = HEADER_MAP[key]
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

function parseNullableNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Lit un fichier .xls/.xlsx (ArrayBuffer) et renvoie la liste des factures
// détectées, prêtes à l'aperçu/import dans TVAImportTab. Le mois de
// récupération TVA (absent du fichier source) reste vide -- à compléter
// plus tard depuis le registre. Total HT reste vide si absent (cas des
// quittances douane, qui n'ont pas de montant HT, seule la TVA douanière
// étant saisie).
export function parseTvaImportFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  const found = findSheetWithHeader(workbook)
  if (!found) {
    throw new Error('Aucun en-tête reconnu (N° FACT / FOURNISSEUR / TOTAL HT) trouvé dans le fichier.')
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
    if (/^TOTAL\b/i.test(invoiceNumber)) continue

    const entryDate = parseDateCell(get('entry_date')) ?? new Date().toISOString().slice(0, 10)

    const supplierName = String(get('supplier_name') ?? '').trim()
    if (!supplierName) continue

    results.push({
      invoice_number: invoiceNumber,
      piece_number: String(get('piece_number') ?? '').trim() || null,
      entry_date: entryDate,
      recovery_month: null,
      recovery_year: null,
      supplier_name: supplierName,
      supplier_address: String(get('supplier_address') ?? '').trim() || null,
      nif: String(get('nif') ?? '').trim() || null,
      nis: String(get('nis') ?? '').trim() || null,
      article: String(get('article') ?? '').trim() || null,
      rc_number: String(get('rc_number') ?? '').trim() || null,
      phone: String(get('phone') ?? '').trim() || null,
      total_ht: parseNullableNumber(get('total_ht')),
      discount_amount: Number(get('discount_amount')) || 0,
      tva_amount: Number(get('tva_amount')) || 0,
      dd_amount: Number(get('dd_amount')) || 0,
      stamp_duty: Number(get('stamp_duty')) || 0,
      payment_mode: normalizePaymentMode(get('payment_mode')),
      payment_piece: String(get('payment_piece') ?? '').trim() || null,
    })
  }
  return results
}
