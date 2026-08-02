import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { FIXED_WEIGHT_TYPE, rateFor } from './unloadingTypes'

const HEADER_FILL = 'FFC4653A' // terracotta
const AMOUNT_ROW_FILL = 'FFD4A24E' // ocre

const THIN_BORDER = { style: 'thin', color: { argb: 'FF33344F' } }
const ALL_BORDERS = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER }

const COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 12 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: 'Matricule', key: 'truck_plate', width: 18 },
  { header: 'Nom du chauffeur', key: 'driver_name', width: 25 },
  { header: 'DPR AXXAM Location (T)', key: 'location_weight', width: 22 },
  { header: 'Akbou (T)', key: 'akbou_weight', width: 15 },
  { header: 'DPR AXXAM 22T (T)', key: 'fixed_weight', width: 20 },
  { header: 'N° Ticket de pesée', key: 'ticket_number', width: 20 },
  { header: 'Photo du bon', key: 'photo', width: 20 },
  { header: 'Observations', key: 'observations', width: 30 },
]

const DATA_ROW_HEIGHT = 25
const PHOTO_ROW_HEIGHT = 85
const PHOTO_WIDTH = 140
const PHOTO_HEIGHT = 105

const PHOTO_COL_INDEX = COLUMNS.findIndex((c) => c.key === 'photo') + 1

function weightByType(entry, type) {
  return entry.unloading_type === type && entry.weight_tons != null ? Number(entry.weight_tons) : ''
}

function sumByType(entries, type) {
  return entries
    .filter((e) => e.unloading_type === type)
    .reduce((sum, e) => sum + (Number(e.weight_tons) || 0), 0)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function guessExtension(contentType) {
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('gif')) return 'gif'
  return 'jpeg'
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function fetchPhotoAsBase64(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const blob = await resp.blob()
  const base64 = await blobToBase64(blob)
  return { base64, extension: guessExtension(blob.type) }
}

const CENTERED_WRAP = { vertical: 'middle', horizontal: 'center', wrapText: true }

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = ALL_BORDERS
    cell.alignment = CENTERED_WRAP
  })
}

function styleDataRow(row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 11 }
    cell.border = ALL_BORDERS
    cell.alignment = CENTERED_WRAP
  })
}

function styleTotalsRow(row, fillArgb) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 11 }
    cell.border = ALL_BORDERS
    cell.alignment = CENTERED_WRAP
    if (fillArgb) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
    }
  })
}

export async function downloadExcel(entries, { onProgress, includePhotos = true } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Registre')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const withPhoto = includePhotos ? entries.filter((e) => e.photo_url) : []
  const totalPhotos = withPhoto.length
  let processedPhotos = 0

  for (const entry of entries) {
    const row = sheet.addRow({
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : '',
      truck_plate: entry.truck_plate,
      driver_name: entry.driver_name,
      location_weight: weightByType(entry, 'DPR AXXAM Location'),
      akbou_weight: weightByType(entry, 'Akbou'),
      fixed_weight: weightByType(entry, FIXED_WEIGHT_TYPE),
      ticket_number: entry.ticket_number ?? '',
      photo: includePhotos ? '' : entry.photo_url ? 'Oui' : 'Non',
      observations: entry.observations ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT

    if (includePhotos && entry.photo_url) {
      try {
        const { base64, extension } = await fetchPhotoAsBase64(entry.photo_url)
        const imageId = workbook.addImage({ base64, extension })
        sheet.addImage(imageId, {
          tl: { col: PHOTO_COL_INDEX - 1, row: row.number - 1 },
          ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
        })
        row.height = PHOTO_ROW_HEIGHT
      } catch {
        row.getCell(PHOTO_COL_INDEX).value = 'Photo non disponible'
      }
      processedPhotos += 1
      onProgress?.(processedPhotos, totalPhotos)
    }
  }

  const locationTotal = sumByType(entries, 'DPR AXXAM Location')
  const akbouTotal = sumByType(entries, 'Akbou')
  const fixedTotal = sumByType(entries, FIXED_WEIGHT_TYPE)

  const totalsRow = sheet.addRow({
    bon_number: 'TOTAL',
    location_weight: locationTotal,
    akbou_weight: akbouTotal,
    fixed_weight: fixedTotal,
  })
  styleTotalsRow(totalsRow, null)
  totalsRow.height = DATA_ROW_HEIGHT

  const amountsRow = sheet.addRow({
    bon_number: 'MONTANT (DA)',
    location_weight: Math.round(locationTotal * rateFor('DPR AXXAM Location')),
    akbou_weight: Math.round(akbouTotal * rateFor('Akbou')),
    fixed_weight: '',
  })
  styleTotalsRow(amountsRow, AMOUNT_ROW_FILL)
  amountsRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, `Registre_Chargement_${todayISO()}.xlsx`)
}
