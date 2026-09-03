import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, AMOUNT_ROW_FILL, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow } from './excelHelpers'
import { formatDateTime } from './dateFormat'
import { achatItemsText } from './magasin'

const COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 10 },
  { header: 'Date', key: 'entry_date', width: 12 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: 'Fournisseur', key: 'fournisseur', width: 24 },
  { header: 'Articles', key: 'items', width: 50 },
  { header: 'Total achat (DA)', key: 'total', width: 16 },
  { header: 'Destination', key: 'destination', width: 15 },
  { header: 'Client revente', key: 'client_revente', width: 22 },
  { header: 'Prix revente (DA)', key: 'prix_revente', width: 15 },
  { header: 'Marge (DA)', key: 'marge', width: 14 },
  { header: 'Mode de paiement', key: 'payment_mode', width: 16 },
  { header: 'N° chèque', key: 'cheque_number', width: 14 },
  { header: 'Banque', key: 'cheque_bank', width: 16 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
]

export async function downloadMagasinAchatsExcel(achats, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Achats magasin')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const a of achats) {
    const row = sheet.addRow({
      bon_number: a.bon_number,
      entry_date: a.entry_date,
      entry_time: a.entry_time ? a.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(a.created_at),
      fournisseur: a.fournisseur ?? '',
      items: achatItemsText(a.items),
      total: Number(a.total) || 0,
      destination: a.destination ?? '',
      client_revente: a.client_revente ?? '',
      prix_revente: a.prix_revente != null ? Number(a.prix_revente) : '',
      marge: a.marge != null ? Number(a.marge) : '',
      payment_mode: a.payment_mode ?? '',
      cheque_number: a.cheque_number ?? '',
      cheque_bank: a.cheque_bank ?? '',
      observations: a.observations ?? '',
      entered_by_user: a.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const totalAchats = achats.reduce((s, a) => s + (Number(a.total) || 0), 0)
  const totalMarge = achats.reduce((s, a) => s + (Number(a.marge) || 0), 0)
  const r = sheet.addRow({ bon_number: 'TOTAUX', total: totalAchats, marge: totalMarge })
  styleTotalsRow(r, AMOUNT_ROW_FILL)
  r.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Achats_Magasin_${todayISO()}.xlsx`)
}
