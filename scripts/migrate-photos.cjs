const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VPS_URL = 'https://automecanica.dz'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const BUCKETS = ['bon-photos', 'maintenance-photos', 'sable-photos', 'tva-photos']

async function migrate() {
  for (const bucket of BUCKETS) {
    console.log(`\n=== ${bucket} ===`)
    const { data: files, error } = await supabase.storage.from(bucket).list('', { limit: 1000 })
    if (error) { console.error(`  Erreur listing ${bucket}:`, error.message); continue }
    if (!files || files.length === 0) { console.log('  Aucun fichier'); continue }
    
    console.log(`  ${files.length} fichiers trouvés`)
    let ok = 0, fail = 0
    
    for (const file of files) {
      try {
        const { data, error: dlError } = await supabase.storage.from(bucket).download(file.name)
        if (dlError) { console.error(`  DL erreur ${file.name}:`, dlError.message); fail++; continue }
        
        const buffer = Buffer.from(await data.arrayBuffer())
        
        const resp = await fetch(`${VPS_URL}/upload/${bucket}/`, {
          method: 'POST',
          body: buffer,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
        const result = await resp.json()
        
        // Update the URL in database
        const oldUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${file.name}`
        const newUrl = result.url
        
        // Update all tables that might reference this photo
        if (bucket === 'bon-photos') {
          await supabase.from('entries').update({ photo_url: newUrl }).like('photo_url', `%${file.name}%`)
        } else if (bucket === 'maintenance-photos') {
          await supabase.from('maintenance').update({ machine_photo_url: newUrl }).like('machine_photo_url', `%${file.name}%`)
          await supabase.from('maintenance').update({ receipt_photo_url: newUrl }).like('receipt_photo_url', `%${file.name}%`)
        } else if (bucket === 'sable-photos') {
          await supabase.from('sand_entries').update({ photo_url: newUrl }).like('photo_url', `%${file.name}%`)
        } else if (bucket === 'tva-photos') {
          await supabase.from('tva_entries').update({ photo_url: newUrl }).like('photo_url', `%${file.name}%`)
        }
        
        ok++
        console.log(`  ✓ ${file.name} → ${newUrl}`)
      } catch (e) {
        console.error(`  ✗ ${file.name}:`, e.message)
        fail++
      }
    }
    console.log(`  Résultat: ${ok} migrées, ${fail} erreurs`)
  }
}

migrate().then(() => console.log('\nMigration terminée'))
