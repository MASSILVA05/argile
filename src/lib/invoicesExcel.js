import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, AMOUNT_ROW_FILL, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow } from './excelHelpers'

const COLUMNS = [
  { header: 'N° Facture', key: 'invoice_number', width: 18 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: 'Client', key: 'client_name', width: 28 },
  { header: 'Total HT (DA)', key: 'total_ht', width: 16 },
  { header: 'Remise (%)', key: 'discount_percent', width: 12 },
  { header: 'TVA (DA)', key: 'total_tva', width: 16 },
  { header: 'TTC (DA)', key: 'total_ttc', width: 16 },
  { header: 'Timbre (DA)', key: 'stamp_duty', width: 14 },
  { header: 'Total Net (DA)', key: 'total_net', width: 16 },
  { header: 'Paiement', key: 'payment_status', width: 14 },
  { header: 'N° chèque', key: 'cheque_number', width: 16 },
  { header: 'Banque', key: 'cheque_bank', width: 16 },
  { header: 'Réf. Commande', key: 'ref_commande', width: 18 },
  { header: 'Réf. Livraison', key: 'ref_livraison', width: 18 },
  { header: 'Saisi par', key: 'entered_by_user', width: 18 },
  { header: 'Observations', key: 'observations', width: 30 },
]

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
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : '',
      client_name: entry.client_name,
      total_ht: entry.total_ht,
      discount_percent: entry.discount_percent ?? 0,
      total_tva: entry.total_tva,
      total_ttc: entry.total_ttc,
      stamp_duty: entry.stamp_duty ?? 0,
      total_net: entry.total_net,
      payment_status: entry.payment_status ?? 'Non payé',
      cheque_number: entry.cheque_number ?? '',
      cheque_bank: entry.cheque_bank ?? '',
      ref_commande: entry.ref_commande ?? '',
      ref_livraison: entry.ref_livraison ?? '',
      entered_by_user: entry.entered_by_user ?? '',
      observations: entry.observations ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const totalHt = entries.reduce((sum, e) => sum + (Number(e.total_ht) || 0), 0)
  const totalTva = entries.reduce((sum, e) => sum + (Number(e.total_tva) || 0), 0)
  const totalTtc = entries.reduce((sum, e) => sum + (Number(e.total_ttc) || 0), 0)
  const stampDuty = entries.reduce((sum, e) => sum + (Number(e.stamp_duty) || 0), 0)
  const totalNet = entries.reduce((sum, e) => sum + (Number(e.total_net) || 0), 0)
  const restePayer = entries
    .filter((e) => (e.payment_status ?? 'Non payé') === 'Non payé')
    .reduce((sum, e) => sum + (Number(e.total_net) || 0), 0)

  const totalsRow = sheet.addRow({
    invoice_number: 'TOTAL',
    total_ht: totalHt,
    total_tva: totalTva,
    total_ttc: totalTtc,
    stamp_duty: stampDuty,
    total_net: totalNet,
  })
  styleTotalsRow(totalsRow, null)
  totalsRow.height = DATA_ROW_HEIGHT

  const resteRow = sheet.addRow({
    invoice_number: 'RESTE À PAYER',
    total_net: restePayer,
  })
  styleTotalsRow(resteRow, AMOUNT_ROW_FILL)
  resteRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Registre_Factures_${todayISO()}.xlsx`)
}
