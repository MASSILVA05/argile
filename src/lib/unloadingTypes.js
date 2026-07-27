export const UNLOADING_TYPES = ['DPR AXXAM Location', 'Akbou', 'DPR AXXAM (22T)']
export const FIXED_WEIGHT_TYPE = 'DPR AXXAM (22T)'
export const FIXED_WEIGHT_TONS = 22

// DA/tonne. "DPR AXXAM Location" : on paye le loueur. "Akbou" : on est payé. "22T" : pas de paiement (poids fixe, pas de pesée).
const RATE_PER_TON = {
  'DPR AXXAM Location': 350,
  Akbou: 500,
  [FIXED_WEIGHT_TYPE]: 0,
}

export function rateFor(unloadingType) {
  return RATE_PER_TON[unloadingType] ?? 0
}

export function computeAmount(entry) {
  const rate = rateFor(entry.unloading_type)
  if (!rate || entry.weight_tons == null || entry.weight_tons === '') return null
  return Number(entry.weight_tons) * rate
}

export function formatDA(amount) {
  return `${Math.round(amount).toLocaleString('fr-FR')} DA`
}
