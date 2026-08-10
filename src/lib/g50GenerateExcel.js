import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow } from './excelHelpers'

const RELVE_COLUMNS = [
  { header: 'Numéro', key: 'invoice_number', width: 16 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Client', key: 'client_name', width: 32 },
  { header: 'Total HT (DA)', key: 'total_ht', width: 16 },
  { header: 'Remise (DA)', key: 'discount_amount', width: 14 },
  { header: 'TVA (DA)', key: 'total_tva', width: 16 },
  { header: 'TTC (DA)', key: 'total_ttc', width: 16 },
  { header: 'Timbre (DA)', key: 'stamp_duty', width: 12 },
  { header: 'Total Net (DA)', key: 'total_net', width: 16 },
]

const BANQUE_COLUMNS = [
  { header: 'N° Facture', key: 'invoice_number', width: 16 },
  { header: 'Client', key: 'client_name', width: 32 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'N° Chèque', key: 'cheque_number', width: 16 },
  { header: 'Banque', key: 'cheque_bank', width: 18 },
  { header: 'Montant réglé (DA)', key: 'settlement', width: 18 },
]

const ESPECE_COLUMNS = [
  { header: 'N° Facture', key: 'invoice_number', width: 16 },
  { header: 'Client', key: 'client_name', width: 32 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Montant réglé (DA)', key: 'settlement', width: 18 },
]

function addTable(workbook, sheetName, columns, rows, totalsBuilder) {
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) {
    const excelRow = sheet.addRow(row)
    styleDataRow(excelRow)
    excelRow.height = DATA_ROW_HEIGHT
  }

  if (totalsBuilder) {
    const totalsRow = sheet.addRow(totalsBuilder(rows))
    styleTotalsRow(totalsRow, null)
    totalsRow.height = DATA_ROW_HEIGHT
  }

  return sheet
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

export async function downloadGeneratedG50Excel({ periodLabel, invoiceRows, recap }, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()

  const relveRows = invoiceRows.map((e) => ({
    invoice_number: e.invoice_number,
    entry_date: e.entry_date,
    client_name: e.client_name,
    total_ht: e.amount ?? 0,
    discount_amount: e.discount_amount ?? 0,
    total_tva: e.total_tva ?? 0,
    total_ttc: e.total_ttc ?? 0,
    stamp_duty: e.stamp_duty ?? 0,
    total_net: e.total_net ?? 0,
  }))
  addTable(workbook, 'RELVE DE FCT', RELVE_COLUMNS, relveRows, (rows) => ({
    invoice_number: 'TOTAL',
    total_ht: sum(rows, 'total_ht'),
    discount_amount: sum(rows, 'discount_amount'),
    total_tva: sum(rows, 'total_tva'),
    total_ttc: sum(rows, 'total_ttc'),
    stamp_duty: sum(rows, 'stamp_duty'),
    total_net: sum(rows, 'total_net'),
  }))

  const banqueRows = invoiceRows
    .filter((e) => e.payment_status === 'Chèque')
    .map((e) => ({
      invoice_number: e.invoice_number,
      client_name: e.client_name,
      entry_date: e.entry_date,
      cheque_number: e.cheque_number ?? '',
      cheque_bank: e.cheque_bank ?? '',
      settlement: e.settlement ?? 0,
    }))
  addTable(workbook, 'BANQUE', BANQUE_COLUMNS, banqueRows, (rows) => ({
    invoice_number: 'TOTAL',
    settlement: sum(rows, 'settlement'),
  }))

  const especeRows = invoiceRows
    .filter((e) => e.payment_status === 'Espèces')
    .map((e) => ({
      invoice_number: e.invoice_number,
      client_name: e.client_name,
      entry_date: e.entry_date,
      settlement: e.settlement ?? 0,
    }))
  addTable(workbook, 'ESPECE', ESPECE_COLUMNS, especeRows, (rows) => ({
    invoice_number: 'TOTAL',
    settlement: sum(rows, 'settlement'),
  }))

  const recapSheet = workbook.addWorksheet('RECAP')
  recapSheet.columns = [
    { header: 'Rubrique', key: 'label', width: 30 },
    { header: 'Montant (DA)', key: 'value', width: 20 },
  ]
  styleHeaderRow(recapSheet.getRow(1))
  recapSheet.getRow(1).height = DATA_ROW_HEIGHT

  const recapRows = [
    { label: `Période : ${periodLabel}`, value: '' },
    { label: 'CA brut', value: recap.caBrut },
    { label: 'Total remises', value: recap.totalRemises },
    { label: 'CA imposable', value: recap.caImposable },
    { label: 'TAP due (1%)', value: recap.tapDue },
    { label: 'TVA collectée', value: recap.tvaCollectee },
    { label: 'TVA déductible', value: recap.tvaDeductible },
    { label: 'TVA à payer', value: recap.tvaAPayer },
    { label: 'Total timbre', value: recap.totalTimbre },
    { label: 'IRG', value: recap.irg },
    { label: 'TOTAL À PAYER', value: recap.totalAPayer },
  ]
  for (const r of recapRows) {
    const row = recapSheet.addRow(r)
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }
  const lastRow = recapSheet.getRow(recapSheet.rowCount)
  styleTotalsRow(lastRow, null)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `G50_${periodLabel.replace(/\s+/g, '_')}_${todayISO()}.xlsx`)
}
