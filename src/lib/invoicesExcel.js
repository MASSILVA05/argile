import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, AMOUNT_ROW_FILL, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow } from './excelHelpers'
import { formatDateTime } from './dateFormat'

const COLUMNS = [
  { header: 'N° Facture', key: 'invoice_number', width: 16 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Saisie le', key: 'created_at', width: 18 },
  { header: 'Client', key: 'client_name', width: 28 },
  { header: 'Désignation', key: 'designation', width: 16 },
  { header: 'N° BL', key: 'bl_number', width: 14 },
  { header: 'B8 (T)', key: 'qty_b8', width: 10 },
  { header: 'B12 (T)', key: 'qty_b12', width: 10 },
  { header: 'Autre (H)', key: 'qty_h', width: 10 },
  { header: 'Prix B8 (DA)', key: 'price_b8', width: 12 },
  { header: 'Prix B12 (DA)', key: 'price_b12', width: 12 },
  { header: 'Prix H (DA)', key: 'price_h', width: 12 },
  { header: 'Montant (DA)', key: 'amount', width: 16 },
  { header: 'Remise (DA)', key: 'discount_amount', width: 14 },
  { header: 'Total (DA)', key: 'total', width: 16 },
  { header: 'Règlement (DA)', key: 'settlement', width: 16 },
  { header: 'Décaissement (DA)', key: 'disbursement', width: 16 },
  { header: 'Chauffeur', key: 'driver_name', width: 22 },
  { header: 'Immat', key: 'truck_plate', width: 18 },
  { header: 'Type (N/B)', key: 'payment_type', width: 14 },
  { header: 'Solde (DA)', key: 'balance', width: 16 },
  { header: 'TVA (DA)', key: 'total_tva', width: 14 },
  { header: 'TTC (DA)', key: 'total_ttc', width: 14 },
  { header: 'Timbre (DA)', key: 'stamp_duty', width: 12 },
  { header: 'Total Net (DA)', key: 'total_net', width: 16 },
  { header: 'Paiement', key: 'payment_status', width: 14 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 18 },
]

function designationLabel(entry) {
  return entry.designation === 'Autre' ? entry.designation_other || 'Autre' : entry.designation
}

export async function downloadInvoicesExcel(entries, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Factures')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const entry of entries) {
    const row = sheet.addRow({
      invoice_number: entry.invoice_number,
      entry_date: entry.entry_date,
      created_at: formatDateTime(entry.created_at),
      client_name: entry.client_name,
      designation: designationLabel(entry),
      bl_number: entry.bl_number ?? '',
      qty_b8: entry.qty_b8 ?? 0,
      qty_b12: entry.qty_b12 ?? 0,
      qty_h: entry.qty_h ?? 0,
      price_b8: entry.qty_b8 > 0 ? (entry.price_b8 ?? 0) : '',
      price_b12: entry.qty_b12 > 0 ? (entry.price_b12 ?? 0) : '',
      price_h: entry.qty_h > 0 ? (entry.price_h ?? 0) : '',
      amount: entry.amount ?? 0,
      discount_amount: entry.discount_amount ?? 0,
      total: entry.total ?? 0,
      settlement: entry.settlement ?? 0,
      disbursement: entry.disbursement ?? 0,
      driver_name: entry.driver_name ?? '',
      truck_plate: entry.truck_plate ?? '',
      payment_type: entry.payment_type ?? '',
      balance: entry.balance ?? 0,
      total_tva: entry.total_tva ?? 0,
      total_ttc: entry.total_ttc ?? 0,
      stamp_duty: entry.stamp_duty ?? 0,
      total_net: entry.total_net ?? 0,
      payment_status: entry.payment_status ?? 'Non payé',
      observations: entry.observations ?? '',
      entered_by_user: entry.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const amountTotal = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  const discountTotal = entries.reduce((sum, e) => sum + (Number(e.discount_amount) || 0), 0)
  const totalTotal = entries.reduce((sum, e) => sum + (Number(e.total) || 0), 0)
  const settlementTotal = entries.reduce((sum, e) => sum + (Number(e.settlement) || 0), 0)
  const disbursementTotal = entries.reduce((sum, e) => sum + (Number(e.disbursement) || 0), 0)
  const balanceTotal = entries.reduce((sum, e) => sum + (Number(e.balance) || 0), 0)
  const tvaTotal = entries.reduce((sum, e) => sum + (Number(e.total_tva) || 0), 0)
  const ttcTotal = entries.reduce((sum, e) => sum + (Number(e.total_ttc) || 0), 0)
  const stampDutyTotal = entries.reduce((sum, e) => sum + (Number(e.stamp_duty) || 0), 0)
  const netTotal = entries.reduce((sum, e) => sum + (Number(e.total_net) || 0), 0)
  const restePayer = entries
    .filter((e) => (e.payment_status ?? 'Non payé') === 'Non payé')
    .reduce((sum, e) => sum + (Number(e.balance) || 0), 0)

  const totalsRow = sheet.addRow({
    invoice_number: 'TOTAL',
    amount: amountTotal,
    discount_amount: discountTotal,
    total: totalTotal,
    settlement: settlementTotal,
    disbursement: disbursementTotal,
    balance: balanceTotal,
    total_tva: tvaTotal,
    total_ttc: ttcTotal,
    stamp_duty: stampDutyTotal,
    total_net: netTotal,
  })
  styleTotalsRow(totalsRow, null)
  totalsRow.height = DATA_ROW_HEIGHT

  const resteRow = sheet.addRow({
    invoice_number: 'RESTE À PAYER',
    balance: restePayer,
  })
  styleTotalsRow(resteRow, AMOUNT_ROW_FILL)
  resteRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Registre_Factures_${todayISO()}.xlsx`)
}
