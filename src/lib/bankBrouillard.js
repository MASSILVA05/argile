// Brouillard banque (sous-onglet de la page Chèques) : journal des mouvements
// d'une banque sur un mois, rapprochable avec le relevé bancaire.
//
// Sources (lignes calculées à la volée, rien n'est dupliqué en base) :
//   - cheques (hors Annulé / Rejeté) : Émis = Débit, Reçu = Crédit, à la date
//     du chèque ;
//   - caisse_entries réglées par Chèque / Versement / Virement sur cette
//     banque (cheque_bank) et NON générées par un chèque (linked_cheque_id
//     null, sinon doublon avec le chèque) : Encaissement = Crédit,
//     Décaissement / Dépense = Débit.
// Pointage : table bank_reconciliation (voir schema.sql).

import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { writeCompanyHeader, styleHeaderRow, styleDataRow, styleTotalsRow, AMOUNT_ROW_FILL, DATA_ROW_HEIGHT } from './excelHelpers'
import { formatDA } from './cheques'

export const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export const EXCLUDED_CHEQUE_STATUTS = ['Annulé', 'Rejeté']
export const BANK_CAISSE_MODES = ['Chèque', 'Versement', 'Virement']

export function monthBounds(year, month) {
  const mm = String(month).padStart(2, '0')
  const last = new Date(year, month, 0).getDate()
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

export function periodLabelOf(year, month) {
  return `${MONTHS_FR[month - 1]} ${year}`
}

// (année, mois) d'un pointage <= (année, mois) du brouillard affiché.
function reconciledBy(rec, year, month) {
  return Boolean(rec?.reconciled) && (rec.year < year || (rec.year === year && rec.month <= month))
}

function chequeOperation(c) {
  const emis = c.type === 'Émis'
  return {
    key: `cheque:${c.id}`,
    source: 'cheque',
    sourceId: c.id,
    date: c.cheque_date,
    piece: c.cheque_number,
    label: `${emis ? 'Chèque émis' : 'Chèque reçu'} — ${c.beneficiary}${c.motif ? ` (${c.motif})` : ''}`,
    debit: emis ? Number(c.amount) || 0 : 0,
    credit: emis ? 0 : Number(c.amount) || 0,
    statut: c.statut,
  }
}

function caisseOperation(e) {
  const credit = e.operation_type === 'Encaissement'
  const who = e.client_name || e.beneficiary
  return {
    key: `caisse:${e.id}`,
    source: 'caisse',
    sourceId: e.id,
    date: e.entry_date,
    piece: e.cheque_number || e.piece_number || `Caisse n° ${e.bon_number}`,
    label: `${e.payment_mode} — ${e.description}${who ? ` (${who})` : ''}`,
    debit: credit ? 0 : Number(e.amount) || 0,
    credit: credit ? Number(e.amount) || 0 : 0,
    statut: e.payment_mode,
  }
}

// cheques / caisseEntries : TOUTES les opérations de la banque jusqu'à la fin
// du mois (déjà filtrées par banque/entité/statut). recByKey : Map<key,
// bank_reconciliation>.
export function buildBrouillard({ cheques, caisseEntries, recByKey, year, month }) {
  const { start, end } = monthBounds(year, month)
  const all = [...cheques.map(chequeOperation), ...caisseEntries.map(caisseOperation)]
    .filter((op) => op.date && op.date <= end)
    .map((op) => {
      const rec = recByKey.get(op.key)
      return { ...op, rec, reconciled: reconciledBy(rec, year, month) }
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.piece < b.piece ? -1 : 1))

  const before = all.filter((op) => op.date < start)
  const openingBalance = before.reduce((s, op) => s + op.credit - op.debit, 0)

  let running = openingBalance
  const rows = all
    .filter((op) => op.date >= start)
    .map((op) => {
      running += op.credit - op.debit
      return { ...op, balance: running }
    })

  // Opérations antérieures non pointées à la fin de ce mois (suspens reportés).
  const carriedPending = before.filter((op) => !op.reconciled)

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
  const closingBalance = openingBalance + totalCredit - totalDebit

  const pending = [...carriedPending, ...rows.filter((r) => !r.reconciled)]
  const pendingDebit = pending.reduce((s, r) => s + r.debit, 0)
  const pendingCredit = pending.reduce((s, r) => s + r.credit, 0)

  return { rows, carriedPending, openingBalance, totalDebit, totalCredit, closingBalance, pendingDebit, pendingCredit }
}

// Solde rapproché = solde du relevé + crédits en suspens − débits en suspens ;
// doit égaler le solde du brouillard (écart = 0).
export function reconciliationSummary(data, statementBalance) {
  if (statementBalance == null || statementBalance === '' || Number.isNaN(Number(statementBalance))) return null
  const reconciledBalance = Number(statementBalance) + data.pendingCredit - data.pendingDebit
  return { reconciledBalance, gap: reconciledBalance - data.closingBalance }
}

const EXCEL_COLUMNS = [
  { header: 'Date opération', key: 'date', width: 14 },
  { header: 'N° pièce', key: 'piece', width: 18 },
  { header: 'Libellé', key: 'label', width: 46 },
  { header: 'Débit (DA)', key: 'debit', width: 16 },
  { header: 'Crédit (DA)', key: 'credit', width: 16 },
  { header: 'Solde cumulé (DA)', key: 'balance', width: 18 },
  { header: 'Rapproché', key: 'reconciled', width: 12 },
]

export async function downloadBrouillardExcel(data, { bank, year, month, entity, statementBalance }) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Brouillard banque')
  const nCols = EXCEL_COLUMNS.length
  EXCEL_COLUMNS.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width
  })

  let r = writeCompanyHeader(sheet, nCols)
  sheet.mergeCells(r, 1, r, nCols)
  sheet.getCell(r, 1).value = `BROUILLARD BANQUE — ${bank} — ${periodLabelOf(year, month)}${entity ? ` — ${entity}` : ''}`
  sheet.getCell(r, 1).font = { bold: true, size: 12 }
  sheet.getCell(r, 1).alignment = { horizontal: 'center' }
  r += 2

  const header = sheet.getRow(r)
  EXCEL_COLUMNS.forEach((c, i) => {
    header.getCell(i + 1).value = c.header
  })
  styleHeaderRow(header)
  header.height = DATA_ROW_HEIGHT
  r += 1

  const addRow = (values, { totals = false } = {}) => {
    const row = sheet.getRow(r)
    EXCEL_COLUMNS.forEach((c, i) => {
      row.getCell(i + 1).value = values[c.key] ?? ''
    })
    for (const k of ['debit', 'credit', 'balance']) {
      const idx = EXCEL_COLUMNS.findIndex((c) => c.key === k) + 1
      row.getCell(idx).numFmt = '#,##0.00'
    }
    if (totals) styleTotalsRow(row, AMOUNT_ROW_FILL)
    else styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
    r += 1
  }

  addRow({ label: 'Report solde début de mois', balance: data.openingBalance }, { totals: true })
  for (const op of data.rows) {
    addRow({
      date: op.date,
      piece: op.piece,
      label: op.label,
      debit: op.debit || '',
      credit: op.credit || '',
      balance: op.balance,
      reconciled: op.reconciled ? 'Oui' : 'Non',
    })
  }
  addRow({ label: 'TOTAUX DU MOIS', debit: data.totalDebit, credit: data.totalCredit, balance: data.closingBalance }, { totals: true })

  if (data.carriedPending.length > 0) {
    r += 1
    sheet.getCell(r, 1).value = 'Opérations en suspens des mois précédents'
    sheet.getCell(r, 1).font = { bold: true }
    r += 1
    for (const op of data.carriedPending) {
      addRow({ date: op.date, piece: op.piece, label: op.label, debit: op.debit || '', credit: op.credit || '', reconciled: 'Non' })
    }
  }

  r += 1
  const summary = reconciliationSummary(data, statementBalance)
  const lines = [
    ['Solde brouillard fin de mois', data.closingBalance],
    ['Débits en suspens', data.pendingDebit],
    ['Crédits en suspens', data.pendingCredit],
    ...(summary
      ? [
          ['Solde relevé bancaire', Number(statementBalance)],
          ['Solde rapproché', summary.reconciledBalance],
          ['Écart', summary.gap],
        ]
      : []),
  ]
  for (const [label, value] of lines) {
    sheet.getCell(r, 3).value = label
    sheet.getCell(r, 3).font = { bold: true }
    sheet.getCell(r, 6).value = value
    sheet.getCell(r, 6).numFmt = '#,##0.00'
    r += 1
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const mm = String(month).padStart(2, '0')
  saveAs(new Blob([buffer]), `Brouillard_Banque_${bank}_${year}-${mm}.xlsx`)
}

export { formatDA }
