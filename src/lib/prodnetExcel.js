import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, AMOUNT_ROW_FILL, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow } from './excelHelpers'
import { formatDateTime } from './dateFormat'
import { matieresText, toNum } from './prodnet'

async function save(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename)
}

const PRODUCT_COLUMNS = [
  { header: 'Référence', key: 'reference', width: 16 },
  { header: 'Désignation', key: 'designation', width: 40 },
  { header: 'Quantité', key: 'quantite', width: 14 },
  { header: 'Prix moyen HT (DA)', key: 'prix_moyen_ht', width: 18 },
  { header: 'Montant HT (DA)', key: 'montant_ht', width: 18 },
]

export async function downloadProdnetProductsExcel(rows, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Produits finis')
  sheet.columns = PRODUCT_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    const row = sheet.addRow({
      reference: r.reference ?? '',
      designation: r.designation ?? '',
      quantite: toNum(r.quantite),
      prix_moyen_ht: toNum(r.prix_moyen_ht),
      montant_ht: toNum(r.montant_ht),
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }
  const total = sheet.addRow({ designation: 'TOTAL', montant_ht: rows.reduce((s, r) => s + toNum(r.montant_ht), 0) })
  styleTotalsRow(total, AMOUNT_ROW_FILL)

  await save(workbook, filename || `Prodnet_Produits_Finis_${todayISO()}.xlsx`)
}

const MATIERE_COLUMNS = [
  { header: 'Désignation', key: 'designation', width: 40 },
  { header: 'Position tarifaire', key: 'position_tarifaire', width: 18 },
  { header: 'Unité', key: 'unite', width: 10 },
  { header: 'Quantité', key: 'quantite', width: 14 },
  { header: 'Prix moyen (DA)', key: 'prix_moyen', width: 16 },
  { header: 'Valeur totale (DA)', key: 'valeur_totale', width: 18 },
]

export async function downloadProdnetMatieresExcel(rows, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Matières premières')
  sheet.columns = MATIERE_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    const row = sheet.addRow({
      designation: r.designation ?? '',
      position_tarifaire: r.position_tarifaire ?? '',
      unite: r.unite ?? '',
      quantite: toNum(r.quantite),
      prix_moyen: toNum(r.prix_moyen),
      valeur_totale: toNum(r.valeur_totale),
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }
  const total = sheet.addRow({ designation: 'TOTAL', valeur_totale: rows.reduce((s, r) => s + toNum(r.valeur_totale), 0) })
  styleTotalsRow(total, AMOUNT_ROW_FILL)

  await save(workbook, filename || `Prodnet_Matieres_Premieres_${todayISO()}.xlsx`)
}

const FAB_COLUMNS = [
  { header: 'Date', key: 'entry_date', width: 12 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: 'Réf. produit', key: 'product_reference', width: 14 },
  { header: 'Produit fini', key: 'product_designation', width: 36 },
  { header: 'Qté produite', key: 'quantite_produite', width: 12 },
  { header: 'Matières consommées', key: 'matieres', width: 60 },
  { header: 'Coût total (DA)', key: 'cout_total', width: 16 },
  { header: 'Coût unitaire (DA)', key: 'cout_unitaire', width: 16 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
]

export async function downloadProdnetFabricationsExcel(rows, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Fabrications')
  sheet.columns = FAB_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    const row = sheet.addRow({
      entry_date: r.entry_date,
      entry_time: r.entry_time ? r.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(r.created_at),
      product_reference: r.product_reference ?? '',
      product_designation: r.product_designation ?? '',
      quantite_produite: toNum(r.quantite_produite),
      matieres: matieresText(r.matieres),
      cout_total: toNum(r.cout_total),
      cout_unitaire: toNum(r.cout_unitaire),
      observations: r.observations ?? '',
      entered_by_user: r.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }
  const total = sheet.addRow({ entry_date: 'TOTAL', cout_total: rows.reduce((s, r) => s + toNum(r.cout_total), 0) })
  styleTotalsRow(total, AMOUNT_ROW_FILL)

  await save(workbook, filename || `Prodnet_Fabrications_${todayISO()}.xlsx`)
}
