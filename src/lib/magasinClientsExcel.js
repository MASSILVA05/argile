import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow } from './excelHelpers'

const COLUMNS = [
  { header: 'Nom client', key: 'name', width: 30 },
  { header: 'Téléphone', key: 'phone', width: 16 },
  { header: 'Chiffre affaires (DA)', key: 'chiffre_affaires', width: 20 },
  { header: 'Seuil crédit (DA)', key: 'seuil_credit', width: 18 },
  { header: 'Crédit / solde (DA)', key: 'credit', width: 18 },
  { header: 'Dernière opération', key: 'last_operation_date', width: 18 },
]

export async function downloadMagasinClientsExcel(rows, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Crédits clients')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    const row = sheet.addRow({
      name: r.name ?? '',
      phone: r.phone ?? '',
      chiffre_affaires: Number(r.chiffre_affaires) || 0,
      seuil_credit: Number(r.seuil_credit) || 0,
      credit: Number(r.credit) || 0,
      last_operation_date: r.last_operation_date ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Credits_Clients_Magasin_${todayISO()}.xlsx`)
}
