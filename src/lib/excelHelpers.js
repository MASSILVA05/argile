export const HEADER_FILL = 'FFC4653A' // terracotta
export const AMOUNT_ROW_FILL = 'FFD4A24E' // ocre

const THIN_BORDER = { style: 'thin', color: { argb: 'FF33344F' } }
export const ALL_BORDERS = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER }

export const DATA_ROW_HEIGHT = 25
export const PHOTO_ROW_HEIGHT = 85
export const PHOTO_WIDTH = 140
export const PHOTO_HEIGHT = 105

export const CENTERED_WRAP = { vertical: 'middle', horizontal: 'center', wrapText: true }

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function guessExtension(contentType) {
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

export async function fetchPhotoAsBase64(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const blob = await resp.blob()
  const base64 = await blobToBase64(blob)
  return { base64, extension: guessExtension(blob.type) }
}

export function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.border = ALL_BORDERS
    cell.alignment = CENTERED_WRAP
  })
}

export function styleDataRow(row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 11 }
    cell.border = ALL_BORDERS
    cell.alignment = CENTERED_WRAP
  })
}

export function styleTotalsRow(row, fillArgb) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 11 }
    cell.border = ALL_BORDERS
    cell.alignment = CENTERED_WRAP
    if (fillArgb) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
    }
  })
}
