// Import ponctuel de l'historique clients depuis Situation_Globale.xlsx vers
// Supabase (tables `clients` et `client_yearly_stats`).
//
// À exécuter UNE SEULE FOIS (ré-exécutable sans risque ensuite : upsert sur
// `name` / `(client_id, year)`, donc relancer le script met juste à jour les
// mêmes lignes plutôt que d'en créer des doublons).
//
// Usage :
//   node --env-file=.env scripts/import-situations.js
//
// Nécessite dans .env (jamais préfixées VITE_ : ces valeurs ne doivent
// jamais être bundlées côté client) :
//   SUPABASE_URL=https://xxxx.supabase.co   (ou VITE_SUPABASE_URL, déjà présent)
//   SUPABASE_SERVICE_ROLE_KEY=...            (clé service_role, PAS la clé anon)

import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')
const XLSX_PATH = path.join(PROJECT_ROOT, 'Situation_Globale.xlsx')

// Onglet Chiffre_Affaires_Clients : colonnes 2 à 5 = années 2022..2025.
// 2024 est volontairement exclue (données sources incomplètes/suspectes,
// voir Situation_2024.xlsx qui n'est jamais lu par ce script).
const YEAR_COLUMNS = { 2022: 2, 2023: 3, 2025: 5 }
const BATCH_SIZE = 200

function requireEnv(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : undefined)
  if (!value) {
    console.error(`Variable d'environnement manquante : ${name}${fallbackName ? ` (ou ${fallbackName})` : ''}`)
    process.exit(1)
  }
  return value
}

const SUPABASE_URL = requireEnv('SUPABASE_URL', 'VITE_SUPABASE_URL')
const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Une cellule ExcelJS peut contenir soit une valeur brute, soit un objet
// formule { result, ... } : on ne garde que la valeur exploitable.
function cellNumber(cell) {
  const value = cell?.value
  if (value == null) return 0
  if (typeof value === 'object' && 'result' in value) return Number(value.result) || 0
  return Number(value) || 0
}

function cellText(cell) {
  const value = cell?.value
  if (value == null) return ''
  if (typeof value === 'object' && 'result' in value) return String(value.result).trim()
  return String(value).trim()
}

async function loadWorkbook() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(XLSX_PATH)
  return workbook
}

function readImpayesGlobaux(workbook) {
  const sheet = workbook.getWorksheet('Impayes_Globaux')
  if (!sheet) throw new Error("Onglet 'Impayes_Globaux' introuvable dans Situation_Globale.xlsx")

  const header = sheet.getRow(1).values
  console.log('  En-têtes Impayes_Globaux :', header.slice(1))

  const rows = new Map() // dédoublonne par nom (dernière occurrence gagne)
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const name = cellText(row.getCell(1))
    if (!name) return
    rows.set(name, {
      name,
      total_invoiced: cellNumber(row.getCell(2)),
      total_paid: cellNumber(row.getCell(3)),
      balance: cellNumber(row.getCell(4)),
      source: 'import_historique',
    })
  })
  return [...rows.values()]
}

function readChiffreAffairesClients(workbook) {
  const sheet = workbook.getWorksheet('Chiffre_Affaires_Clients')
  if (!sheet) throw new Error("Onglet 'Chiffre_Affaires_Clients' introuvable dans Situation_Globale.xlsx")

  const header = sheet.getRow(1).values
  console.log('  En-têtes Chiffre_Affaires_Clients :', header.slice(1))

  // name -> { 2022: amount, 2023: amount, 2025: amount }
  const byClient = new Map()
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const name = cellText(row.getCell(1))
    if (!name) return
    const yearly = {}
    for (const [year, col] of Object.entries(YEAR_COLUMNS)) {
      yearly[year] = cellNumber(row.getCell(col))
    }
    byClient.set(name, yearly)
  })
  return byClient
}

function chunk(array, size) {
  const out = []
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))
  return out
}

async function upsertClients(clientRows) {
  let imported = 0
  let errors = 0
  for (const batch of chunk(clientRows, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('clients')
      .upsert(batch, { onConflict: 'name' })
      .select('id, name')
    if (error) {
      console.error(`  Erreur upsert clients (lot de ${batch.length}) :`, error.message)
      errors += batch.length
      continue
    }
    imported += data.length
  }
  return { imported, errors }
}

async function fetchClientIdsByName(names) {
  const map = new Map()
  for (const batch of chunk(names, BATCH_SIZE)) {
    const { data, error } = await supabase.from('clients').select('id, name').in('name', batch)
    if (error) {
      console.error('  Erreur lecture clients pour rattachement stats annuelles :', error.message)
      continue
    }
    for (const row of data) map.set(row.name, row.id)
  }
  return map
}

async function upsertYearlyStats(caByClient, clientIdByName) {
  const rows = []
  let unmatched = 0
  for (const [name, yearly] of caByClient.entries()) {
    const clientId = clientIdByName.get(name)
    if (!clientId) {
      unmatched += 1
      continue
    }
    for (const [year, amount] of Object.entries(yearly)) {
      rows.push({ client_id: clientId, year: Number(year), amount })
    }
  }

  let imported = 0
  let errors = 0
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('client_yearly_stats')
      .upsert(batch, { onConflict: 'client_id,year' })
      .select('id')
    if (error) {
      console.error(`  Erreur upsert client_yearly_stats (lot de ${batch.length}) :`, error.message)
      errors += batch.length
      continue
    }
    imported += data.length
  }
  return { imported, errors, unmatched }
}

async function main() {
  console.log(`Lecture de ${XLSX_PATH}...`)
  const workbook = await loadWorkbook()

  console.log("\nExtraction 'Impayes_Globaux'...")
  const clientRows = readImpayesGlobaux(workbook)
  console.log(`  ${clientRows.length} clients trouvés.`)

  console.log("\nExtraction 'Chiffre_Affaires_Clients' (2022, 2023, 2025 -- 2024 exclue)...")
  const caByClient = readChiffreAffairesClients(workbook)
  console.log(`  ${caByClient.size} clients avec CA annuel trouvés.`)

  console.log('\nImport dans `clients`...')
  const clientsResult = await upsertClients(clientRows)
  console.log(`  ${clientsResult.imported} clients importés, ${clientsResult.errors} erreurs.`)

  console.log('\nRattachement des stats annuelles aux clients importés...')
  const clientIdByName = await fetchClientIdsByName([...caByClient.keys()])

  console.log('Import dans `client_yearly_stats`...')
  const statsResult = await upsertYearlyStats(caByClient, clientIdByName)
  console.log(`  ${statsResult.imported} lignes de stats annuelles importées, ${statsResult.errors} erreurs.`)
  if (statsResult.unmatched > 0) {
    console.log(
      `  ${statsResult.unmatched} clients présents dans Chiffre_Affaires_Clients mais absents d'Impayes_Globaux ` +
        `(pas de ligne 'clients' correspondante) : leurs stats annuelles ont été ignorées.`
    )
  }

  console.log('\n=== Résumé ===')
  console.log(`Clients importés     : ${clientsResult.imported} (${clientsResult.errors} erreurs)`)
  console.log(`Stats annuelles      : ${statsResult.imported} (${statsResult.errors} erreurs, ${statsResult.unmatched} clients ignorés)`)
}

main().catch((err) => {
  console.error('\nÉchec de l\'import :', err)
  process.exit(1)
})
