import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { ALL_BORDERS, DATA_ROW_HEIGHT, todayISO } from './excelHelpers'

const GRAY_FILL = 'FFD9D9D9'
const HIGHLIGHT_FILL = 'FFD4A24E'

// Export Excel générique pour les fiches par entité (EntitySheetModal /
// PrintableSheet) : réutilise exactement les mêmes `columns`/`rows`/
// `totalRows` que la fiche imprimable, donc une seule source de données par
// fiche -- même principe que downloadTvaPayerExcel (bloc titre/période
// fusionné au-dessus d'un en-tête gris), généralisé à n'importe quelles
// colonnes.
export async function downloadSheetExcel({ sheetName, title, subtitle, periodLabel, columns, rows, totalRows }, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName || 'Fiche')
  const colCount = columns.length
  sheet.columns = columns.map(({ key, width }) => ({ key, width: width || 18 }))

  let rowIndex = 1
  for (const text of [title, subtitle, periodLabel].filter(Boolean)) {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount)
    const cell = sheet.getCell(rowIndex, 1)
    cell.value = text
    cell.font = text === title ? { bold: true, size: 14 } : { size: 11 }
    cell.alignment = { horizontal: 'center' }
    rowIndex += 1
  }

  const headerRow = sheet.getRow(rowIndex)
  headerRow.values = columns.map((c) => c.header)
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_FILL } }
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = DATA_ROW_HEIGHT

  for (const row of rows) {
    const excelRow = sheet.addRow(columns.map((c) => row[c.key] ?? ''))
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = ALL_BORDERS
      if (columns[colNumber - 1]?.align === 'right') cell.alignment = { horizontal: 'right' }
    })
    excelRow.height = DATA_ROW_HEIGHT
  }

  for (const total of totalRows ?? []) {
    const excelRow = sheet.addRow(columns.map((c) => total.cells[c.key] ?? ''))
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { bold: true }
      cell.border = ALL_BORDERS
      if (columns[colNumber - 1]?.align === 'right') cell.alignment = { horizontal: 'right' }
      if (total.highlight) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HIGHLIGHT_FILL } }
    })
    excelRow.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Fiche_${todayISO()}.xlsx`)
}
