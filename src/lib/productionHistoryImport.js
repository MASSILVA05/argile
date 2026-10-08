// Import de l'historique mensuel de production depuis un fichier HTML
// (ex : production-briqueterie.html, janvier → septembre 2026).
//
// Le parseur est volontairement tolérant sur la mise en page :
//   - mois en LIGNES (1ère cellule = « Janvier », « 01/2026 », « 2026-01 »…)
//     et indicateurs en colonnes, OU l'inverse (mois en en-têtes de colonnes) ;
//   - la section (Presse / Séchoir / Four / Défournement / Emballage) est lue
//     dans le titre qui précède le tableau (h1–h6, caption), dans une ligne
//     intercalaire « Presse », ou dans l'en-tête lui-même (« Four — gaz ») ;
//   - le produit (B8 / B12) est lu au même endroit, sinon le produit par
//     défaut choisi dans l'aperçu s'applique.
// Une ligne importée = un mois × un produit (équipe / poste vides), avec une
// import_key « histo-AAAA-MM-PRODUIT » qui sert de clé d'upsert.

import { DEFAULT_ETAGES_CHARIOT, defaultPiecesEtage } from './production'

const MOIS = [
  ['janvier', 'janv', 'jan'],
  ['fevrier', 'fevr', 'fev'],
  ['mars', 'mar'],
  ['avril', 'avr'],
  ['mai'],
  ['juin'],
  ['juillet', 'juil'],
  ['aout'],
  ['septembre', 'sept', 'sep'],
  ['octobre', 'oct'],
  ['novembre', 'nov'],
  ['decembre', 'dec'],
]

export const MOIS_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const SECTION_WORDS = [
  ['presse', ['presse', 'mouleuse', 'moulage', 'extrudeuse']],
  ['sechoir', ['sechoir', 'sechage']],
  ['defourn', ['defournement', 'depilage', 'triage', 'qualite']],
  ['four', ['four', 'cuisson']],
  ['emballage', ['emballage', 'conditionnement', 'expedition']],
]

const TEXT_KEYS = new Set(['presse_moule', 'presse_arrets', 'four_combustible', 'emballage_type', 'emballage_destination'])

// Colonnes integer de production_entries (valeurs arrondies à l'import).
const INT_KEYS = new Set([
  'presse_chariots', 'presse_rebutes', 'presse_qte_rangee', 'presse_pieces_etage', 'presse_etages_chariot',
  'sechoir_entres', 'sechoir_sortis', 'sechoir_rebutes', 'four_enfournes', 'four_defournes',
  'defourn_chariots', 'defourn_conformes', 'defourn_cassees', 'defourn_fissurees',
  'defourn_premier_choix', 'defourn_deuxieme_choix', 'defourn_rebut',
  'emballage_paquets', 'emballage_pieces_paquet', 'emballage_palettes', 'emballage_stock_final',
])

// Lignes de synthèse à ignorer (« Total », « Cumul annuel »… mais pas
// « Total pièces pressées », qui est un indicateur).
const SKIP_ROW = /^(total|totaux|cumul|moyenne|moy\.?|somme|ecart)( general| annuel| 20\d{2})?$/

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// « 12 345 », « 1.234,5 », « 85 % », « 1 234 m³ » -> nombre (null si absent).
export function parseNumber(text) {
  let s = String(text ?? '').replace(/[\s  ]/g, '')
  const m = s.match(/-?[\d.,]+/)
  if (!m) return null
  s = m[0]
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Mois d'un libellé : { month: 1..12, year|null } ou null.
export function parseMonth(text) {
  const t = normalize(text)
  if (!t) return null
  let m = t.match(/^(\d{4})[-/.](\d{1,2})$/)
  if (m) return valid(Number(m[2]), Number(m[1]))
  m = t.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (m) return valid(Number(m[1]), Number(m[2]))
  const year = t.match(/\b(20\d{2})\b/)?.[1]
  const first = t.split(/[\s\-/.'’]+/)[0]
  for (let i = 0; i < MOIS.length; i++) {
    if (MOIS[i].includes(first)) return { month: i + 1, year: year ? Number(year) : null }
  }
  return null
  function valid(month, y) {
    return month >= 1 && month <= 12 ? { month, year: y } : null
  }
}

function detectSection(text) {
  const t = normalize(text)
  for (const [id, words] of SECTION_WORDS) {
    if (words.some((w) => new RegExp(`\\b${w}`).test(t))) return id
  }
  return null
}

function detectProduit(text) {
  const t = normalize(text)
  if (/\bb\s?12\b/.test(t)) return 'B12'
  if (/\bb\s?8\b/.test(t)) return 'B8'
  return null
}

const has = (t, ...words) => words.every((w) => t.includes(w))
const any = (t, ...words) => words.some((w) => t.includes(w))

// En-tête (normalisé) + section -> colonne production_entries (ou null).
export function mapField(header, sectionHint) {
  const t = normalize(header)
  if (!t) return null
  if (any(t, 'total pieces', 'pieces pressees', 'pieces produites', 'production totale')) return '__presse_total'
  const section = detectSection(t) ?? sectionHint

  // Indicateurs sans ambiguïté, quelle que soit la section.
  if (any(t, 'enfourn')) return 'four_enfournes'
  if (any(t, 'gaz', 'm3', 'm³') && !any(t, 'pression')) return 'four_gaz'
  if (any(t, 'combustible')) return 'four_combustible'
  if (any(t, 'prechauf')) return 'four_temp_prechauffe'
  if (any(t, 'refroid')) return 'four_temp_refroid'
  if (any(t, '1er choix', 'premier choix', '1 er choix', '1ere')) return 'defourn_premier_choix'
  if (any(t, '2eme choix', '2e choix', 'deuxieme choix', '2 eme')) return 'defourn_deuxieme_choix'
  if (any(t, 'conform')) return 'defourn_conformes'
  if (any(t, 'cass')) return 'defourn_cassees'
  if (any(t, 'fissur')) return 'defourn_fissurees'
  if (any(t, 'moule') && !any(t, 'mouleuse')) return 'presse_moule'
  if (any(t, 'rangee')) return 'presse_qte_rangee'
  if (any(t, 'cycle')) return 'presse_temps_cycle'
  if (any(t, 'arret')) return 'presse_arrets'
  if (has(t, 'paquet') && any(t, 'piece')) return 'emballage_pieces_paquet'
  if (any(t, 'paquet')) return 'emballage_paquets'
  if (has(t, 'palette') && any(t, 'poids', 'kg')) return 'emballage_poids_palette'
  if (any(t, 'palette')) return 'emballage_palettes'
  if (any(t, 'destination')) return 'emballage_destination'
  if (any(t, 'stock')) return 'emballage_stock_final'
  if (has(t, 'humid') && any(t, 'entree', 'entre')) return 'sechoir_humidite_entree'
  if (has(t, 'humid') && any(t, 'sortie', 'sorti')) return 'sechoir_humidite_sortie'
  if (any(t, 'humid')) return 'sechoir_humidite'
  if (any(t, 'zone 1', 'zone1')) return 'sechoir_temp_zone1'
  if (any(t, 'zone 2', 'zone2')) return 'sechoir_temp_zone2'
  if (any(t, 'pieces par etage', 'pieces/etage', 'pieces etage')) return 'presse_pieces_etage'
  if (any(t, 'etages')) return 'presse_etages_chariot'

  switch (section) {
    case 'presse':
      if (any(t, 'rebut')) return 'presse_rebutes'
      if (any(t, 'pression')) return 'presse_pression'
      if (any(t, 'chariot', 'quantite', 'nombre', 'nbre', 'production')) return 'presse_chariots'
      if (any(t, 'remarque', 'observation')) return 'presse_remarques'
      return null
    case 'sechoir':
      if (any(t, 'rebut')) return 'sechoir_rebutes'
      if (any(t, 'entr')) return 'sechoir_entres'
      if (any(t, 'sort')) return 'sechoir_sortis'
      if (any(t, 'temp')) return 'sechoir_temperature'
      if (any(t, 'duree', 'temps', 'heure')) return 'sechoir_duree'
      if (any(t, 'remarque', 'observation')) return 'sechoir_remarques'
      return null
    case 'four':
      if (any(t, 'defourn', 'sorti')) return 'four_defournes'
      if (any(t, 'pression')) return 'four_pression'
      if (any(t, 'cuisson') && any(t, 'temp')) return 'four_temp_cuisson'
      if (any(t, 'temp')) return 'four_temperature'
      if (any(t, 'duree', 'heure')) return 'four_duree'
      if (any(t, 'remarque', 'observation')) return 'four_remarques'
      return null
    case 'defourn':
      if (any(t, 'rebut')) return 'defourn_rebut'
      if (any(t, 'chariot', 'wagon')) return 'defourn_chariots'
      if (any(t, 'remarque', 'observation')) return 'defourn_remarques'
      return null
    case 'emballage':
      if (any(t, 'type')) return 'emballage_type'
      if (any(t, 'remarque', 'observation')) return 'emballage_remarques'
      return null
    default:
      if (any(t, 'defourn')) return 'four_defournes'
      return null
  }
}

function cellText(cell) {
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// Texte du titre le plus proche avant le tableau (h1–h6 / caption / legend).
function contextBefore(table) {
  const parts = []
  const caption = table.querySelector('caption')
  if (caption) parts.push(cellText(caption))
  let node = table
  for (let depth = 0; node && depth < 6 && parts.length < 3; depth++) {
    let prev = node.previousElementSibling
    while (prev && parts.length < 3) {
      if (/^H[1-6]$/.test(prev.tagName) || prev.tagName === 'LEGEND' || prev.matches?.('.title, .titre, [class*="section"]')) {
        parts.push(cellText(prev))
        break
      }
      if (prev.querySelector?.('h1,h2,h3,h4,h5,h6')) {
        const hs = prev.querySelectorAll('h1,h2,h3,h4,h5,h6')
        parts.push(cellText(hs[hs.length - 1]))
        break
      }
      prev = prev.previousElementSibling
    }
    if (parts.length) break
    node = node.parentElement
  }
  return parts.join(' · ')
}

// Grille du tableau avec rowspan/colspan dépliés.
function tableGrid(table) {
  const grid = []
  const rows = [...table.querySelectorAll('tr')]
  rows.forEach((tr, r) => {
    grid[r] = grid[r] ?? []
    let c = 0
    for (const cell of tr.children) {
      while (grid[r][c] != null) c++
      const text = cellText(cell)
      const cs = Math.max(1, Number(cell.getAttribute('colspan')) || 1)
      const rs = Math.max(1, Number(cell.getAttribute('rowspan')) || 1)
      for (let i = 0; i < rs; i++) {
        grid[r + i] = grid[r + i] ?? []
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = text
      }
      c += cs
    }
  })
  return grid.map((row) => row.map((v) => v ?? ''))
}

function headerDepth(grid) {
  // Lignes d'en-tête = tant que la 1ère colonne ne contient pas de mois.
  let depth = 0
  while (depth < grid.length && depth < 3 && !parseMonth(grid[depth][0])) depth++
  return Math.max(1, depth)
}

/**
 * Parse le HTML et renvoie { records, warnings, year }.
 * records : [{ key, month, year, produit, fields: {col: value}, sources: [...] }]
 */
export function parseProductionHistoryHtml(html, { defaultYear = 2026, defaultProduit = 'B8' } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const docYear = Number(normalize(doc.title + ' ' + (doc.querySelector('h1')?.textContent ?? '')).match(/\b(20\d{2})\b/)?.[1])
  const year = Number.isFinite(docYear) && docYear > 2000 ? docYear : defaultYear
  const warnings = []
  const byKey = new Map()
  const unmapped = new Set()

  function put(monthInfo, produit, field, raw, source) {
    if (!field) return
    const y = monthInfo.year ?? year
    const prod = produit ?? defaultProduit
    const key = `${y}-${String(monthInfo.month).padStart(2, '0')}-${prod}`
    const rec = byKey.get(key) ?? { key, month: monthInfo.month, year: y, produit: prod, fields: {}, sources: new Set() }
    const value = TEXT_KEYS.has(field) || field.endsWith('_remarques') ? String(raw).trim() || null : parseNumber(raw)
    if (value == null) return
    // Si plusieurs tableaux donnent la même colonne, la dernière valeur lue gagne.
    rec.fields[field] = value
    rec.sources.add(source)
    byKey.set(key, rec)
  }

  doc.querySelectorAll('table').forEach((table, tIndex) => {
    const grid = tableGrid(table)
    if (grid.length < 2) return
    const context = contextBefore(table)
    const tableSection = detectSection(context)
    const tableProduit = detectProduit(context)
    const source = context || `Tableau ${tIndex + 1}`

    const depth = headerDepth(grid)
    const firstColMonths = grid.slice(depth).filter((r) => parseMonth(r[0])).length

    if (firstColMonths > 0) {
      // Mois en lignes : en-têtes = concaténation des lignes d'en-tête.
      const width = Math.max(...grid.map((r) => r.length))
      const headers = []
      for (let c = 0; c < width; c++) {
        const parts = []
        for (let r = 0; r < depth; r++) {
          const v = grid[r]?.[c] ?? ''
          if (v && !parts.includes(v)) parts.push(v)
        }
        headers[c] = parts.join(' ')
      }
      let rowSection = tableSection
      for (const row of grid.slice(depth)) {
        const label = row[0]
        if (SKIP_ROW.test(normalize(label))) continue
        const monthInfo = parseMonth(label)
        if (!monthInfo) {
          rowSection = detectSection(label) ?? rowSection
          continue
        }
        const rowProduit = detectProduit(label) ?? tableProduit
        for (let c = 1; c < row.length; c++) {
          const h = headers[c]
          if (/^produit/.test(normalize(h))) continue
          const produit = detectProduit(h) ?? detectProduit(row.find((v, i) => /^produit/.test(normalize(headers[i]))) ?? '') ?? rowProduit
          const field = mapField(h, detectSection(h) ?? rowSection)
          if (!field) {
            if (h) unmapped.add(h)
            continue
          }
          put(monthInfo, produit, field, row[c], source)
        }
      }
      return
    }

    // Mois en colonnes : chercher la ligne d'en-tête qui contient des mois.
    const headerRow = grid.findIndex((r) => r.filter((v) => parseMonth(v)).length >= 2)
    if (headerRow < 0) return
    const monthCols = grid[headerRow].map((v) => parseMonth(v))
    let rowSection = tableSection
    for (const row of grid.slice(headerRow + 1)) {
      const label = row[0]
      if (SKIP_ROW.test(normalize(label))) continue
      const nonEmpty = row.filter((v) => v).length
      const sec = detectSection(label)
      if (sec && (nonEmpty <= 1 || new Set(row).size === 1)) {
        rowSection = sec
        continue
      }
      const field = mapField(label, sec ?? rowSection)
      if (!field) {
        if (label) unmapped.add(label)
        continue
      }
      const produit = detectProduit(label) ?? tableProduit
      row.forEach((v, c) => {
        if (c > 0 && monthCols[c]) put(monthCols[c], produit, field, v, source)
      })
    }
  })

  if (unmapped.size) {
    warnings.push(`Colonnes non reconnues (ignorées) : ${[...unmapped].slice(0, 15).join(', ')}${unmapped.size > 15 ? '…' : ''}`)
  }

  const records = [...byKey.values()]
    .map((r) => ({ ...r, sources: [...r.sources] }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  return { records, warnings, year }
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Record parsé -> ligne production_entries pour production_import_history.
export function recordToEntry(rec, { dateMode = 'last', enteredBy = null } = {}) {
  const day = dateMode === 'first' ? 1 : lastDayOfMonth(rec.year, rec.month)
  const entry = {
    import_key: `histo-${rec.key}`,
    entry_date: `${rec.year}-${String(rec.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    produit: rec.produit,
    entered_by_user: enteredBy,
    presse_pieces_etage: defaultPiecesEtage(rec.produit),
    presse_etages_chariot: DEFAULT_ETAGES_CHARIOT,
  }
  const notes = []
  for (const [k, v] of Object.entries(rec.fields)) {
    if (k === '__presse_total') continue
    entry[k] = INT_KEYS.has(k) && typeof v === 'number' ? Math.round(v) : v
  }
  // presse_total_pieces est une colonne calculée (chariots × étages × pièces) :
  // un total de pièces fourni seul est converti en chariots équivalents.
  const total = rec.fields.__presse_total
  if (total != null) {
    const parChariot = entry.presse_etages_chariot * entry.presse_pieces_etage
    if (entry.presse_chariots > 0) {
      entry.presse_pieces_etage = Math.round(total / (entry.presse_chariots * entry.presse_etages_chariot))
    } else if (parChariot > 0) {
      entry.presse_chariots = Math.round(total / parChariot)
      notes.push(`chariots estimés depuis ${Math.round(total)} pièces`)
    }
  }
  entry.presse_remarques = [entry.presse_remarques, notes.length ? `Import historique : ${notes.join(', ')}` : null]
    .filter(Boolean)
    .join(' — ') || 'Import historique mensuel'
  return entry
}
