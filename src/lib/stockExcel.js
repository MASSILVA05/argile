import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow } from './excelHelpers'

const COLUMNS = [
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: 'Produit', key: 'product_name', width: 10 },
  { header: 'Type', key: 'movement_type', width: 14 },
  { header: 'Cadence théorique', key: 'cadence_theorique', width: 16 },
  { header: 'Feuillard', key: 'feuillard', width: 12 },
  { header: 'Report (stock début)', key: 'stock_start', width: 18 },
  { header: 'Cadence réelle', key: 'cadence_reelle', width: 16 },
  { header: 'Consommation', key: 'consommation', width: 14 },
  { header: 'Stock final', key: 'stock_final', width: 14 },
  { header: 'Nombre WAGON', key: 'nb_wagon', width: 14 },
  { header: 'Nombre PAQUET', key: 'nb_paquet', width: 14 },
  { header: 'Total WAGON', key: 'total_wagon', width: 14 },
  { header: 'Total PAQUETS', key: 'total_paquets', width: 14 },
  { header: 'Nombre de briques', key: 'nb_briques', width: 16 },
  { header: 'Commercial', key: 'commercial', width: 14 },
  { header: 'Stocks fin journée', key: 'stocks_fin_journee', width: 18 },
  { header: 'Quantité', key: 'quantity', width: 12 },
  { header: 'Stock après', key: 'stock_after', width: 14 },
  { header: 'Référence', key: 'reference', width: 16 },
  { header: 'Observations', key: 'observations', width: 30 },
  { header: 'Saisi par', key: 'entered_by_user', width: 18 },
]

export async function downloadStockExcel(movements, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Stock')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const m of movements) {
    const isProduction = m.movement_type === 'Production'
    const row = sheet.addRow({
      entry_date: m.entry_date,
      entry_time: m.entry_time ? m.entry_time.slice(0, 5) : '',
      product_name: m.product_name,
      movement_type: m.movement_type,
      cadence_theorique: m.cadence_theorique ?? '',
      feuillard: m.feuillard ?? '',
      stock_start: isProduction ? (m.stock_start ?? 0) : '',
      cadence_reelle: m.cadence_reelle ?? '',
      consommation: m.consommation ?? '',
      stock_final: isProduction ? (m.stock_final ?? '') : '',
      nb_wagon: m.nb_wagon ?? '',
      nb_paquet: m.nb_paquet ?? '',
      total_wagon: m.total_wagon ?? '',
      total_paquets: m.total_paquets ?? '',
      nb_briques: m.nb_briques ?? '',
      commercial: isProduction ? (m.commercial ?? 0) : '',
      stocks_fin_journee: isProduction ? (m.stocks_fin_journee ?? '') : '',
      quantity: m.quantity,
      stock_after: m.stock_after,
      reference: m.reference ?? '',
      observations: m.observations ?? '',
      entered_by_user: m.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Stock_Mouvements_${todayISO()}.xlsx`)
}
