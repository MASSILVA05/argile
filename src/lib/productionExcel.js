import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow, AMOUNT_ROW_FILL } from './excelHelpers'
import { formatDateTime } from './dateFormat'
import { posteLabel, computeTauxCasse, toNum } from './production'

const COLUMNS = [
  { header: 'Date', key: 'entry_date', width: 12 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: 'Équipe', key: 'equipe', width: 8 },
  { header: 'Poste', key: 'poste', width: 14 },
  { header: 'Opérateur', key: 'operateur', width: 18 },
  { header: 'Produit', key: 'produit', width: 9 },
  { header: 'Presse chariots', key: 'presse_chariots', width: 13 },
  { header: 'N° chariots', key: 'presse_numeros', width: 14 },
  { header: 'Pression (bar)', key: 'presse_pression', width: 12 },
  { header: 'Pièces/étage', key: 'presse_pieces_etage', width: 11 },
  { header: 'Étages/chariot', key: 'presse_etages_chariot', width: 12 },
  { header: 'Presse rebutés', key: 'presse_rebutes', width: 12 },
  { header: 'Total pièces pressées', key: 'presse_total_pieces', width: 16 },
  { header: 'Séchoir entrés', key: 'sechoir_entres', width: 12 },
  { header: 'Séchoir sortis', key: 'sechoir_sortis', width: 12 },
  { header: 'Temp. séchoir (°C)', key: 'sechoir_temperature', width: 13 },
  { header: 'Humidité (%)', key: 'sechoir_humidite', width: 11 },
  { header: 'Durée séchage (h)', key: 'sechoir_duree', width: 13 },
  { header: 'Séchoir rebutés', key: 'sechoir_rebutes', width: 12 },
  { header: 'Four enfournés', key: 'four_enfournes', width: 12 },
  { header: 'Four défournés', key: 'four_defournes', width: 12 },
  { header: 'Temp. four (°C)', key: 'four_temperature', width: 12 },
  { header: 'Durée cuisson (h)', key: 'four_duree', width: 13 },
  { header: 'Gaz (m³)', key: 'four_gaz', width: 11 },
  { header: 'Défourn. chariots', key: 'defourn_chariots', width: 13 },
  { header: 'Conformes', key: 'defourn_conformes', width: 11 },
  { header: 'Cassées', key: 'defourn_cassees', width: 10 },
  { header: 'Fissurées', key: 'defourn_fissurees', width: 10 },
  { header: 'Taux casse (%)', key: 'taux_casse', width: 12 },
  { header: 'Paquets', key: 'emballage_paquets', width: 10 },
  { header: 'Pièces/paquet', key: 'emballage_pieces_paquet', width: 12 },
  { header: 'Palettes', key: 'emballage_palettes', width: 10 },
  { header: 'Stock final', key: 'emballage_stock_final', width: 12 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
  { header: 'Remarques presse', key: 'presse_remarques', width: 24 },
  { header: 'Remarques séchoir', key: 'sechoir_remarques', width: 24 },
  { header: 'Remarques four', key: 'four_remarques', width: 24 },
  { header: 'Remarques défourn.', key: 'defourn_remarques', width: 24 },
  { header: 'Remarques emballage', key: 'emballage_remarques', width: 24 },
]

export async function downloadProductionExcel(entries, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Production')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]

  for (const e of entries) {
    const row = sheet.addRow({
      ...e,
      entry_time: e.entry_time ? e.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(e.created_at),
      poste: posteLabel(e.poste),
      operateur: e.operateur ?? '',
      taux_casse: Number(computeTauxCasse(e.defourn_conformes, e.defourn_cassees, e.defourn_fissurees).toFixed(1)),
      presse_numeros: e.presse_numeros ?? '',
      entered_by_user: e.entered_by_user ?? '',
      presse_remarques: e.presse_remarques ?? '',
      sechoir_remarques: e.sechoir_remarques ?? '',
      four_remarques: e.four_remarques ?? '',
      defourn_remarques: e.defourn_remarques ?? '',
      emballage_remarques: e.emballage_remarques ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const sum = (key) => entries.reduce((s, e) => s + toNum(e[key]), 0)
  const totalRow = sheet.addRow({
    entry_date: 'TOTAUX',
    presse_chariots: sum('presse_chariots'),
    presse_rebutes: sum('presse_rebutes'),
    presse_total_pieces: sum('presse_total_pieces'),
    sechoir_rebutes: sum('sechoir_rebutes'),
    four_gaz: sum('four_gaz'),
    defourn_conformes: sum('defourn_conformes'),
    defourn_cassees: sum('defourn_cassees'),
    defourn_fissurees: sum('defourn_fissurees'),
    emballage_paquets: sum('emballage_paquets'),
    emballage_palettes: sum('emballage_palettes'),
  })
  styleTotalsRow(totalRow, AMOUNT_ROW_FILL)
  totalRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Production_${todayISO()}.xlsx`)
}
