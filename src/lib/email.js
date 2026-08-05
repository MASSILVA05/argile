import emailjs from '@emailjs/browser'
import { computeAmount, formatDA } from './unloadingTypes'

const SERVICE_ID = 'service_ndslg4h'
const TEMPLATE_ID = 'template_jjwwov9'

emailjs.init('J-MtomjHeZX6EwSeF')

async function send(vars) {
  try {
    const result = await emailjs.send(SERVICE_ID, TEMPLATE_ID, vars)
    console.log('Email envoyé:', result.status)
  } catch (err) {
    console.error('Email erreur:', err)
  }
}

export function sendEmailNotification(entry) {
  const amount = computeAmount(entry)
  return send({
    bon_number: entry.bon_number,
    entry_date: entry.entry_date,
    entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : 'N/A',
    truck_plate: entry.truck_plate,
    driver_name: entry.driver_name,
    unloading_type: entry.unloading_type,
    ticket_number: entry.ticket_number || 'N/A',
    weight_tons: entry.weight_tons ?? 'N/A',
    amount: amount != null ? formatDA(amount) : 'N/A',
    observations: entry.observations || 'Aucune',
    entered_by_user: entry.entered_by_user || 'N/A',
  })
}

// Nouveaux domaines (maintenance/carburant) : le template EmailJS existant a été
// conçu pour les champs du chargement ci-dessus. On lui passe en plus un
// "subject"/"message" génériques ; pour que ça s'affiche dans l'email reçu, le
// template EmailJS doit inclure {{subject}} et {{message}} (à ajouter côté
// dashboard EmailJS, ce que je ne peux pas faire depuis le code).
export function sendMaintenanceEmail(entry) {
  const lines = [
    `Fiche n° ${entry.fiche_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Machine : ${entry.machine_name}`,
    `Problème : ${entry.problem_description}`,
    `Fournisseur : ${entry.supplier_name || 'N/A'}`,
    `Acheté par : ${entry.purchased_by || 'N/A'}`,
    `Demandé par : ${entry.requested_by || 'N/A'}`,
    `Renseigné par : ${entry.entered_by || 'N/A'}`,
    `Montant : ${entry.amount != null ? `${entry.amount} DA` : 'N/A'}`,
    `Payé : ${entry.is_paid || 'N/A'}`,
    `Observations : ${entry.observations || 'Aucune'}`,
    `Saisi par : ${entry.entered_by_user || 'N/A'}`,
  ]
  return send({
    subject: 'Nouvelle fiche maintenance',
    message: lines.join('\n'),
  })
}

export function sendFuelEmail(entry) {
  const isRefill = entry.operation_type === 'Approvisionnement'
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Type : ${entry.operation_type}`,
    `Matricule : ${entry.truck_plate || 'N/A'}`,
    `Chauffeur : ${entry.driver_name || 'N/A'}`,
    `Fournisseur : ${entry.supplier_name || 'N/A'}`,
    `Volume : ${entry.volume_liters} L`,
    `Réserve restante : ${entry.tank_volume_after} L`,
    `Observations : ${entry.observations || 'Aucune'}`,
    `Saisi par : ${entry.entered_by_user || 'N/A'}`,
  ]
  return send({
    subject: `Carburant — ${isRefill ? 'Approvisionnement' : 'Remplissage'}`,
    message: lines.join('\n'),
  })
}

export function sendSandEmail(entry) {
  const total = Number(entry.sand_total || 0) + Number(entry.transport_price || 0)
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Fournisseur : ${entry.supplier_name}`,
    `Transporteur : ${entry.transporter_name || 'N/A'}`,
    `Matricule : ${entry.truck_plate || 'N/A'}`,
    `Chauffeur : ${entry.driver_name || 'N/A'}`,
    `Quantité : ${entry.quantity_tons} T`,
    `Prix unitaire : ${entry.unit_price} DA/T`,
    `Total sable : ${entry.sand_total} DA`,
    `Transport : ${entry.transport_price} DA`,
    `Total général : ${total} DA`,
    `Paiement fournisseur : ${entry.supplier_paid ?? 'Non payé'}`,
    `Paiement transporteur : ${entry.transporter_paid ?? 'Non payé'}`,
    `Observations : ${entry.observations || 'Aucune'}`,
    `Saisi par : ${entry.entered_by_user || 'N/A'}`,
  ]
  return send({
    subject: 'Nouvelle livraison sable',
    message: lines.join('\n'),
  })
}
