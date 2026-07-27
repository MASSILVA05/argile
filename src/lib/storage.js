import { supabase } from './supabase'

const BUCKET = 'bon-photos'

export async function uploadBonPhoto(file, bonNumber) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${bonNumber}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
