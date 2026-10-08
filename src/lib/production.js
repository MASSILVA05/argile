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

export const COMBUSTIBLES = ['Gaz naturel', 'GPL', 'Fuel']

export const EMBALLAGE_TYPES = ['Palette', 'Vrac', 'Cerclé']

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

// Taux de 1er choix (%) = 1er choix / (1er + 2ème + rebut) × 100.
export function computeTauxPremierChoix(premier, deuxieme, rebut) {
  const total = toNum(premier) + toNum(deuxieme) + toNum(rebut)
  if (total <= 0) return 0
  return (toNum(premier) / total) * 100
}

// Ratio en % (null si dénominateur nul -> « — » à l'affichage).
export function ratioPercent(num, den) {
  const d = toNum(den)
  return d > 0 ? (toNum(num) / d) * 100 : null
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

// Pièces bonnes d'une ligne (base conso gaz / rendement) : pièces conformes,
// à défaut 1er + 2ème choix du classement qualité.
export function entryPiecesBonnes(entry) {
  const conformes = toNum(entry.defourn_conformes)
  if (conformes > 0) return conformes
  return toNum(entry.defourn_premier_choix) + toNum(entry.defourn_deuxieme_choix)
}

// Analyse du texte libre « Remarques arrêts » de la presse, ex :
//   « Arrêt 30min — bourrage ; Arrêt 1h15 - panne moteur »
// Un arrêt par segment (séparateurs ; / retour ligne / « + »). Durées
// reconnues : 30min, 30 mn, 1h, 1h30, 1,5h, 2 heures. Cause = texte après
// le tiret / deux-points, sinon le reste du segment sans la durée.
export function parseArrets(text) {
  const out = []
  for (const raw of String(text ?? '').split(/[;\n+]/)) {
    const seg = raw.trim()
    if (!seg) continue
    let minutes = 0
    const hm = seg.match(/(\d+(?:[.,]\d+)?)\s*(?:h|heures?)\s*(\d{1,2})?(?!\w)/i)
    const mn = seg.match(/(\d+)\s*(?:min(?:utes?)?|mn)\b/i)
    if (hm) minutes = toNum(hm[1]) * 60 + toNum(hm[2])
    else if (mn) minutes = toNum(mn[1])
    const sep = seg.match(/[—–:-]\s*(.+)$/)
    let cause = sep ? sep[1] : seg
    cause = cause
      .replace(/(\d+(?:[.,]\d+)?)\s*(?:h|heures?)\s*(\d{1,2})?(?!\w)/gi, '')
      .replace(/(\d+)\s*(?:min(?:utes?)?|mn)\b/gi, '')
      .replace(/^\s*arr[êe]ts?\b/i, '')
      .replace(/^[\s—–:-]+|[\s—–:-]+$/g, '')
      .trim()
      .toLowerCase()
    out.push({ minutes, cause: cause || 'non précisée' })
  }
  return out
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
// type: 'int' | 'num' | 'text' | 'select' (options)
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
      { key: 'presse_moule', label: 'N° moule', type: 'text' },
      { key: 'presse_qte_rangee', label: 'Quantité par rangée', type: 'int' },
      { key: 'presse_temps_cycle', label: 'Temps de cycle (s)', type: 'num' },
      { key: 'presse_arrets', label: 'Remarques arrêts', type: 'text' },
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
      { key: 'sechoir_humidite_entree', label: 'Humidité entrée (%)', type: 'num' },
      { key: 'sechoir_humidite_sortie', label: 'Humidité sortie (%)', type: 'num' },
      { key: 'sechoir_temp_zone1', label: 'Température zone 1 (°C)', type: 'num' },
      { key: 'sechoir_temp_zone2', label: 'Température zone 2 (°C)', type: 'num' },
      { key: 'sechoir_duree', label: 'Temps de séchage total (h)', type: 'num' },
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
      { key: 'four_combustible', label: 'Type de combustible', type: 'select', options: COMBUSTIBLES },
      { key: 'four_temperature', label: 'Température four (°C)', type: 'num' },
      { key: 'four_temp_prechauffe', label: 'Temp. préchauffage (°C)', type: 'num' },
      { key: 'four_temp_cuisson', label: 'Temp. cuisson (°C)', type: 'num' },
      { key: 'four_temp_refroid', label: 'Temp. refroidissement (°C)', type: 'num' },
      { key: 'four_pression', label: 'Pression four (mbar)', type: 'num' },
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
      { key: 'defourn_premier_choix', label: '1er choix', type: 'int' },
      { key: 'defourn_deuxieme_choix', label: '2ème choix', type: 'int' },
      { key: 'defourn_rebut', label: 'Rebut', type: 'int' },
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
      { key: 'emballage_type', label: "Type d'emballage", type: 'select', options: EMBALLAGE_TYPES },
      { key: 'emballage_destination', label: 'Destination', type: 'text' },
      { key: 'emballage_poids_palette', label: 'Poids palette (kg)', type: 'num' },
      { key: 'emballage_remarques', label: 'Remarques emballage', type: 'text' },
    ],
  },
]

export const EDIT_NUMERIC_KEYS = EDIT_GROUPS.flatMap((g) =>
  g.fields.filter((f) => f.type === 'int' || f.type === 'num').map((f) => f.key)
)
export const EDIT_TEXT_KEYS = EDIT_GROUPS.flatMap((g) =>
  g.fields.filter((f) => f.type === 'text' || f.type === 'select').map((f) => f.key)
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
