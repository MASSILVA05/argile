// Import ponctuel des codes clients + coordonnées depuis "fiche client.xls"
// (onglet "A", 735 lignes) vers Supabase (table `clients`).
//
// Colonnes réelles du fichier (lues par en-tête, pas par index -- les index
// indiqués initialement ne correspondaient pas exactement à l'ordre réel des
// colonnes) :
//   Société | Code | Nom | Téléphone | Fax | Mobile | Email | Ville | Famille | Solde | Nb_point
//
// Pour chaque ligne : cherche un client existant par nom normalisé
// (UPPER(TRIM(Société))). Si trouvé, met à jour uniquement les champs non
// vides du fichier (ne touche pas total_invoiced/total_paid/balance, tenus
// à jour par le trigger sync_client_balance_from_invoice -- la colonne
// "Solde" du fichier est juste affichée en cas d'écart important, jamais
// écrite). Si absent, crée le client avec source = 'import_fiche'.
//
// À exécuter UNE SEULE FOIS (ré-exécutable sans risque ensuite : ne modifie
// que les champs non vides du fichier, ne recrée jamais de doublon puisque
// le rattachement se fait par nom normalisé).
//
// Usage :
//   node --env-file=.env scripts/import-fiche-clients.js
//
// Nécessite dans .env (déjà présent pour scripts/import-situations.js) :
//   SUPABASE_URL=https://xxxx.supabase.co   (ou VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY=...            (clé service_role, PAS la clé anon)

import { createClient } from '@supabase/supabase-js'
import { read, utils } from 'xlsx'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')
const XLS_PATH = path.join(PROJECT_ROOT, 'fiche client.xls')
const SHEET_NAME = 'A'
const BATCH_SIZE = 200
const BALANCE_WARN_THRESHOLD = 100 // DA -- juste pour le log, n'affecte rien en base

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

function chunk(array, size) {
  const out = []
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))
  return out
}

function normalizeName(name) {
  return String(name ?? '').trim().toUpperCase()
}

function cell(value) {
  if (value == null) return null
  const str = String(value).trim()
  return str === '' ? null : str
}

function readFicheClients() {
  const buffer = readFileSync(XLS_PATH)
  const workbook = read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[SHEET_NAME]
  if (!sheet) throw new Error(`Onglet "${SHEET_NAME}" introuvable dans ${XLS_PATH}`)

  const rows = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  const header = rows[0].map((h) => String(h ?? '').trim())
  console.log('  En-têtes trouvés :', header.join(' | '))

  const colIndex = (label) => {
    const idx = header.findIndex((h) => h.toLowerCase() === label.toLowerCase())
    if (idx === -1) throw new Error(`Colonne "${label}" introuvable dans l'en-tête de ${XLS_PATH}`)
    return idx
  }

  const iSociete = colIndex('Société')
  const iCode = colIndex('Code')
  const iTel = colIndex('Téléphone')
  const iFax = colIndex('Fax')
  const iMobile = colIndex('Mobile')
  const iEmail = colIndex('Email')
  const iVille = colIndex('Ville')
  const iSolde = colIndex('Solde')

  const clients = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const societe = cell(row[iSociete])
    if (!societe) continue

    clients.push({
      name: normalizeName(societe),
      client_code: cell(row[iCode]),
      phone: cell(row[iTel]),
      fax: cell(row[iFax]),
      mobile: cell(row[iMobile]),
      email: cell(row[iEmail]),
      city: cell(row[iVille]),
      fileSolde: row[iSolde] == null ? null : Number(row[iSolde]) || 0,
    })
  }
  return clients
}

// `clients` peut contenir plus de 1000 lignes (import historique
// Situation_Globale.xlsx) -- pagine par blocs de 1000 pour tout récupérer.
async function fetchAllExistingClients() {
  const byName = new Map()
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, client_code, phone, fax, mobile, email, city, balance')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Erreur lecture clients existants : ${error.message}`)
    for (const row of data) byName.set(row.name, row)
    if (data.length < pageSize) break
    from += pageSize
  }
  return byName
}

async function main() {
  console.log(`Lecture de ${XLS_PATH} (onglet "${SHEET_NAME}")...`)
  const ficheClients = readFicheClients()
  console.log(`  ${ficheClients.length} lignes clients trouvées.`)

  console.log('\nChargement des clients existants dans `clients`...')
  const existingByName = await fetchAllExistingClients()
  console.log(`  ${existingByName.size} clients déjà en base.`)

  const toInsert = []
  const toUpdate = []
  const balanceWarnings = []

  for (const c of ficheClients) {
    const existing = existingByName.get(c.name)

    if (!existing) {
      toInsert.push({
        name: c.name,
        client_code: c.client_code,
        phone: c.phone,
        fax: c.fax,
        mobile: c.mobile,
        email: c.email,
        city: c.city,
        total_invoiced: 0,
        total_paid: 0,
        balance: 0,
        source: 'import_fiche',
      })
      continue
    }

    // Ne met à jour que les champs non vides du fichier, pour ne jamais
    // écraser une valeur déjà saisie dans l'app avec un blanc du fichier.
    const patch = {}
    if (c.client_code != null && c.client_code !== existing.client_code) patch.client_code = c.client_code
    if (c.phone != null && c.phone !== existing.phone) patch.phone = c.phone
    if (c.fax != null && c.fax !== existing.fax) patch.fax = c.fax
    if (c.mobile != null && c.mobile !== existing.mobile) patch.mobile = c.mobile
    if (c.email != null && c.email !== existing.email) patch.email = c.email
    if (c.city != null && c.city !== existing.city) patch.city = c.city

    if (Object.keys(patch).length > 0) {
      toUpdate.push({ id: existing.id, name: c.name, patch })
    }

    if (c.fileSolde != null && Math.abs(c.fileSolde - Number(existing.balance || 0)) > BALANCE_WARN_THRESHOLD) {
      balanceWarnings.push(
        `  ${c.name} : solde fichier = ${c.fileSolde} DA, solde app = ${existing.balance} DA (écart non appliqué)`
      )
    }
  }

  console.log(`\n${toInsert.length} nouveaux clients à créer, ${toUpdate.length} clients existants à mettre à jour.`)

  console.log('\nCréation des nouveaux clients...')
  let inserted = 0
  let insertErrors = 0
  for (const batch of chunk(toInsert, BATCH_SIZE)) {
    const { data, error } = await supabase.from('clients').insert(batch).select('id')
    if (error) {
      console.error(`  Erreur insertion (lot de ${batch.length}) :`, error.message)
      insertErrors += batch.length
      continue
    }
    inserted += data.length
  }
  console.log(`  ${inserted} clients créés, ${insertErrors} erreurs.`)

  console.log('\nMise à jour des clients existants...')
  let updated = 0
  let updateErrors = 0
  for (const { id, name, patch } of toUpdate) {
    const { error } = await supabase.from('clients').update(patch).eq('id', id)
    if (error) {
      console.error(`  Erreur mise à jour ${name} :`, error.message)
      updateErrors += 1
      continue
    }
    updated += 1
  }
  console.log(`  ${updated} clients mis à jour, ${updateErrors} erreurs.`)

  if (balanceWarnings.length > 0) {
    console.log(`\n${balanceWarnings.length} écarts de solde > ${BALANCE_WARN_THRESHOLD} DA entre le fichier et l'app (non appliqués, pour information) :`)
    balanceWarnings.slice(0, 30).forEach((w) => console.log(w))
    if (balanceWarnings.length > 30) console.log(`  ... et ${balanceWarnings.length - 30} de plus.`)
  }

  console.log('\n=== Résumé ===')
  console.log(`Clients créés         : ${inserted} (${insertErrors} erreurs)`)
  console.log(`Clients mis à jour    : ${updated} (${updateErrors} erreurs)`)
  console.log(`Écarts de solde signalés : ${balanceWarnings.length}`)
}

main().catch((err) => {
  console.error("\nÉchec de l'import :", err)
  process.exit(1)
})
