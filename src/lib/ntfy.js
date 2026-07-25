const NTFY_TOPIC = import.meta.env.VITE_NTFY_TOPIC

export async function notifyNewEntry(entry) {
  if (!NTFY_TOPIC) {
    console.warn('VITE_NTFY_TOPIC non défini')
    return
  }
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}`,
    `Matricule : ${entry.truck_plate}`,
    `Chauffeur : ${entry.driver_name}`,
    `Lieu : ${entry.unloading_location || 'Akbou'}`,
  ]
  if (entry.weight_tons != null && entry.weight_tons !== '') {
    lines.push(`Poids : ${entry.weight_tons} T`)
  }
  if (entry.observations) {
    lines.push(`Obs : ${entry.observations}`)
  }
  try {
    const resp = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: lines.join('\n'),
      headers: {
        'Title': encodeURIComponent('Nouveau chargement'),
        'Tags': 'truck',
        'Priority': '3',
      },
    })
    if (!resp.ok) console.error('ntfy erreur:', resp.status)
  } catch (err) {
    console.error('ntfy erreur:', err)
  }
}
