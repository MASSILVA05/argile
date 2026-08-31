import { computeAmount, formatDA, rateFor } from './unloadingTypes'

const NTFY_TOPIC = import.meta.env.VITE_NTFY_TOPIC

// Chaque module a son propre topic ntfy (moins encombré qu'un seul topic
// partagé), avec repli sur VITE_NTFY_TOPIC si la variable spécifique n'est
// pas définie -- garde la rétrocompatibilité pour les déploiements qui
// n'ont pas encore les nouvelles variables.
const TOPIC_CHARGEMENT = import.meta.env.VITE_NTFY_TOPIC_CHARGEMENT || NTFY_TOPIC
const TOPIC_MAINTENANCE = import.meta.env.VITE_NTFY_TOPIC_MAINTENANCE || NTFY_TOPIC
const TOPIC_CARBURANT = import.meta.env.VITE_NTFY_TOPIC_CARBURANT || NTFY_TOPIC
const TOPIC_SABLE = import.meta.env.VITE_NTFY_TOPIC_SABLE || NTFY_TOPIC
const TOPIC_FACTURES = import.meta.env.VITE_NTFY_TOPIC_FACTURES || NTFY_TOPIC
const TOPIC_TVA = import.meta.env.VITE_NTFY_TOPIC_TVA || NTFY_TOPIC
const TOPIC_CAISSE = import.meta.env.VITE_NTFY_TOPIC_CAISSE || NTFY_TOPIC

export async function sendNtfy(topic, title, lines, tags = 'truck') {
  if (!topic) {
    console.warn('Aucun topic ntfy défini (VITE_NTFY_TOPIC ou variable spécifique au module)')
    return
  }
  try {
    const resp = await fetch(`https://ntfy.sh/${topic}`, {
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
  return sendNtfy(TOPIC_CHARGEMENT, 'Nouveau chargement', lines)
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
  return sendNtfy(TOPIC_MAINTENANCE, 'Nouvelle fiche maintenance', lines, 'wrench')
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
  return sendNtfy(TOPIC_CARBURANT, `Carburant — ${isRefill ? 'Approvisionnement' : 'Remplissage'}`, lines, 'fuelpump')
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
  return sendNtfy(TOPIC_SABLE, 'Nouvelle livraison sable', lines, 'mountain')
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
  return sendNtfy(TOPIC_FACTURES, 'Nouvelle facture', lines, 'receipt')
}

export function notifyTvaEntry(entry) {
  const lines = [
    `Facture n° ${entry.invoice_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Mois de récupération : ${entry.recovery_month}/${entry.recovery_year}`,
    `Fournisseur : ${entry.supplier_name}`,
  ]
  if (entry.piece_number) lines.push(`N° Pièce : ${entry.piece_number}`)
  lines.push(`Total HT : ${entry.total_ht} DA`)
  if (entry.discount_amount) lines.push(`Remise : ${entry.discount_amount} DA`)
  lines.push(`HT Net : ${entry.ht_net} DA`)
  lines.push(`TVA : ${entry.tva_amount} DA`)
  if (entry.dd_amount) lines.push(`DD : ${entry.dd_amount} DA`)
  lines.push(`TTC : ${entry.total_ttc} DA`)
  if (entry.stamp_duty) lines.push(`Timbre : ${entry.stamp_duty} DA`)
  lines.push(`Total Net : ${entry.total_net} DA`)
  lines.push(`Paiement : ${entry.payment_mode ?? 'Non payé'}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
  return sendNtfy(TOPIC_TVA, `TVA ${entry.entity ?? 'Briqueterie'} — Nouvelle facture`, lines, 'receipt')
}

export function notifyTvaPayerEntry(entry) {
  const lines = [
    `Facture n° ${entry.invoice_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Client : ${entry.client_name}`,
    `Total HT : ${entry.total_ht} DA`,
  ]
  if (entry.discount_amount) lines.push(`Remise : ${entry.discount_amount} DA`)
  lines.push(`TVA : ${entry.total_tva} DA`)
  lines.push(`TTC : ${entry.total_ttc} DA`)
  if (entry.stamp_duty) lines.push(`Timbre : ${entry.stamp_duty} DA`)
  lines.push(`Total Net : ${entry.total_net} DA`)
  if (entry.ref_commande) lines.push(`Réf. Commande : ${entry.ref_commande}`)
  if (entry.ref_livraison) lines.push(`Réf. Livraison : ${entry.ref_livraison}`)
  lines.push(`Paiement : ${entry.payment_mode ?? 'Non payé'}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
  return sendNtfy(TOPIC_TVA, `TVA ${entry.entity ?? 'Briqueterie'} — Nouvelle facture à payer`, lines, 'receipt')
}

export function notifyCaisseEntry(entry) {
  const category =
    entry.category === 'Autre' && entry.category_other ? entry.category_other : entry.category
  const lines = [
    `Bon n° ${entry.bon_number}`,
    `Date : ${entry.entry_date}${entry.entry_time ? ` à ${entry.entry_time.slice(0, 5)}` : ''}`,
    `Type : ${entry.operation_type}`,
    `Motif : ${entry.description}`,
    `Montant : ${Number(entry.amount).toLocaleString('fr-FR')} DA`,
  ]
  if (entry.beneficiary) lines.push(`Fournisseur/Bénéficiaire : ${entry.beneficiary}`)
  if (entry.client_name) lines.push(`Client : ${entry.client_name}`)
  lines.push(`Mode de paiement : ${entry.payment_mode}`)
  if (entry.payment_mode === 'Chèque' && entry.cheque_number) {
    lines.push(`Chèque n° ${entry.cheque_number}${entry.cheque_bank ? ` — ${entry.cheque_bank}` : ''}`)
  }
  if (entry.piece_number) lines.push(`N° Pièce : ${entry.piece_number}`)
  lines.push(`Catégorie : ${category}`)
  if (entry.observations) lines.push(`Obs : ${entry.observations}`)
  if (entry.entered_by_user) lines.push(`Saisi par : ${entry.entered_by_user}`)
  return sendNtfy(TOPIC_CAISSE, `Caisse — ${entry.operation_type}`, lines, 'moneybag')
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
  return sendNtfy(TOPIC_FACTURES, 'Nouvelle avance client', lines, 'moneybag')
}
