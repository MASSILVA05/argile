const NTFY_TOPIC = import.meta.env.VITE_NTFY_TOPIC

// Publication via l'endpoint JSON de ntfy.sh (https://docs.ntfy.sh/publish/#publish-as-json)
// plutôt que des en-têtes HTTP, pour éviter les soucis d'encodage avec les accents français.
export async function notifyNewEntry(entry) {
  if (!NTFY_TOPIC) {
    console.warn('VITE_NTFY_TOPIC non défini : notification ignorée')
    return
  }

  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Matricule : ${entry.truck_plate}`,
    `Chauffeur : ${entry.driver_name}`,
  ]
  if (entry.weight_tons != null && entry.weight_tons !== '') {
    lines.push(`Poids : ${entry.weight_tons} T`)
  }
  if (entry.unloading_location) {
    lines.push(`Déchargement : ${entry.unloading_location}`)
  }

  try {
    await fetch('https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title: 'Nouveau chargement enregistré',
        message: lines.join('\n'),
        tags: ['truck'],
        priority: 3,
      }),
    })
  } catch (err) {
    console.error('Échec de la notification ntfy :', err)
  }
}
