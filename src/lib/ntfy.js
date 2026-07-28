import { computeAmount, formatDA, rateFor } from './unloadingTypes'

const NTFY_TOPIC = import.meta.env.VITE_NTFY_TOPIC

export async function notifyNewEntry(entry) {
  if (!NTFY_TOPIC) {
    console.warn('VITE_NTFY_TOPIC non défini')
    return
  }
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Matricule : ${entry.truck_plate}`,
    `Chauffeur : ${entry.driver_name}`,
    `Type : ${entry.unloading_type}`,
  ]
  if (entry.ticket_number) {
    lines.push(`Ticket pesée : ${entry.ticket_number}`)
  }
  const amount = computeAmount(entry)
  if (entry.weight_tons != null && entry.weight_tons !== '') {
    lines.push(
      amount != null
        ? `Poids : ${entry.weight_tons}T × ${rateFor(entry.unloading_type)} DA = ${formatDA(amount)}`
        : `Poids : ${entry.weight_tons} T`
    )
  }
  if (entry.observations) {
    lines.push(`Obs : ${entry.observations}`)
  }
  try {
    const resp = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: lines.join('\n'),
      headers: {
        'Title': 'Nouveau chargement',
        'Tags': 'truck',
        'Priority': '3',
      },
    })
    if (!resp.ok) console.error('ntfy erreur:', resp.status, await resp.text())
  } catch (err) {
    console.error('ntfy erreur:', err)
  }
}
