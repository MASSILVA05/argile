import { read, utils, SSF } from 'xlsx'
import { MONTHS, ENTITIES } from './tvaPayment'

// Correspondance en-tête de colonne -> champ tva_entries. Les clés ci-dessous
// sont écrites en français lisible (accents compris) ; la comparaison réelle
// se fait après normalisation (accents/majuscules/parenthèses/ponctuation
// retirés, voir normalizeHeader) sur NORMALIZED_HEADER_MAP plus bas -- donc
// "Total HT (DA)" (en-tête de l'export tvaExcel.js) matche bien la clé
// "Total HT" ci-dessous. Les colonnes calculées de l'export (HT Net, TTC,
// Total Net) ne sont pas importées : ce sont des colonnes générées côté
// base. Idem pour "Saisie le" (horodatage serveur).
//
// Colonnes de suivi de paiement (Paiement, Montant payé, Reste à payer,
// Saisi par) : reconnues pour affichage informatif dans l'aperçu UNIQUEMENT
// -- jamais écrites, pour ne pas écraser un paiement partiel déjà enregistré
// (voir tva_record_payment / TVARegistry.jsx). C'est TVAImportTab.jsx qui
// construit le payload d'écriture et exclut ces champs.
const HEADER_MAP = {
  'N° Facture': 'invoice_number',
  'N° FACT': 'invoice_number',
  'N FACT': 'invoice_number',
  'Numéro Facture': 'invoice_number',
  'Numéro de facture': 'invoice_number',
  'Entité': 'entity',
  'N° Pièce': 'piece_number',
  'Date': 'entry_date',
  'Mois récup.': 'recovery_label',
  'Mois de récupération': 'recovery_label',
  'Mois de récupération TVA': 'recovery_label',
  'Nom de fournisseur': 'supplier_name',
  'Fournisseur': 'supplier_name',
  'Adresse de fournisseur': 'supplier_address',
  'Adresse': 'supplier_address',
  'NIF': 'nif',
  'NIS': 'nis',
  'Article': 'article',
  'N° RC': 'rc_number',
  'RC': 'rc_number',
  'Téléphone': 'phone',
  'Total HT': 'total_ht',
  'Remise': 'discount_amount',
  'TVA': 'tva_amount',
  'DD': 'dd_amount',
  'Timbre': 'stamp_duty',
  'Paiement': 'payment_mode_info',
  'Mode de paiement': 'payment_mode_info',
  'Statut de paiement': 'payment_mode_info',
  'Montant payé': 'montant_paye_info',
  'Reste à payer': 'reste_a_payer_info',
  'Pièce de règlement': 'payment_piece',
  'Observations': 'observations',
  'Saisi par': 'entered_by_info',
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

const MAX_HEADER_SCAN_ROWS = 20

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

// "Janvier 2026" -> { recovery_month: 1, recovery_year: 2026 } ; vide/"—"/
// non reconnu -> { recovery_month: null, recovery_year: null }.
function parseRecoveryLabel(value) {
  const str = String(value ?? '').trim()
  const match = str.match(/^(\D+?)\s+(\d{4})$/)
  if (!match) return { recovery_month: null, recovery_year: null }
  const [, namePart, yearPart] = match
  const monthName = stripAccents(namePart).trim().toUpperCase()
  const idx = MONTHS.findIndex((m) => stripAccents(m).toUpperCase() === monthName)
  if (idx === -1) return { recovery_month: null, recovery_year: null }
  return { recovery_month: idx + 1, recovery_year: Number(yearPart) }
}

function parseEntity(value) {
  const str = String(value ?? '').trim()
  return ENTITIES.find((e) => e.toLowerCase() === str.toLowerCase()) ?? null
}

function parseNullableNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Cherche, dans les MAX_HEADER_SCAN_ROWS premières lignes, celle qui
// contient le plus de colonnes reconnues (au moins "N° Facture" et
// "Total HT") -- reste robuste si la mise en page varie (en-tête pas sur la
// 1re ligne, colonnes réordonnées, format d'origine externe ou export
// tvaExcel.js ré-importé tel quel).
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

// Lit un fichier .xls/.xlsx (ArrayBuffer) -- que ce soit un export tvaExcel.js
// ré-importé tel quel ou un fichier externe compatible -- et renvoie la
// liste des factures détectées, prêtes à l'aperçu/import dans TVAImportTab.
// `entity`/`recovery_month`/`recovery_year` restent null quand la colonne
// est absente ou non reconnue (à compléter/choisir dans TVAImportTab pour
// l'entité, ou plus tard depuis le registre pour le mois de récupération).
// `payment_mode_info`/`montant_paye_info`/`reste_a_payer_info`/
// `entered_by_info` sont purement informatifs (aperçu) -- jamais écrits.
export function parseTvaImportFile(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  const found = findSheetWithHeader(workbook)
  if (!found) {
    throw new Error('Aucun en-tête reconnu (N° Facture / Fournisseur / Total HT) trouvé dans le fichier.')
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

    const { recovery_month, recovery_year } = parseRecoveryLabel(get('recovery_label'))

    results.push({
      invoice_number: invoiceNumber,
      entity: parseEntity(get('entity')),
      piece_number: String(get('piece_number') ?? '').trim() || null,
      entry_date: entryDate,
      recovery_month,
      recovery_year,
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
      payment_piece: String(get('payment_piece') ?? '').trim() || null,
      observations: String(get('observations') ?? '').trim() || null,
      // Informatif uniquement (voir en-tête du fichier) -- jamais écrit.
      payment_mode_info: String(get('payment_mode_info') ?? '').trim() || null,
      montant_paye_info: parseNullableNumber(get('montant_paye_info')),
      reste_a_payer_info: parseNullableNumber(get('reste_a_payer_info')),
      entered_by_info: String(get('entered_by_info') ?? '').trim() || null,
    })
  }
  return results
}
