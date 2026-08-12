import { read, utils, SSF } from 'xlsx'

// Correspondance en-tête de colonne (normalisé) -> champ tva_payer_entries.
// Total TVA/Total TTC/Total net ne sont pas importés : ce sont des colonnes
// générées côté base, recalculées automatiquement depuis Total HT/Remise/
// Timbre (la formule est identique à celle du fichier source).
const HEADER_MAP = {
  'NUMÉRO': 'invoice_number',
  'NUMERO': 'invoice_number',
  'DU': 'entry_date',
  'CLIENT': 'client_name',
  'TOTAL HT': 'total_ht',
  'REMISE': 'discount_amount',
  'TIMBRE': 'stamp_duty',
  'RÉF. COMMANDE': 'ref_commande',
  'REF. COMMANDE': 'ref_commande',
  'RÉF COMMANDE': 'ref_commande',
  'RÉF. LIVRAISON': 'ref_livraison',
  'REF. LIVRAISON': 'ref_livraison',
  'RÉF LIVRAISON': 'ref_livraison',
}

const MAX_HEADER_SCAN_ROWS = 10

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
  const slash = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (slash) {
    let [, a, b, y] = slash
    if (y.length === 2) y = `20${y}`
    // Le fichier source affiche les dates en M/D/YY (ex: "6/1/26").
    return `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`
  }
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

// Cherche, dans les MAX_HEADER_SCAN_ROWS premières lignes, celle qui
// contient le plus de colonnes reconnues (au moins "Numéro" et "Total HT")
// -- reste robuste si la mise en page exacte varie légèrement.
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

// Lit un fichier "Etat Relevé Facture de Ventes" (.xls/.xlsx, ArrayBuffer)
// et renvoie la liste des factures détectées, prêtes à l'aperçu/import.
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
    // Ligne de totaux du fichier source : "Nombre de lignes :".
    if (/^nombre de lignes/i.test(invoiceNumber)) continue

    const clientName = String(get('client_name') ?? '').trim()
    if (!clientName) continue

    const entryDate = parseDateCell(get('entry_date')) ?? new Date().toISOString().slice(0, 10)
    const stampDuty = Number(get('stamp_duty')) || 0

    results.push({
      invoice_number: invoiceNumber,
      entry_date: entryDate,
      client_name: clientName,
      total_ht: Number(get('total_ht')) || 0,
      discount_amount: Number(get('discount_amount')) || 0,
      stamp_duty: stampDuty,
      // Timbre > 0 -> facture considérée réglée en espèces (voir TVAPayerForm).
      payment_mode: stampDuty > 0 ? 'Espèces' : 'Non payé',
      ref_commande: String(get('ref_commande') ?? '').trim() || null,
      ref_livraison: String(get('ref_livraison') ?? '').trim() || null,
    })
  }
  return results
}
