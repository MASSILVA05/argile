import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import {
  DATA_ROW_HEIGHT,
  PHOTO_ROW_HEIGHT,
  PHOTO_WIDTH,
  PHOTO_HEIGHT,
  todayISO,
  fetchPhotoAsBase64,
  styleHeaderRow,
  styleDataRow,
} from './excelHelpers'

const COLUMNS = [
  { header: 'N° Fiche', key: 'fiche_number', width: 12 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: 'Machine', key: 'machine_name', width: 22 },
  { header: 'Problème', key: 'problem_description', width: 30 },
  { header: 'Fournisseur', key: 'supplier_name', width: 20 },
  { header: 'Acheté par', key: 'purchased_by', width: 18 },
  { header: 'Renseigné par', key: 'entered_by', width: 18 },
  { header: 'Demandé par', key: 'requested_by', width: 18 },
  { header: 'Montant (DA)', key: 'amount', width: 15 },
  { header: 'Payé', key: 'is_paid', width: 12 },
  { header: 'Photo machine', key: 'machine_photo', width: 20 },
  { header: 'Photo bon d’achat', key: 'receipt_photo', width: 20 },
  { header: 'Observations', key: 'observations', width: 30 },
  { header: 'Saisi par', key: 'entered_by_user', width: 18 },
]

const MACHINE_PHOTO_COL = COLUMNS.findIndex((c) => c.key === 'machine_photo') + 1
const RECEIPT_PHOTO_COL = COLUMNS.findIndex((c) => c.key === 'receipt_photo') + 1

async function embedPhoto(workbook, sheet, row, colIndex, url) {
  try {
    const { base64, extension } = await fetchPhotoAsBase64(url)
    const imageId = workbook.addImage({ base64, extension })
    sheet.addImage(imageId, {
      tl: { col: colIndex - 1, row: row.number - 1 },
      ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
    })
    return true
  } catch {
    row.getCell(colIndex).value = 'Photo non disponible'
    return false
  }
}

export async function downloadMaintenanceExcel(entries, { onProgress, includePhotos = true, filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Maintenance')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const totalPhotos = includePhotos
    ? entries.reduce((sum, e) => sum + (e.machine_photo_url ? 1 : 0) + (e.receipt_photo_url ? 1 : 0), 0)
    : 0
  let processedPhotos = 0

  for (const entry of entries) {
    const row = sheet.addRow({
      fiche_number: entry.fiche_number,
      entry_date: entry.entry_date,
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : '',
      machine_name: entry.machine_name,
      problem_description: entry.problem_description,
      supplier_name: entry.supplier_name ?? '',
      purchased_by: entry.purchased_by ?? '',
      entered_by: entry.entered_by ?? '',
      requested_by: entry.requested_by ?? '',
      amount: entry.amount ?? '',
      is_paid: entry.is_paid ?? '',
      machine_photo: includePhotos ? '' : entry.machine_photo_url ? 'Oui' : 'Non',
      receipt_photo: includePhotos ? '' : entry.receipt_photo_url ? 'Oui' : 'Non',
      observations: entry.observations ?? '',
      entered_by_user: entry.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT

    if (includePhotos) {
      let hasPhoto = false
      if (entry.machine_photo_url) {
        await embedPhoto(workbook, sheet, row, MACHINE_PHOTO_COL, entry.machine_photo_url)
        hasPhoto = true
        processedPhotos += 1
        onProgress?.(processedPhotos, totalPhotos)
      }
      if (entry.receipt_photo_url) {
        await embedPhoto(workbook, sheet, row, RECEIPT_PHOTO_COL, entry.receipt_photo_url)
        hasPhoto = true
        processedPhotos += 1
        onProgress?.(processedPhotos, totalPhotos)
      }
      if (hasPhoto) row.height = PHOTO_ROW_HEIGHT
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Registre_Maintenance_${todayISO()}.xlsx`)
}
