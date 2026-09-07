// Constantes et helpers partagés par la page Résidence (location saisonnière
// Boulimat / 4 Chemins) : disponibilité, réservations, clients, caisse.
// Centralisés ici pour éviter la duplication entre les composants Residence*
// et les modules d'export Excel.

import { periodLabel } from './period'
import { todayISO } from './excelHelpers'

export const RESIDENCES = ['Boulimat', '4 Chemins']

export const UNIT_TYPES = ['Duplex', 'Triplex', 'F2', 'F3', 'F5', 'Service']

export const UNIT_STATUTS = ['Disponible', 'Occupé', 'Maintenance', 'Hors service']

export const RESERVATION_STATUTS = ['En attente', 'Confirmée', 'En cours', 'Terminée', 'Annulée']

// Un logement est bloqué (indisponible à la réservation) tant que sa
// réservation courante n'est pas Terminée / Annulée.
export const ACTIVE_RESERVATION_STATUTS = ['En attente', 'Confirmée', 'En cours']

export const RESA_PAYMENT_MODES = ['Espèces', 'Chèque', 'Virement', 'BaridiMob']

// Caisse résidence — mêmes libellés que la caisse magasin, catégories propres.
export const RC_OPERATION_TYPES = ['Encaissement', 'Décaissement', 'Dépense']
export const RC_PAYMENT_MODES = ['Espèces', 'Chèque', 'Virement', 'BaridiMob']
export const RC_CATEGORIES = ['Client', 'Ménage', 'Entretien', 'Réparation', 'Frais généraux', 'Autre']

// Couleur (jeton Tailwind) d'un logement selon son statut effectif à la date
// consultée : vert = libre, rouge = occupé, orange = en attente, gris = indispo.
export const STATUT_STYLES = {
  Disponible: { dot: 'bg-green-500', card: 'border-green-500/50 bg-green-500/10', text: 'text-green-500' },
  Occupé: { dot: 'bg-terracotta', card: 'border-terracotta/60 bg-terracotta/10', text: 'text-terracotta' },
  'En attente': { dot: 'bg-ocre', card: 'border-ocre/60 bg-ocre/10', text: 'text-ocre' },
  Maintenance: { dot: 'bg-ink-muted', card: 'border-border bg-bg-soft', text: 'text-ink-muted' },
  'Hors service': { dot: 'bg-ink-muted', card: 'border-border bg-bg-soft', text: 'text-ink-muted' },
}

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function nightsBetween(dateArrivee, dateDepart) {
  if (!dateArrivee || !dateDepart) return 0
  const a = new Date(dateArrivee)
  const d = new Date(dateDepart)
  const ms = d.getTime() - a.getTime()
  return ms > 0 ? Math.round(ms / 86_400_000) : 0
}

// Deux plages [a1, d1[ et [a2, d2[ se chevauchent-elles ? (départ = jour libre)
export function datesOverlap(a1, d1, a2, d2) {
  return a1 < d2 && a2 < d1
}

// Réservation active (non terminée / annulée) couvrant `dateISO` pour ce logement.
export function reservationOnDate(reservations, unitId, dateISO) {
  return (reservations ?? []).find(
    (r) =>
      r.unit_id === unitId &&
      ACTIVE_RESERVATION_STATUTS.includes(r.statut) &&
      r.date_arrivee <= dateISO &&
      r.date_depart > dateISO
  )
}

// Statut effectif d'un logement à la date consultée : le statut manuel
// (Maintenance / Hors service) prime, sinon on regarde s'il y a une
// réservation active à cette date (Confirmée/En cours -> Occupé, En attente).
export function effectiveStatut(unit, reservations, dateISO) {
  if (unit.statut === 'Maintenance' || unit.statut === 'Hors service') return unit.statut
  const resa = reservationOnDate(reservations, unit.id, dateISO)
  if (!resa) return 'Disponible'
  return resa.statut === 'En attente' ? 'En attente' : 'Occupé'
}

// Logements réservables pour la période [arrivee, depart[ : ni en maintenance,
// ni chevauchés par une réservation active.
export function isUnitFree(unit, reservations, dateArrivee, dateDepart, ignoreResaId = null) {
  if (unit.statut === 'Maintenance' || unit.statut === 'Hors service') return false
  if (!dateArrivee || !dateDepart || dateDepart <= dateArrivee) return true
  return !(reservations ?? []).some(
    (r) =>
      r.id !== ignoreResaId &&
      r.unit_id === unit.id &&
      ACTIVE_RESERVATION_STATUTS.includes(r.statut) &&
      datesOverlap(dateArrivee, dateDepart, r.date_arrivee, r.date_depart)
  )
}

// --- Caisse résidence -------------------------------------------------------

export function rcSignedAmount(entry) {
  const amount = Number(entry.amount) || 0
  return entry.operation_type === 'Encaissement' ? amount : -amount
}

export function rcIsInflow(operationType) {
  return operationType === 'Encaissement'
}

export function rcCategoryLabel(entry) {
  return entry.category === 'Autre' && entry.category_other ? entry.category_other : entry.category
}

export function rcComputeSolde(entries) {
  return (entries ?? []).reduce((sum, e) => sum + rcSignedAmount(e), 0)
}

// --- Fiche client (relevé des réservations) réutilisée par EntitySheetModal --
export function buildResidenceClientSheet(reservations, name, startDate, endDate) {
  const nameLower = name.trim().toLowerCase()
  const rows = (reservations ?? [])
    .filter((r) => String(r.client_name ?? '').trim().toLowerCase() === nameLower)
    .filter((r) => (!startDate || r.date_arrivee >= startDate) && (!endDate || r.date_arrivee <= endDate))
    .sort((a, b) => (a.date_arrivee < b.date_arrivee ? -1 : a.date_arrivee > b.date_arrivee ? 1 : 0))
    .map((r) => ({
      unit: `${r.unit_nom} (${r.residence})`,
      date_arrivee: r.date_arrivee,
      date_depart: r.date_depart,
      nb_nuits: r.nb_nuits ?? nightsBetween(r.date_arrivee, r.date_depart),
      statut: r.statut,
      montant_total: Number(r.montant_total) || 0,
      arrhes: Number(r.arrhes) || 0,
      reste_a_payer: Number(r.reste_a_payer) || 0,
    }))

  if (rows.length === 0) {
    return { error: `Aucune réservation trouvée pour « ${name} » sur cette période.` }
  }

  const columns = [
    { key: 'unit', header: 'Logement' },
    { key: 'date_arrivee', header: 'Arrivée' },
    { key: 'date_depart', header: 'Départ' },
    { key: 'nb_nuits', header: 'Nuits', align: 'right' },
    { key: 'statut', header: 'Statut' },
    { key: 'montant_total', header: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
    { key: 'arrhes', header: 'Arrhes (DA)', align: 'right', format: (v) => formatDA(v) },
    { key: 'reste_a_payer', header: 'Reste (DA)', align: 'right', format: (v) => formatDA(v) },
  ]

  const totalMontant = rows.reduce((s, r) => s + r.montant_total, 0)
  const totalArrhes = rows.reduce((s, r) => s + r.arrhes, 0)
  const totalReste = rows.reduce((s, r) => s + r.reste_a_payer, 0)

  return {
    title: `Relevé client résidence — ${name}`,
    periodLabel: periodLabel(startDate, endDate),
    columns,
    rows,
    totalRows: [
      {
        cells: {
          unit: `${rows.length} séjour(s)`,
          montant_total: totalMontant,
          arrhes: totalArrhes,
          reste_a_payer: totalReste,
        },
        highlight: true,
      },
    ],
    excelFilename: `Fiche_Residence_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
  }
}

// --- Fiche par bénéficiaire / client de la caisse résidence -----------------
export function buildResidenceCaisseSheet(entries, field, name, startDate, endDate) {
  const label = field === 'client_name' ? 'Client' : 'Fournisseur / Bénéficiaire'
  const nameLower = name.trim().toLowerCase()
  const rows = (entries ?? [])
    .filter((e) => String(e[field] ?? '').trim().toLowerCase() === nameLower)
    .filter((e) => (!startDate || e.entry_date >= startDate) && (!endDate || e.entry_date <= endDate))
    .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
    .map((e) => ({
      bon_number: e.bon_number,
      entry_date: e.entry_date,
      operation_type: e.operation_type,
      description: e.description,
      payment_mode: e.payment_mode ?? '—',
      amount: rcSignedAmount(e),
    }))

  if (rows.length === 0) {
    return { error: `Aucune opération trouvée pour « ${name} » sur cette période.` }
  }

  const columns = [
    { key: 'bon_number', header: 'N° Bon' },
    { key: 'entry_date', header: 'Date' },
    { key: 'operation_type', header: 'Type' },
    { key: 'description', header: 'Motif / Libellé' },
    { key: 'payment_mode', header: 'Paiement' },
    { key: 'amount', header: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
  ]

  const net = rows.reduce((s, r) => s + r.amount, 0)

  return {
    title: `Relevé Caisse Résidence — ${label} : ${name}`,
    periodLabel: periodLabel(startDate, endDate),
    columns,
    rows,
    totalRows: [{ cells: { bon_number: 'SOLDE NET', amount: net }, highlight: true }],
    excelFilename: `Fiche_Caisse_Residence_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
  }
}
