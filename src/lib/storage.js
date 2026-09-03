const PHOTO_SERVER_URL = import.meta.env.VITE_PHOTO_SERVER_URL

// Le serveur assigne lui-même le nom de fichier et renvoie l'URL complète
// (http://.../photos/{bucket}/{filename}.jpg) : `prefix` n'est donc plus
// utilisé pour construire un chemin, mais reste accepté pour ne rien changer
// aux appels existants (uploadBonPhoto, uploadMaintenancePhoto, etc.).
export async function uploadPhoto(file, bucket, _prefix) {
  const resp = await fetch(`${PHOTO_SERVER_URL}/upload/${bucket}/`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file,
  })
  if (!resp.ok) {
    throw new Error(`Erreur d'upload de la photo (${bucket}) : HTTP ${resp.status}`)
  }
  const data = await resp.json()
  return data.url
}

export function uploadBonPhoto(file, bonNumber) {
  return uploadPhoto(file, 'bon-photos', String(bonNumber))
}

export function uploadMaintenancePhoto(file, ficheNumber, kind) {
  return uploadPhoto(file, 'maintenance-photos', `${kind}-${ficheNumber}`)
}

export function uploadSandPhoto(file, bonNumber) {
  return uploadPhoto(file, 'sable-photos', String(bonNumber))
}

export function uploadTvaPhoto(file, invoiceNumber) {
  return uploadPhoto(file, 'tva-photos', String(invoiceNumber))
}

export function uploadTvaPayerPhoto(file, invoiceNumber) {
  return uploadPhoto(file, 'tva-payer-photos', String(invoiceNumber))
}

export function uploadCaissePhoto(file, bonNumber) {
  return uploadPhoto(file, 'caisse-photos', String(bonNumber))
}

// Magasin Bejaia : photos des bons de vente et des bons d'achat fournisseur
// (bucket public "magasin-photos" côté serveur de photos).
export function uploadMagasinPhoto(file, ref) {
  return uploadPhoto(file, 'magasin-photos', String(ref))
}
