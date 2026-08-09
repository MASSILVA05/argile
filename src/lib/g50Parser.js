import { read, utils, SSF } from 'xlsx'

const RELVE_SHEET = 'RELVE DE FCT'
const BANQUE_SHEET = 'BANQUE'
const ESPECE_SHEET = 'ESPECE'

// Les 3 onglets du G50 partagent la même mise en page : ligne d'en-tête à
// l'index 3 (0-based), données jusqu'à la 1ère ligne de totaux (Numéro/
// Client vide, ou libellé "Nombre de lignes :").
const HEADER_ROW_INDEX = 3
const DATA_START_INDEX = HEADER_ROW_INDEX + 1

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return null
  return utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
}

// Convertit un numéro de série Excel (colonne "Du"/"Date Doc") en date ISO
// (YYYY-MM-DD), sans passer par un objet Date JS -- ce qui évite tout
// décalage lié au fuseau horaire de la machine qui exécute le code.
function excelSerialToISO(serial) {
  if (serial == null || Number.isNaN(Number(serial))) return null
  const { y, m, d } = SSF.parse_date_code(Number(serial))
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

// "BADR N° 0000251" -> { bank: "BADR", chequeNumber: "0000251" }
// "N° 001" (espèces, pas de banque) -> { bank: null, chequeNumber: "001" }
function parseChequeInfo(piece) {
  if (!piece || typeof piece !== 'string') return { bank: null, chequeNumber: null }
  const match = piece.trim().match(/^(.*?)\s*N°\s*(\S+)$/i)
  if (!match) return { bank: null, chequeNumber: piece.trim() || null }
  const bank = match[1].trim() || null
  const chequeNumber = match[2].trim() || null
  return { bank, chequeNumber }
}

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

// Lit "RELVE DE FCT" : une ligne par facture (Numéro, Du, Client, Total HT,
// Remise, Total TVA, Total TTC, Timbre, Total net, Réf. Commande).
export function parseRelveDeFct(workbook) {
  const rows = sheetRows(workbook, RELVE_SHEET)
  if (!rows) throw new Error(`Feuille "${RELVE_SHEET}" introuvable dans le fichier.`)

  const invoices = []
  for (let i = DATA_START_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const [numero, du, client, totalHt, remise, totalTva, totalTtc, timbre, totalNet, refCommande] = row
    // Ligne de totaux : pas de numéro de facture.
    if (numero == null || String(numero).trim() === '') continue

    const clientName = client == null || String(client).trim() === '' ? 'COMPTOIR' : String(client).trim().toUpperCase()
    const discountAmount = Number(remise) || 0
    const stampDuty = Number(timbre) || 0
    const totalHtValue = Number(totalHt) || 0

    const totalNetComputed = (totalHtValue - discountAmount) * 1.19 + stampDuty

    invoices.push({
      invoice_number: String(numero).trim(),
      entry_date: excelSerialToISO(du),
      client_name: clientName,
      total_ht: totalHtValue,
      discount_amount: discountAmount,
      stamp_duty: stampDuty,
      ref_commande: refCommande == null ? null : String(refCommande).trim() || null,
      total_tva_file: Number(totalTva) || 0,
      total_ttc_file: Number(totalTtc) || 0,
      total_net_file: Number(totalNet) || 0,
      total_net_computed: totalNetComputed,
      net_diff: Math.abs(totalNetComputed - (Number(totalNet) || 0)),
      payment_status: 'Non payé',
      settlement: 0,
      cheque_number: null,
      cheque_bank: null,
    })
  }
  return invoices
}

// Lit "BANQUE" : matche par "Numéro Document" -> { payment_status: 'Chèque', ... }.
// Une ligne présente avec "Montant du réglement" = 0 signifie que le
// chèque n'a pas encore été réglé : on la laisse à 'Non payé'.
export function parseBanque(workbook) {
  const rows = sheetRows(workbook, BANQUE_SHEET)
  const byInvoiceNumber = new Map()
  if (!rows) return byInvoiceNumber

  for (let i = DATA_START_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const [, , , numeroDocument, , montantReglement, pieceDePayement] = row
    if (numeroDocument == null || String(numeroDocument).trim() === '') continue
    const montant = Number(montantReglement) || 0
    if (montant <= 0) continue

    const { bank, chequeNumber } = parseChequeInfo(pieceDePayement)
    byInvoiceNumber.set(String(numeroDocument).trim(), {
      payment_status: 'Chèque',
      settlement: montant,
      cheque_bank: bank,
      cheque_number: chequeNumber,
    })
  }
  return byInvoiceNumber
}

// Lit "ESPECE" : matche par "Numéro Document" -> { payment_status: 'Espèces', ... }.
export function parseEspece(workbook) {
  const rows = sheetRows(workbook, ESPECE_SHEET)
  const byInvoiceNumber = new Map()
  if (!rows) return byInvoiceNumber

  for (let i = DATA_START_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (isBlankRow(row)) continue
    const [, , , numeroDocument, , montantReglement] = row
    if (numeroDocument == null || String(numeroDocument).trim() === '') continue
    const montant = Number(montantReglement) || 0
    if (montant <= 0) continue

    byInvoiceNumber.set(String(numeroDocument).trim(), {
      payment_status: 'Espèces',
      settlement: montant,
      cheque_bank: null,
      cheque_number: null,
    })
  }
  return byInvoiceNumber
}

// Combine les 3 feuilles : relevé des factures + rapprochement des
// règlements (banque prioritaire sur espèces si jamais les deux matchaient
// le même numéro, ce qui ne devrait pas arriver en pratique).
export function parseG50Workbook(workbook) {
  const invoices = parseRelveDeFct(workbook)
  const banque = parseBanque(workbook)
  const espece = parseEspece(workbook)

  return invoices.map((invoice) => {
    const payment = banque.get(invoice.invoice_number) ?? espece.get(invoice.invoice_number)
    if (!payment) return invoice
    return { ...invoice, ...payment }
  })
}

// Lit un fichier .xls/.xlsx (ArrayBuffer) et renvoie la liste de factures
// prêtes à l'aperçu/import.
export function parseG50File(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  return parseG50Workbook(workbook)
}
