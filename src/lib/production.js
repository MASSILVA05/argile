// Constantes et helpers partagés par la page Production (suivi de production
// briqueterie) : formulaire de saisie, registre, tableau de bord.
// Une ligne production_entries = un poste de production (presse -> séchoir ->
// four -> défournement -> emballage) pour une date / équipe / poste donnés.

export const EQUIPES = ['A', 'B', 'C']

export const POSTES = [
  { value: '1', label: '1 · 6h-14h' },
  { value: '2', label: '2 · 14h-22h' },
  { value: '3', label: '3 · 22h-6h' },
]

export const PRODUITS = ['B8', 'B12']

export const SECTIONS = [
  { id: 'presse', label: 'Presse' },
  { id: 'sechoir', label: 'Séchoir' },
  { id: 'four', label: 'Four' },
  { id: 'defourn', label: 'Défournement' },
  { id: 'emballage', label: 'Emballage' },
]

// Pièces par étage par défaut selon le produit (B8 = 72, B12 = 48).
export function defaultPiecesEtage(produit) {
  return produit === 'B12' ? 48 : 72
}

export const DEFAULT_ETAGES_CHARIOT = 12

export function toNum(value) {
  if (value === '' || value == null) return 0
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function formatInt(value) {
  return Math.round(toNum(value)).toLocaleString('fr-FR')
}

export function formatNum(value) {
  return toNum(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Total pièces pressées = chariots × étages/chariot × pièces/étage.
export function computePresseTotal(chariots, etagesChariot, piecesEtage) {
  return Math.round(toNum(chariots) * toNum(etagesChariot) * toNum(piecesEtage))
}

// Taux de casse (%) au défournement = (cassées + fissurées) / total × 100.
export function computeTauxCasse(conformes, cassees, fissurees) {
  const total = toNum(conformes) + toNum(cassees) + toNum(fissurees)
  if (total <= 0) return 0
  return ((toNum(cassees) + toNum(fissurees)) / total) * 100
}

export function formatPercent(value) {
  return `${toNum(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

export function posteLabel(value) {
  return POSTES.find((p) => p.value === value)?.label ?? value ?? '—'
}

// Pièces "sorties" utiles d'une ligne : priorité au défournement (pièces
// conformes), sinon au total pressé.
export function entryPiecesConformes(entry) {
  const conformes = toNum(entry.defourn_conformes)
  return conformes > 0 ? conformes : 0
}

export function entryRebuts(entry) {
  return (
    toNum(entry.presse_rebutes) +
    toNum(entry.sechoir_rebutes) +
    toNum(entry.defourn_cassees) +
    toNum(entry.defourn_fissurees)
  )
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Champs éditables par section (registre : modale d'édition + fiche).
// type: 'int' | 'num' | 'text'
export const EDIT_GROUPS = [
  {
    id: 'presse',
    label: 'Presse',
    fields: [
      { key: 'presse_chariots', label: 'Chariots produits', type: 'int' },
      { key: 'presse_numeros', label: 'N° des chariots', type: 'text' },
      { key: 'presse_pression', label: 'Pression mouleuse (bar)', type: 'num' },
      { key: 'presse_pieces_etage', label: 'Pièces par étage', type: 'int' },
      { key: 'presse_etages_chariot', label: 'Étages par chariot', type: 'int' },
      { key: 'presse_rebutes', label: 'Chariots rebutés', type: 'int' },
      { key: 'presse_remarques', label: 'Remarques presse', type: 'text' },
    ],
  },
  {
    id: 'sechoir',
    label: 'Séchoir',
    fields: [
      { key: 'sechoir_entres', label: 'Chariots entrés', type: 'int' },
      { key: 'sechoir_sortis', label: 'Chariots sortis', type: 'int' },
      { key: 'sechoir_temperature', label: 'Température (°C)', type: 'num' },
      { key: 'sechoir_humidite', label: 'Humidité (%)', type: 'num' },
      { key: 'sechoir_duree', label: 'Durée séchage (h)', type: 'num' },
      { key: 'sechoir_rebutes', label: 'Chariots rebutés séchoir', type: 'int' },
      { key: 'sechoir_remarques', label: 'Remarques séchoir', type: 'text' },
    ],
  },
  {
    id: 'four',
    label: 'Four',
    fields: [
      { key: 'four_enfournes', label: 'Chariots enfournés', type: 'int' },
      { key: 'four_defournes', label: 'Chariots défournés', type: 'int' },
      { key: 'four_temperature', label: 'Température four (°C)', type: 'num' },
      { key: 'four_duree', label: 'Durée cuisson (h)', type: 'num' },
      { key: 'four_gaz', label: 'Consommation gaz (m³)', type: 'num' },
      { key: 'four_remarques', label: 'Remarques four', type: 'text' },
    ],
  },
  {
    id: 'defourn',
    label: 'Défournement',
    fields: [
      { key: 'defourn_chariots', label: 'Chariots défournés', type: 'int' },
      { key: 'defourn_conformes', label: 'Pièces conformes', type: 'int' },
      { key: 'defourn_cassees', label: 'Pièces cassées', type: 'int' },
      { key: 'defourn_fissurees', label: 'Pièces fissurées', type: 'int' },
      { key: 'defourn_remarques', label: 'Remarques défournement', type: 'text' },
    ],
  },
  {
    id: 'emballage',
    label: 'Emballage',
    fields: [
      { key: 'emballage_paquets', label: 'Paquets produits', type: 'int' },
      { key: 'emballage_pieces_paquet', label: 'Pièces par paquet', type: 'int' },
      { key: 'emballage_palettes', label: 'Palettes produites', type: 'int' },
      { key: 'emballage_stock_final', label: 'Stock final produit (pièces)', type: 'int' },
      { key: 'emballage_remarques', label: 'Remarques emballage', type: 'text' },
    ],
  },
]

export const EDIT_NUMERIC_KEYS = EDIT_GROUPS.flatMap((g) =>
  g.fields.filter((f) => f.type !== 'text').map((f) => f.key)
)
export const EDIT_TEXT_KEYS = EDIT_GROUPS.flatMap((g) =>
  g.fields.filter((f) => f.type === 'text').map((f) => f.key)
)

// Construit le payload d'update à partir d'un draft (objet à plat).
export function buildProductionPayload(draft) {
  const payload = {
    entry_date: draft.entry_date,
    equipe: draft.equipe,
    poste: draft.poste,
    operateur: String(draft.operateur ?? '').trim() || null,
    produit: draft.produit,
    presse_numeros: String(draft.presse_numeros ?? '').trim() || null,
  }
  for (const k of EDIT_NUMERIC_KEYS) payload[k] = toNum(draft[k])
  for (const k of EDIT_TEXT_KEYS) payload[k] = String(draft[k] ?? '').trim() || null
  return payload
}
