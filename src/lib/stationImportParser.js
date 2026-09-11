import { read, utils, SSF } from 'xlsx'

// Lecture du fichier Excel de la station-service. Deux formats gérés :
//
//  1. « ÉTAT DES VENTE » mensuel (le fichier réel "ETAT DES VENTE SARL
//     STATION.xlsx") : un onglet par mois (Feuil1..Feuil7), en-tête
//     DATTE / SANS PLOMB / GASOIL / GAZ BUTAN / TOTAL / sp1 / sp2 / gaz1 /
//     gaz2 / gaz3. Une ligne = un jour, montants agrégés en DA (pas de
//     client, pas de quantité, pas de prix unitaire). On génère des ventes
//     "comptoir" : 1 ligne par jour et par produit, client VENTES COMPTOIR,
//     quantité 1, prix unitaire = recette du jour (=> total_ht = recette),
//     statut Payé. SANS PLOMB -> Essence, GASOIL -> Gasoil (carburant) ;
//     GAZ BUTAN -> table gaz. L'onglet "SUIVIE VERSSEMENT" (trésorerie
//     bancaire) et le bloc paie IRG (colonnes O..Q) sont ignorés.
//
//  2. Format par client (onglets nommés CARBURANT / LUBRIFIANT / GAZ avec
//     colonnes Date, Client, Qté, P.U, Total, Consigne, Payé…). Détection
//     par mots-clés. Conservé pour un éventuel fichier à ce format.

const MAX_HEADER_SCAN_ROWS = 15

// Client fictif attribué aux ventes agrégées (recettes journalières sans
// client nominatif) importées depuis l'état mensuel.
export const COUNTER_CLIENT = 'VENTES COMPTOIR'

function norm(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/[.]/g, '')
}

function isBlankRow(row) {
  return !row || row.every((cell) => cell == null || cell === '')
}

function toNumber(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function excelSerialToISO(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n <= 0) return null
  const parsed = SSF.parse_date_code(n)
  if (!parsed) return null
  const pad = (x) => String(x).padStart(2, '0')
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`
}

function parseDateCell(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return excelSerialToISO(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = `20${y}`
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function paymentStatus(value) {
  const s = norm(value)
  if (!s) return 'Non payé'
  if (s.includes('NON')) return 'Non payé'
  if (s.includes('PAY') || s === 'OUI' || s === 'X') return 'Payé'
  return 'Non payé'
}

function sheetsByName(arrayBuffer) {
  const workbook = read(arrayBuffer, { type: 'array' })
  return workbook.SheetNames.map((name) => ({
    name,
    rows: utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null }),
  }))
}

function findColumns(row, resolve) {
  const columns = {}
  row.forEach((cell, colIndex) => {
    const field = resolve(norm(cell), colIndex)
    if (field && columns[field] === undefined) columns[field] = colIndex
  })
  return columns
}

function findHeader(rows, resolve, required) {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (isBlankRow(rows[i])) continue
    const columns = findColumns(rows[i], resolve)
    if (required.every((f) => columns[f] !== undefined)) return { index: i, columns }
  }
  return null
}

function dataRows(rows, index) {
  return rows.slice(index + 1)
}

// ============================================================
// Format 1 : état des ventes mensuel (fichier réel)
// ============================================================
function resolveEtatVente(h) {
  if (!h) return null
  if (h === 'DATTE' || h === 'DATE') return 'date'
  if (h === 'SANS PLOMB' || h === 'ESSENCE' || h === 'SP') return 'sans_plomb'
  if (h === 'GASOIL' || h === 'GAS OIL' || h === 'DIESEL') return 'gasoil'
  if (h === 'GAZ BUTAN' || h === 'GAZ BUTANE' || h === 'GAZ' || h === 'BUTANE') return 'gaz_butan'
  if (h === 'TOTAL') return 'total'
  return null
}

function parseEtatVente(rows) {
  // En-tête = 1re ligne contenant SANS PLOMB + GASOIL (la colonne date
  // s'appelle "DATTE " dans le fichier, parfois absente du 1er scan).
  const header = findHeader(rows, resolveEtatVente, ['sans_plomb', 'gasoil'])
  if (!header) return null
  const { index, columns } = header
  const dateCol = columns.date ?? 0
  const get = (row, f) => (columns[f] === undefined ? null : row[columns[f]])

  const carburant = []
  const gaz = []

  for (const row of dataRows(rows, index)) {
    if (isBlankRow(row)) continue
    const first = row[dateCol]
    if (typeof first === 'string' && /^\s*TOTAL/i.test(first)) break
    const date = parseDateCell(first)
    if (!date) continue

    const sp = toNumber(get(row, 'sans_plomb'))
    const go = toNumber(get(row, 'gasoil'))
    const gb = toNumber(get(row, 'gaz_butan'))

    if (sp > 0) {
      carburant.push({
        entry_date: date,
        client_name: COUNTER_CLIENT,
        product: 'Essence',
        quantity: 1,
        unit_price: sp,
        payment_status: 'Payé',
        observations: "Recette journalière agrégée (import état des ventes SANS PLOMB)",
      })
    }
    if (go > 0) {
      carburant.push({
        entry_date: date,
        client_name: COUNTER_CLIENT,
        product: 'Gasoil',
        quantity: 1,
        unit_price: go,
        payment_status: 'Payé',
        observations: "Recette journalière agrégée (import état des ventes GASOIL)",
      })
    }
    if (gb > 0) {
      gaz.push({
        entry_date: date,
        client_name: COUNTER_CLIENT,
        product: 'GAZ BUTAN',
        quantity: 1,
        unit_price: gb,
        consigne: 0,
        payment_status: 'Payé',
        observations: "Recette journalière agrégée (import état des ventes GAZ BUTAN)",
      })
    }
  }

  if (carburant.length === 0 && gaz.length === 0) return null
  return { carburant, lubrifiants: [], gaz }
}

// Mois du 1er jour couvert par les ventes de l'onglet (les dates du fichier
// sont fiables, contrairement au titre "MOIS ..." parfois erroné).
function periodFromSales(etat) {
  const dates = [
    ...etat.carburant.map((r) => r.entry_date),
    ...etat.gaz.map((r) => r.entry_date),
  ].filter(Boolean).sort()
  if (dates.length === 0) return null
  return `${dates[0].slice(0, 7)}-01`
}

const FR_MONTHS = [
  ['JANV', '01'], ['FEV', '02'], ['FEB', '02'], ['MARS', '03'], ['MAR', '03'],
  ['AVR', '04'], ['MAI', '05'], ['JUIN', '06'], ['JUIL', '07'], ['AOU', '08'],
  ['SEPT', '09'], ['SEP', '09'], ['OCT', '10'], ['NOV', '11'], ['DEC', '12'],
]

// Repli : "IRG DES SALAIRES MOIS JANVIER 2026 ..." -> "2026-01-01"
function periodFromTitle(rows) {
  for (const row of rows) {
    for (const cell of row ?? []) {
      const h = norm(cell)
      if (!h.includes('IRG DES SALAIRES') && !h.includes('SALAIRES MOIS')) continue
      const yearMatch = h.match(/(20\d{2})/)
      const year = yearMatch ? yearMatch[1] : null
      const after = h.split('MOIS').pop() ?? ''
      for (const [key, mm] of FR_MONTHS) {
        if (after.includes(key)) return year ? `${year}-${mm}-01` : null
      }
    }
  }
  return null
}

// Bloc paie / IRG (colonnes O-Q dans le fichier réel = index 14/15/16) :
//   ligne en-tête  : O = "NOM ET PRENOM", P = "NBR D'HEUR", Q = "SALAIRE NET"
//   lignes données : O = nom, P = heures, Q = salaire net
function parseSalaires(rows, period) {
  if (!period) return []
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? []
    if (cells.some((c) => norm(c).includes('NOM ET PRENOM'))) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const nameCol = (rows[headerIdx] ?? []).findIndex((c) => norm(c).includes('NOM ET PRENOM'))
  const hoursCol = nameCol + 1
  const netCol = nameCol + 2

  const out = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const name = String(row[nameCol] ?? '').trim()
    if (!name) break
    if (/^TOTAL\b/i.test(name) || norm(name).includes('IRG DES SALAIRES')) break
    const hours = toNumber(row[hoursCol])
    const net = toNumber(row[netCol])
    if (hours <= 0 && net <= 0) continue
    out.push({
      period,
      employee_name: name,
      hours,
      net_salary: net,
      observations: 'Import état des ventes (bloc IRG des salaires)',
    })
  }
  return out
}

// ============================================================
// Format 2 : par client (onglets CARBURANT / LUBRIFIANT / GAZ)
// ============================================================
function resolveCarburant(h) {
  if (!h) return null
  if (h === 'DATE' || h === 'DATTE') return 'date'
  if (h === 'CLIENT' || h.includes('NOM CLIENT')) return 'client'
  const isGasoil = h.includes('GASOIL') || h.includes('GAS OIL') || h.includes('DIESEL')
  const isEssence = h.includes('ESSENCE') || h.includes('SANS PLOMB') || h === 'SP'
  const kind = isGasoil ? 'gasoil' : isEssence ? 'essence' : null
  if (kind) {
    if (h.includes('QT') || h.includes('LITRE') || h.includes('VOL')) return `${kind}_qty`
    if (h.includes('PU') || h.includes('PRIX') || h.includes('UNITAIRE')) return `${kind}_pu`
    if (h.includes('TOTAL') || h.includes('MONTANT')) return `${kind}_total`
  }
  if (h.includes('PAY') || h.includes('REGL') || h.includes('STATUT')) return 'payment'
  return null
}

function parseCarburant(rows) {
  const header = findHeader(rows, resolveCarburant, ['date', 'client'])
  if (!header) return []
  const { index, columns } = header
  const get = (row, f) => (columns[f] === undefined ? null : row[columns[f]])
  const out = []
  for (const row of dataRows(rows, index)) {
    if (isBlankRow(row)) continue
    const date = parseDateCell(get(row, 'date'))
    const client = String(get(row, 'client') ?? '').trim()
    if (!client || /^TOTAL\b/i.test(client)) continue
    const status = paymentStatus(get(row, 'payment'))
    for (const kind of ['gasoil', 'essence']) {
      const qty = toNumber(get(row, `${kind}_qty`))
      const total = toNumber(get(row, `${kind}_total`))
      let pu = toNumber(get(row, `${kind}_pu`))
      if (!pu && qty && total) pu = total / qty
      if (qty <= 0 && total <= 0) continue
      out.push({
        entry_date: date,
        client_name: client,
        product: kind === 'gasoil' ? 'Gasoil' : 'Essence',
        quantity: qty || (pu ? total / pu : 0),
        unit_price: pu,
        payment_status: status,
      })
    }
  }
  return out
}

function resolveLub(h) {
  if (!h) return null
  if (h === 'DATE' || h === 'DATTE') return 'date'
  if (h === 'CLIENT' || h.includes('NOM CLIENT')) return 'client'
  if (h.includes('DESIGNATION') || h.includes('DÉSIGNATION') || h.includes('PRODUIT') || h.includes('ARTICLE')) return 'product'
  if (h.includes('UNITE') || h.includes('UNITÉ') || h === 'U') return 'unit'
  if (h.includes('QT') || h === 'NBR') return 'quantity'
  if ((h.includes('PU') || h.includes('PRIX') || h.includes('UNITAIRE')) && !h.includes('TOTAL')) return 'unit_price'
  if (h.includes('TOTAL') || h.includes('MONTANT')) return 'total'
  if (h.includes('PAY') || h.includes('REGL') || h.includes('STATUT')) return 'payment'
  return null
}

function parseLubrifiant(rows) {
  const header = findHeader(rows, resolveLub, ['client', 'product'])
  if (!header) return []
  const { index, columns } = header
  const get = (row, f) => (columns[f] === undefined ? null : row[columns[f]])
  const out = []
  for (const row of dataRows(rows, index)) {
    if (isBlankRow(row)) continue
    const client = String(get(row, 'client') ?? '').trim()
    const product = String(get(row, 'product') ?? '').trim()
    if (!client || !product || /^TOTAL\b/i.test(client)) continue
    const qty = toNumber(get(row, 'quantity'))
    const total = toNumber(get(row, 'total'))
    let pu = toNumber(get(row, 'unit_price'))
    if (!pu && qty && total) pu = total / qty
    if (qty <= 0 && total <= 0) continue
    out.push({
      entry_date: parseDateCell(get(row, 'date')),
      client_name: client,
      product,
      quantity: qty || (pu ? total / pu : 0),
      unit: String(get(row, 'unit') ?? '').trim() || 'L',
      unit_price: pu,
      payment_status: paymentStatus(get(row, 'payment')),
    })
  }
  return out
}

function resolveGaz(h) {
  if (!h) return null
  if (h === 'DATE' || h === 'DATTE') return 'date'
  if (h === 'CLIENT' || h.includes('NOM CLIENT')) return 'client'
  if (h.includes('PRODUIT') || h.includes('DESIGNATION') || h.includes('DÉSIGNATION') || h.includes('TYPE') || h.includes('BOUTEILLE')) return 'product'
  if (h.includes('CONSIGNE')) return 'consigne'
  if (h.includes('QT') || h === 'NBR' || h.includes('NOMBRE')) return 'quantity'
  if ((h.includes('PU') || h.includes('PRIX') || h.includes('UNITAIRE')) && !h.includes('TOTAL')) return 'unit_price'
  if (h.includes('TOTAL') || h.includes('MONTANT')) return 'total'
  if (h.includes('PAY') || h.includes('REGL') || h.includes('STATUT')) return 'payment'
  return null
}

function parseGaz(rows) {
  const header = findHeader(rows, resolveGaz, ['client', 'product'])
  if (!header) return []
  const { index, columns } = header
  const get = (row, f) => (columns[f] === undefined ? null : row[columns[f]])
  const out = []
  for (const row of dataRows(rows, index)) {
    if (isBlankRow(row)) continue
    const client = String(get(row, 'client') ?? '').trim()
    const product = String(get(row, 'product') ?? '').trim()
    if (!client || !product || /^TOTAL\b/i.test(client)) continue
    const qty = Math.round(toNumber(get(row, 'quantity')))
    const total = toNumber(get(row, 'total'))
    let pu = toNumber(get(row, 'unit_price'))
    if (!pu && qty && total) pu = total / qty
    if (qty <= 0 && total <= 0) continue
    out.push({
      entry_date: parseDateCell(get(row, 'date')),
      client_name: client,
      product,
      quantity: qty || (pu ? Math.round(total / pu) : 0),
      unit_price: pu,
      consigne: toNumber(get(row, 'consigne')),
      payment_status: paymentStatus(get(row, 'payment')),
    })
  }
  return out
}

export function parseStationFile(arrayBuffer) {
  const sheets = sheetsByName(arrayBuffer)
  const result = { carburant: [], lubrifiants: [], gaz: [], salaires: [] }

  for (const { name, rows } of sheets) {
    const n = norm(name)

    // Onglet trésorerie bancaire : sans objet pour la station.
    if (n.includes('VERSSEMENT') || n.includes('VERSEMENT')) continue

    // Format 1 : état des ventes mensuel (SANS PLOMB / GASOIL / GAZ BUTAN)
    // + bloc paie IRG des salaires (colonnes O-Q).
    const etat = parseEtatVente(rows)
    if (etat) {
      result.carburant.push(...etat.carburant)
      result.gaz.push(...etat.gaz)
      const period = periodFromSales(etat) || periodFromTitle(rows)
      result.salaires.push(...parseSalaires(rows, period))
      continue
    }

    // Format 2 : onglets par client.
    if (n.includes('CARBURANT')) result.carburant.push(...parseCarburant(rows))
    else if (n.includes('LUBRIFIANT') || n.includes('HUILE')) result.lubrifiants.push(...parseLubrifiant(rows))
    else if (n.includes('GAZ') || n.includes('GAS BUTAN')) result.gaz.push(...parseGaz(rows))
  }

  return result
}
