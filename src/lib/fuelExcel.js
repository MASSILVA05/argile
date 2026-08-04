import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow } from './excelHelpers'

const COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 12 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: "Type d'opération", key: 'operation_type', width: 22 },
  { header: 'Matricule', key: 'truck_plate', width: 18 },
  { header: 'Chauffeur', key: 'driver_name', width: 22 },
  { header: 'Volume (L)', key: 'volume_liters', width: 14 },
  { header: 'Fournisseur', key: 'supplier_name', width: 20 },
  { header: 'Réserve après (L)', key: 'tank_volume_after', width: 18 },
  { header: 'Observations', key: 'observations', width: 30 },
]

export async function downloadFuelExcel(entries, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Carburant')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const entry of entries) {
    const row = sheet.addRow({
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : '',
      operation_type: entry.operation_type,
      truck_plate: entry.truck_plate ?? '',
      driver_name: entry.driver_name ?? '',
      volume_liters: entry.volume_liters,
      supplier_name: entry.supplier_name ?? '',
      tank_volume_after: entry.tank_volume_after,
      observations: entry.observations ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Registre_Carburant_${todayISO()}.xlsx`)
}
