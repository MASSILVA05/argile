import { supabase } from './supabase'

export async function uploadPhoto(file, bucket, prefix) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${prefix}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export function uploadBonPhoto(file, bonNumber) {
  return uploadPhoto(file, 'bon-photos', String(bonNumber))
}

export function uploadMaintenancePhoto(file, ficheNumber, kind) {
  return uploadPhoto(file, 'maintenance-photos', `${kind}-${ficheNumber}`)
}
