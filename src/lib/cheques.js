// Constantes et helpers partagés par la page "Chèques" (Saisie / Registre /
// Suivi). Centralisés ici pour éviter la duplication entre les composants
// Cheque* et chequesExcel.

import { periodLabel } from './period'
import { todayISO } from './excelHelpers'

export const CHEQUE_TYPES = ['Émis', 'Reçu']
export const CHEQUE_STATUTS = ['En attente', 'Remis en banque', 'Encaissé', 'Rejeté', 'Annulé']
export const CHEQUE_BANKS = ['BNA', 'BDL', 'BADR', 'CPA', 'CNEP', 'BEA', 'SGA', 'AGB', 'ABC', 'TRUST', 'NATIXIS']
export const CHEQUE_MOTIFS = ['Achat matière', 'Paiement fournisseur', 'Paiement client', 'Avance', 'Régularisation']

// Statuts encore "en cours" (pas définitivement soldés) -- utilisés par le
// sous-onglet Suivi.
export const CHEQUE_PENDING_STATUTS = ['En attente', 'Remis en banque', 'Rejeté']

export const CHEQUE_STALE_DAYS = 30

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function isEmis(type) {
  return type === 'Émis'
}

// Nombre de jours écoulés depuis la date du chèque (utilisé pour l'alerte
// "en attente depuis > 30 jours" du sous-onglet Suivi).
export function daysSince(dateISO) {
  if (!dateISO) return 0
  const ms = Date.now() - new Date(`${dateISO}T00:00:00`).getTime()
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)))
}

// --- Fiche par bénéficiaire ------------------------------------------------
export function buildChequeSheet(rows, name, startDate, endDate) {
  const nameU = name.trim().toUpperCase()
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
  const match = (r) => String(r.beneficiary ?? '').trim().toUpperCase() === nameU && inRange(r.entry_date)

  const filteredRows = rows
    .filter(match)
    .sort((a, b) => (a.cheque_date < b.cheque_date ? -1 : a.cheque_date > b.cheque_date ? 1 : 0))
    .map((r) => ({
      cheque_number: r.cheque_number,
      cheque_date: r.cheque_date,
      type: r.type,
      amount: Number(r.amount) || 0,
      bank: r.bank,
      statut: r.statut,
    }))

  if (filteredRows.length === 0) {
    return { error: `Aucun chèque trouvé pour « ${name} » sur cette période.` }
  }

  const columns = [
    { key: 'cheque_number', header: 'N° Chèque' },
    { key: 'cheque_date', header: 'Date chèque' },
    { key: 'type', header: 'Type' },
    { key: 'amount', header: 'Montant (DA)', align: 'right', format: (v) => formatDA(v) },
    { key: 'bank', header: 'Banque' },
    { key: 'statut', header: 'Statut' },
  ]

  const total = filteredRows.reduce((s, r) => s + r.amount, 0)

  return {
    title: `Relevé chèques — ${name}`,
    periodLabel: periodLabel(startDate, endDate),
    columns,
    rows: filteredRows,
    totalRows: [
      { cells: { cheque_number: `${filteredRows.length} chèque(s)`, amount: total }, highlight: true },
    ],
    excelFilename: `Fiche_Cheques_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
  }
}
