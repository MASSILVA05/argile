import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow } from './excelHelpers'

const COLUMNS = [
  { header: 'Client', key: 'name', width: 32 },
  { header: 'Code', key: 'client_code', width: 14 },
  { header: 'Total facturé (DA)', key: 'total_invoiced', width: 20 },
  { header: 'Total réglé (DA)', key: 'total_paid', width: 20 },
  { header: 'Solde dû (DA)', key: 'balance', width: 18 },
  { header: 'Source', key: 'source', width: 18 },
]

export async function downloadClientBalancesExcel(clients, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Soldes clients')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const client of clients) {
    const row = sheet.addRow({
      name: client.name,
      client_code: client.client_code ?? '',
      total_invoiced: client.total_invoiced,
      total_paid: client.total_paid,
      balance: client.balance,
      source: client.source ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Soldes_Clients_${todayISO()}.xlsx`)
}
