import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import {
  DATA_ROW_HEIGHT,
  AMOUNT_ROW_FILL,
  todayISO,
  styleHeaderRow,
  styleDataRow,
  styleTotalsRow,
} from './excelHelpers'
import { formatDateTime } from './dateFormat'
import { itemsText } from './magasin'

const COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 10 },
  { header: 'Date', key: 'entry_date', width: 12 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: 'Type', key: 'type', width: 12 },
  { header: 'Client', key: 'client_name', width: 24 },
  { header: 'Articles', key: 'items', width: 50 },
  { header: 'Total HT (DA)', key: 'total_ht', width: 15 },
  { header: 'Remise (DA)', key: 'remise', width: 13 },
  { header: 'Total (DA)', key: 'total', width: 15 },
  { header: 'Mode de paiement', key: 'payment_mode', width: 16 },
  { header: 'N° chèque', key: 'cheque_number', width: 14 },
  { header: 'Banque', key: 'cheque_bank', width: 16 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
]

export async function downloadMagasinVentesExcel(ventes, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Ventes magasin')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const v of ventes) {
    const row = sheet.addRow({
      bon_number: v.bon_number,
      entry_date: v.entry_date,
      entry_time: v.entry_time ? v.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(v.created_at),
      type: v.is_payment ? 'Règlement' : 'Vente',
      client_name: v.client_name ?? '',
      items: v.is_payment ? '' : itemsText(v.items),
      total_ht: Number(v.total_ht) || 0,
      remise: Number(v.remise) || 0,
      total: Number(v.total) || 0,
      payment_mode: v.payment_mode ?? '',
      cheque_number: v.cheque_number ?? '',
      cheque_bank: v.cheque_bank ?? '',
      observations: v.observations ?? '',
      entered_by_user: v.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const totalVentes = ventes
    .filter((v) => !v.is_payment)
    .reduce((s, v) => s + (Number(v.total) || 0), 0)
  const totalReglements = ventes
    .filter((v) => v.is_payment)
    .reduce((s, v) => s + (Number(v.total) || 0), 0)

  const addTotal = (label, value, fill) => {
    const r = sheet.addRow({ bon_number: label, total: value })
    styleTotalsRow(r, fill)
    r.height = DATA_ROW_HEIGHT
  }
  addTotal('TOTAL VENTES', totalVentes, null)
  addTotal('TOTAL RÈGLEMENTS', totalReglements, AMOUNT_ROW_FILL)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Ventes_Magasin_${todayISO()}.xlsx`)
}
