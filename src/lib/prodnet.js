// Constantes et helpers du module Prodnet (suivi du coût de revient des
// produits finis) : produits finis, matières premières, fabrication.
//
// Fabrication = on consomme des matières premières pour produire un produit
// fini. Le coût de fabrication (somme quantité × prix moyen des matières)
// alimente le prix moyen pondéré du produit fini.

export const MATIERE_UNITES = ['U', 'KG', 'T', 'L', 'M', 'M²', 'M³', 'SAC', 'PALETTE']

export function toNum(value) {
  if (value === '' || value == null) return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })
}

// Total d'une ligne matière consommée = quantité utilisée × prix moyen.
export function ligneTotal(quantite, prixUnitaire) {
  return toNum(quantite) * toNum(prixUnitaire)
}

// Coût total de fabrication = somme des totaux de lignes matières.
export function computeCoutTotal(matieres) {
  return (matieres ?? []).reduce((s, m) => s + (Number(m.total) || 0), 0)
}

export function computeCoutUnitaire(coutTotal, quantiteProduite) {
  const q = toNum(quantiteProduite)
  return q > 0 ? toNum(coutTotal) / q : 0
}

// Résumé court des matières d'une fabrication pour l'affichage en liste.
export function matieresSummary(matieres) {
  if (!Array.isArray(matieres) || matieres.length === 0) return '—'
  const first = matieres[0]?.designation ?? '—'
  return matieres.length === 1 ? first : `${first} +${matieres.length - 1}`
}

export function matieresText(matieres) {
  if (!Array.isArray(matieres) || matieres.length === 0) return ''
  return matieres
    .map((m) => `${m.designation} ×${formatQty(m.quantite_utilisee)} @ ${formatDA(m.prix_unitaire)} = ${formatDA(m.total)}`)
    .join(' ; ')
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// --- Constitution (nomenclature) d'un produit fini -------------------------
// JSON : [{ matiere_id, matiere_designation, quantite, prix_unitaire }]

export function constitutionArray(value) {
  return Array.isArray(value) ? value : []
}

export function constitutionSummary(constitution) {
  const list = constitutionArray(constitution)
  if (list.length === 0) return '—'
  if (list.length === 1) return list[0].matiere_designation ?? '1 matière'
  return `${list.length} matières`
}

// Coût de revient estimé = somme(quantite × prix_unitaire).
export function constitutionCost(constitution) {
  return constitutionArray(constitution).reduce(
    (s, c) => s + toNum(c.quantite) * toNum(c.prix_unitaire),
    0
  )
}

// Lignes texte « — DÉSIGNATION : q × prix DA = total DA » (impression / détail).
export function constitutionLines(constitution) {
  return constitutionArray(constitution).map((c) => {
    const total = toNum(c.quantite) * toNum(c.prix_unitaire)
    return `— ${c.matiere_designation} : ${formatQty(c.quantite)} × ${formatDA(c.prix_unitaire)} DA = ${formatDA(total)} DA`
  })
}

// --- Import (rapprochement avec l'existant) --------------------------------

// Prochain numéro de référence DPR0### disponible. Ne considère QUE les
// références déjà au format canonique DPR + 4 chiffres (ex. DPR0084) ; les
// références historiques mal formées (DPR2009, DPR20011, DPR00203…) sont
// ignorées pour ce calcul -- ce sont des anomalies de saisie manuelle, pas
// la vraie séquence, et les inclure ferait sauter la numérotation à des
// valeurs absurdes (ex. DPR20012).
export function nextProductReferenceNumber(existingReferences) {
  let max = 0
  for (const ref of existingReferences ?? []) {
    const m = /^DPR(\d{4})$/i.exec(String(ref ?? '').trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export function formatProductReference(n) {
  return `DPR${String(n).padStart(4, '0')}`
}

// Libellé d'unité "long" (fichiers d'import V2, ex. "Nombre d'unités
// individuelles ou de pièces") -> code court utilisé par prodnet_matieres.unite
// (voir MATIERE_UNITES ci-dessus). Repli sur 'U' si non reconnu.
const UNITE_LABEL_MAP = {
  'NOMBRE D UNITES INDIVIDUELLES OU DE PIECES': 'U',
  KILOGRAMME: 'KG',
  TONNE: 'T',
  LITRE: 'L',
  METRE: 'M',
  'METRE CARRE': 'M²',
  'METRE CUBE': 'M³',
}

function normalizeUniteLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export function translateUniteLabel(value) {
  return UNITE_LABEL_MAP[normalizeUniteLabel(value)] ?? 'U'
}

// --- Détection de quasi-doublons (aperçu d'import) --------------------------
// Repère les paires de désignations très proches (fautes de frappe probables,
// ex. "ABS ELECTRIC COIL" / "ABS ELECTRIC COILS") pour avertir avant import,
// sans bloquer -- l'utilisateur décide (décoche une ligne s'il s'agit bien
// d'un doublon). Deux garde-fous contre les faux positifs, nombreux dans une
// nomenclature de pièces détachées :
//   - les nombres contenus dans chaque désignation doivent être identiques
//     (sinon "IPE 120" / "IPE 100" ou "LAME N° 3" / "LAME N° 5", qui sont des
//     pièces RÉELLEMENT différentes, seraient signalées à tort) ;
//   - la distance d'édition doit rester à la fois petite en absolu
//     (maxDistance) ET petite par rapport à la longueur du nom (maxRatio).
// Calibré empiriquement sur les fichiers réels : à ces seuils, les deux
// paires connues (ABS ELECTRIC COIL/COILS, CORP(S) D'ESSI(U/E)EX…) sont
// détectées, avec un taux de faux positifs raisonnable (~12 % des noms sur
// 638 matières premières réelles).
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

function normalizeForCompare(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function digitTokens(normalized) {
  return (normalized.match(/\d+/g) ?? []).sort().join(',')
}

// `designations` : tableau de chaînes (fusion lignes du fichier + désignations
// déjà en base, par ex.). Renvoie une Map désignation d'origine -> liste des
// autres désignations d'origine jugées quasi-identiques.
export function findNearDuplicates(designations, { maxDistance = 4, maxRatio = 0.15 } = {}) {
  const unique = [...new Set((designations ?? []).filter(Boolean))]
  const items = unique
    .map((original) => {
      const norm = normalizeForCompare(original)
      return { original, norm, digits: digitTokens(norm) }
    })
    .sort((a, b) => a.norm.length - b.norm.length)

  const result = new Map()
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      const lenDiff = b.norm.length - a.norm.length
      if (lenDiff > maxDistance) break // trié par longueur -> plus rien à comparer pour `a`
      if (a.norm === b.norm || a.digits !== b.digits) continue
      const maxLen = Math.max(a.norm.length, b.norm.length)
      if (maxLen === 0) continue
      const dist = levenshtein(a.norm, b.norm)
      if (dist === 0 || dist > maxDistance || dist / maxLen > maxRatio) continue
      if (!result.has(a.original)) result.set(a.original, [])
      if (!result.has(b.original)) result.set(b.original, [])
      result.get(a.original).push(b.original)
      result.get(b.original).push(a.original)
    }
  }
  return result
}
