// Import ponctuel des totaux 2026 (fichier de saisie manuelle brut) vers la
// table `clients` : ajoute le chiffre d'affaires et les règlements 2026 par
// client au-dessus du solde historique déjà importé (import-situations.js).
//
// IMPORTANT — ce script ADDITIONNE sur les valeurs existantes de `clients`
// (total_invoiced += ..., total_paid += ...) : à ne lancer qu'UNE SEULE FOIS
// pour un même fichier source. Le relancer une deuxième fois avec le même
// contenu Excel additionnerait les montants 2026 une deuxième fois (double
// comptage). "Upsert" garantit seulement qu'un client absent de `clients`
// est créé proprement (pas d'erreur de contrainte unique, pas de doublon) —
// pas que les montants ajoutés sont eux-mêmes idempotents. Le log
// AVANT/APRÈS imprimé pour chaque client permet de repérer immédiatement un
// double comptage si le script est relancé par erreur.
//
// Usage :
//   node --env-file=.env scripts/import-situation-2026.js
//
// Nécessite dans .env (jamais préfixée VITE_) :
//   SUPABASE_URL=https://xxxx.supabase.co   (ou VITE_SUPABASE_URL, déjà présent)
//   SUPABASE_SERVICE_ROLE_KEY=...            (clé service_role, PAS la clé anon)

import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')
const XLSX_PATH = path.join(PROJECT_ROOT, 'SITUATION JOURNALIERE 2026.xlsx')
const SHEET_NAME = 'SITUATION'
const BATCH_SIZE = 200

// Colonnes de l'onglet SITUATION (en-tête sur 2 lignes fusionnées) :
// B=Nom/Raison sociale, C=Désignation, D=BL N°, I=MONTANT, K=REGLEMENT, L=DECAISSEMENT
const COL = { NAME: 2, DESIGNATION: 3, BL_NUMBER: 4, MONTANT: 9, REGLEMENT: 11, DECAISSEMENT: 12 }

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

// "649 SARL JH BATI BEST CONSTRUCTION" -> "SARL JH BATI BEST CONSTRUCTION"
// "291SARL AKSIL CONSTRUCTION" (code collé, sans espace) -> "SARL AKSIL CONSTRUCTION"
function normalizeClientName(raw) {
  return raw.replace(/^\d+\s*/, '').trim().toUpperCase()
}

function isNoiseRow(nameCell, designationCell, blCell) {
  if (typeof nameCell !== 'string' || typeof designationCell !== 'string' || !blCell) return true
  const upper = nameCell.trim().toUpperCase()
  if (!upper) return true
  if (upper.startsWith('TOTAL')) return true
  if (upper.includes('VISA')) return true
  return false
}

async function loadWorkbook() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(XLSX_PATH)
  return workbook
}

function readSituationSheet(workbook) {
  const sheet = workbook.getWorksheet(SHEET_NAME)
  if (!sheet) throw new Error(`Onglet '${SHEET_NAME}' introuvable dans ${path.basename(XLSX_PATH)}`)

  const byClient = new Map() // normalizedName -> { invoiced, paid, rawNames: Set }
  let dataRows = 0
  let skippedRows = 0

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const nameCell = row.getCell(COL.NAME).value
    const designationCell = row.getCell(COL.DESIGNATION).value
    const blCell = row.getCell(COL.BL_NUMBER).value

    if (isNoiseRow(nameCell, designationCell, blCell)) {
      skippedRows += 1
      return
    }

    const rawName = cellText(row.getCell(COL.NAME))
    const name = normalizeClientName(rawName)
    if (!name) {
      skippedRows += 1
      return
    }

    const montant = cellNumber(row.getCell(COL.MONTANT))
    const reglement = cellNumber(row.getCell(COL.REGLEMENT))
    const decaissement = cellNumber(row.getCell(COL.DECAISSEMENT))

    if (!byClient.has(name)) byClient.set(name, { invoiced: 0, paid: 0, rawNames: new Set() })
    const entry = byClient.get(name)
    entry.invoiced += montant
    entry.paid += reglement + decaissement
    entry.rawNames.add(rawName)

    dataRows += 1
  })

  return { byClient, dataRows, skippedRows }
}

// Distance de Levenshtein, sans dépendance externe.
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// Regroupe les noms normalisés proches orthographiquement (probables
// variantes du même client) pour signalement manuel -- pas de fusion
// automatique, juste un log d'aide à la relecture.
function findAmbiguousNameGroups(names) {
  const sorted = [...names].sort()
  const used = new Set()
  const groups = []
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i])) continue
    const group = [sorted[i]]
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(sorted[j])) continue
      const dist = levenshtein(sorted[i], sorted[j])
      const threshold = Math.max(2, Math.floor(Math.min(sorted[i].length, sorted[j].length) * 0.15))
      if (dist > 0 && dist <= threshold) {
        group.push(sorted[j])
        used.add(sorted[j])
      }
    }
    if (group.length > 1) {
      used.add(sorted[i])
      groups.push(group)
    }
  }
  return groups
}

function chunk(array, size) {
  const out = []
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))
  return out
}

async function fetchAllClients() {
  const map = new Map() // UPPERCASE(name) -> row
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, total_invoiced, total_paid, source')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Lecture clients : ${error.message}`)
    for (const row of data) map.set(row.name.trim().toUpperCase(), row)
    if (data.length < pageSize) break
    from += pageSize
  }
  return map
}

async function main() {
  console.log(`Lecture de ${XLSX_PATH}...`)
  const workbook = await loadWorkbook()

  console.log(`\nExtraction de l'onglet '${SHEET_NAME}'...`)
  const { byClient, dataRows, skippedRows } = readSituationSheet(workbook)
  console.log(`  ${dataRows} lignes de transaction retenues, ${skippedRows} lignes ignorées (en-têtes/vides/TOTAL/VISA).`)
  console.log(`  ${byClient.size} clients uniques (normalisés) dans les données 2026.`)

  const ambiguousGroups = findAmbiguousNameGroups([...byClient.keys()])
  if (ambiguousGroups.length > 0) {
    console.log(`\n  ${ambiguousGroups.length} groupes de noms possiblement ambigus (variantes orthographiques) -- à vérifier manuellement :`)
    for (const group of ambiguousGroups) {
      console.log(`    - ${group.join('  <->  ')}`)
    }
  } else {
    console.log('\n  Aucune variante orthographique suspecte détectée.')
  }

  console.log('\nChargement des clients existants...')
  const existingByName = await fetchAllClients()
  console.log(`  ${existingByName.size} clients déjà en base.`)

  const now = new Date().toISOString()
  const toUpsert = []
  let matched = 0
  let created = 0

  for (const [name, delta] of byClient.entries()) {
    const existing = existingByName.get(name)
    if (existing) {
      const newInvoiced = Number(existing.total_invoiced || 0) + delta.invoiced
      const newPaid = Number(existing.total_paid || 0) + delta.paid
      console.log(
        `  [maj] ${name} : facturé ${existing.total_invoiced} -> ${newInvoiced} | réglé ${existing.total_paid} -> ${newPaid}`
      )
      toUpsert.push({
        name,
        total_invoiced: newInvoiced,
        total_paid: newPaid,
        balance: newInvoiced - newPaid,
        source: existing.source,
        updated_at: now,
      })
      matched += 1
    } else {
      console.log(`  [nouveau] ${name} : facturé ${delta.invoiced} | réglé ${delta.paid}`)
      toUpsert.push({
        name,
        total_invoiced: delta.invoiced,
        total_paid: delta.paid,
        balance: delta.invoiced - delta.paid,
        source: 'import_2026',
      })
      created += 1
    }
  }

  console.log(`\nÉcriture dans 'clients' (${matched} mises à jour, ${created} créations)...`)
  let written = 0
  let errors = 0
  for (const batch of chunk(toUpsert, BATCH_SIZE)) {
    const { data, error } = await supabase.from('clients').upsert(batch, { onConflict: 'name' }).select('id')
    if (error) {
      console.error(`  Erreur upsert clients (lot de ${batch.length}) :`, error.message)
      errors += batch.length
      continue
    }
    written += data.length
  }

  console.log('\n=== Résumé ===')
  console.log(`Lignes de transaction traitées : ${dataRows} (${skippedRows} ignorées)`)
  console.log(`Clients mis à jour              : ${matched}`)
  console.log(`Clients créés (source=import_2026) : ${created}`)
  console.log(`Écritures réussies               : ${written}`)
  console.log(`Erreurs                          : ${errors}`)
  console.log(`Noms ambigus à vérifier          : ${ambiguousGroups.length} groupe(s)`)
}

main().catch((err) => {
  console.error("\nÉchec de l'import :", err)
  process.exit(1)
})
