import { computeAmount, formatDA, rateFor } from './unloadingTypes'

const NTFY_TOPIC = import.meta.env.VITE_NTFY_TOPIC

export async function sendNtfy(title, lines, tags = 'truck') {
  if (!NTFY_TOPIC) {
    console.warn('VITE_NTFY_TOPIC non défini')
    return
  }
  try {
    const resp = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: lines.join('\n'),
      headers: {
        'Title': title,
        'Tags': tags,
        'Priority': '3',
      },
    })
    if (!resp.ok) console.error('ntfy erreur:', resp.status, await resp.text())
  } catch (err) {
    console.error('ntfy erreur:', err)
  }
}

export function notifyNewEntry(entry) {
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
  return sendNtfy('Nouveau chargement', lines)
}

export function notifyMaintenanceEntry(entry) {
  const lines = [
    `Fiche n° ${entry.fiche_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Machine : ${entry.machine_name}`,
    `Problème : ${entry.problem_description}`,
  ]
  if (entry.supplier_name) lines.push(`Fournisseur : ${entry.supplier_name}`)
  if (entry.purchased_by) lines.push(`Acheté par : ${entry.purchased_by}`)
  if (entry.requested_by) lines.push(`Demandé par : ${entry.requested_by}`)
  if (entry.entered_by) lines.push(`Saisi par : ${entry.entered_by}`)
  if (entry.amount != null) lines.push(`Montant : ${entry.amount} DA`)
  if (entry.is_paid) lines.push(`Payé : ${entry.is_paid}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  return sendNtfy('Nouvelle fiche maintenance', lines, 'wrench')
}

export function notifyFuelEntry(entry) {
  const isRefill = entry.operation_type === 'Approvisionnement'
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Type : ${entry.operation_type}`,
  ]
  if (entry.truck_plate) lines.push(`Matricule : ${entry.truck_plate}`)
  if (entry.driver_name) lines.push(`Chauffeur : ${entry.driver_name}`)
  if (entry.supplier_name) lines.push(`Fournisseur : ${entry.supplier_name}`)
  lines.push(`Volume : ${entry.volume_liters} L`)
  lines.push(`Réserve restante : ${entry.tank_volume_after} L`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  return sendNtfy(`Carburant — ${isRefill ? 'Approvisionnement' : 'Remplissage'}`, lines, 'fuelpump')
}
