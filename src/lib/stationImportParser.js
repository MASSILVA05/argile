import { read, utils, SSF } from 'xlsx'

// Lecture du fichier Excel de la station-service. On détecte les onglets par
// leur nom (contient CARBURANT / LUBRIFIANT / GAZ) puis on repère la ligne
// d'en-tête par mots-clés (elle n'est pas forcément la 1re ligne).
//
//  - CARBURANT : Date, Client, Gasoil (Qté / P.U / Total), Essence (Qté /
//    P.U / Total), Payé/Non payé -> jusqu'à 2 lignes par ligne source
//  - LUBRIFIANT : Date, Client, Désignation, Qté, [Unité], P.U, Total, Payé
//  - GAZ : Date, Client, Produit, Qté, P.U, Total, Consigne, Payé
//
// Le fichier "ETAT DES VENTE SARL STATION.xlsx" fourni comme test ne
// contient PAS ces onglets (états mensuels par pompe) : l'import renverra
// alors des listes vides et un message "aucun onglet reconnu".

const MAX_HEADER_SCAN_ROWS = 15

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

// Repère, pour chaque colonne, à quel champ elle correspond via `resolve`
// (fonction (normalizedHeader, colIndex) => field | null). Renvoie la 1re
// ligne (dans les 15 premières) qui contient au moins `required` champs.
function findHeader(rows, resolve, required) {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    if (isBlankRow(rows[i])) continue
    const columns = {}
    rows[i].forEach((cell, colIndex) => {
      const field = resolve(norm(cell), colIndex)
      if (field && columns[field] === undefined) columns[field] = colIndex
    })
    if (required.every((f) => columns[f] !== undefined)) return { index: i, columns }
  }
  return null
}

function dataRows(rows, index) {
  return rows.slice(index + 1).filter((row) => !isBlankRow(row))
}

// ---------- CARBURANT ----------
function resolveCarburant(h) {
  if (!h) return null
  if (h === 'DATE' || h === 'DATTE') return 'date'
  if (h === 'CLIENT' || h.includes('NOM CLIENT')) return 'client'
  const isGasoil = h.includes('GASOIL') || h.includes('GAS OIL') || h.includes('DIESEL')
  const isEssence = h.includes('ESSENCE') || h.includes('SANS PLOMB') || h.includes('SP')
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

// ---------- LUBRIFIANT ----------
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

// ---------- GAZ ----------
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
  const result = { carburant: [], lubrifiants: [], gaz: [] }
  for (const { name, rows } of sheets) {
    const n = norm(name)
    if (n.includes('CARBURANT')) result.carburant.push(...parseCarburant(rows))
    else if (n.includes('LUBRIFIANT') || n.includes('HUILE')) result.lubrifiants.push(...parseLubrifiant(rows))
    else if (n.includes('GAZ') || n.includes('GAS BUTAN')) result.gaz.push(...parseGaz(rows))
  }
  return result
}
