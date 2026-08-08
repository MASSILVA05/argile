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
  if (entry.entered_by_user) {
    lines.push(`Saisi par : ${entry.entered_by_user}`)
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
  if (entry.entered_by) lines.push(`Renseigné par : ${entry.entered_by}`)
  if (entry.amount != null) lines.push(`Montant : ${entry.amount} DA`)
  if (entry.is_paid) lines.push(`Payé : ${entry.is_paid}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
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
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
  return sendNtfy(`Carburant — ${isRefill ? 'Approvisionnement' : 'Remplissage'}`, lines, 'fuelpump')
}

export function notifySandEntry(entry) {
  const total = Number(entry.sand_total || 0) + Number(entry.transport_price || 0)
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Fournisseur : ${entry.supplier_name}`,
  ]
  if (entry.transporter_name) lines.push(`Transporteur : ${entry.transporter_name}`)
  if (entry.truck_plate) lines.push(`Matricule : ${entry.truck_plate}`)
  if (entry.driver_name) lines.push(`Chauffeur : ${entry.driver_name}`)
  lines.push(`Quantité : ${entry.quantity_tons} T`)
  lines.push(`Prix unitaire : ${entry.unit_price} DA/T`)
  lines.push(`Total sable : ${entry.sand_total} DA`)
  lines.push(`Transport : ${entry.transport_price} DA`)
  lines.push(`Total général : ${total} DA`)
  lines.push(`Paiement fournisseur : ${entry.supplier_paid ?? 'Non payé'}`)
  lines.push(`Paiement transporteur : ${entry.transporter_paid ?? 'Non payé'}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
  return sendNtfy('Nouvelle livraison sable', lines, 'mountain')
}

export function notifyInvoiceEntry(entry) {
  const designation = entry.designation === 'Autre' ? entry.designation_other || 'Autre' : entry.designation
  const lines = [
    `Facture n° ${entry.invoice_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Client : ${entry.client_name}`,
    `Désignation : ${designation}`,
  ]
  if (entry.bl_number) lines.push(`N° BL : ${entry.bl_number}`)
  if (entry.qty_b8) lines.push(`B8 : ${entry.qty_b8} × ${entry.price_b8} DA`)
  if (entry.qty_b12) lines.push(`B12 : ${entry.qty_b12} × ${entry.price_b12} DA`)
  if (entry.qty_h) lines.push(`Autre (H) : ${entry.qty_h} × ${entry.price_h} DA`)
  lines.push(`Montant : ${entry.amount} DA`)
  if (entry.discount_amount) lines.push(`Remise : ${entry.discount_amount} DA`)
  lines.push(`Total : ${entry.total} DA`)
  if (entry.settlement) lines.push(`Règlement : ${entry.settlement} DA`)
  if (entry.disbursement) lines.push(`Décaissement : ${entry.disbursement} DA`)
  lines.push(`Solde : ${entry.balance} DA`)
  lines.push(`Type : ${entry.payment_type}`)
  lines.push(`Paiement : ${entry.payment_status ?? 'Non payé'}`)
  if (entry.driver_name) lines.push(`Chauffeur : ${entry.driver_name}`)
  if (entry.truck_plate) lines.push(`Immat : ${entry.truck_plate}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
  return sendNtfy('Nouvelle facture', lines, 'receipt')
}

export function notifyClientAdvance(advance) {
  const lines = [
    `Client : ${advance.client_name}`,
    `Date : ${advance.advance_date}`,
    `Montant payé : ${advance.amount_paid} DA`,
    `Bons achetés : ${advance.bons_purchased}`,
  ]
  if (advance.payment_mode) lines.push(`Mode de paiement : ${advance.payment_mode}`)
  if (advance.observations) lines.push(`Obs : ${advance.observations}`)
  if (advance.entered_by_user) lines.push(`Saisi par : ${advance.entered_by_user}`)
  return sendNtfy('Nouvelle avance client', lines, 'moneybag')
}
