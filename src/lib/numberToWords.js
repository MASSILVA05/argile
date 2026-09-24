// Conversion d'un montant en toutes lettres (français), pour la mention
// légale « Arrêté la présente facture à la somme de : ... » sur la facture
// imprimée (voir printInvoices dans printRegistry.js).

const UNITS = [
  '', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf',
]
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']

// 0-99
function twoDigitsToWords(n) {
  if (n < 20) return UNITS[n]
  const ten = Math.floor(n / 10)
  const unit = n % 10
  // soixante-dix (70-79) et quatre-vingt-dix (90-99) : dizaine 60/80 + 10-19.
  // « et » uniquement pour 71 (soixante et onze) -- jamais pour 91
  // (quatre-vingt-onze).
  if (ten === 7 || ten === 9) {
    if (unit === 1 && ten === 7) return `${TENS[ten]} et ${UNITS[10 + unit]}`
    return `${TENS[ten]}-${UNITS[10 + unit]}`
  }
  if (unit === 0) return ten === 8 ? 'quatre-vingts' : TENS[ten]
  if (unit === 1 && ten !== 8) return `${TENS[ten]} et un`
  return `${TENS[ten]}-${UNITS[unit]}`
}

// 0-999
function threeDigitsToWords(n) {
  const h = Math.floor(n / 100)
  const rest = n % 100
  let words = ''
  if (h > 0) {
    words = h === 1 ? 'cent' : `${UNITS[h]} cent`
    if (h > 1 && rest === 0) words += 's'
  }
  if (rest > 0) words += (words ? ' ' : '') + twoDigitsToWords(rest)
  return words || 'zéro'
}

const SCALES = [
  { value: 1_000_000_000, singular: 'milliard', plural: 'milliards' },
  { value: 1_000_000, singular: 'million', plural: 'millions' },
  { value: 1_000, singular: 'mille', plural: 'mille' },
]

function integerToWords(n) {
  if (n === 0) return 'zéro'
  let remaining = n
  const parts = []
  for (const scale of SCALES) {
    const count = Math.floor(remaining / scale.value)
    if (count > 0) {
      if (scale.value === 1000 && count === 1) {
        parts.push('mille')
      } else {
        const label = count > 1 ? scale.plural : scale.singular
        parts.push(`${threeDigitsToWords(count)} ${label}`)
      }
      remaining -= count * scale.value
    }
  }
  if (remaining > 0 || parts.length === 0) parts.push(threeDigitsToWords(remaining))
  return parts.join(' ')
}

// Montant (DA) -> "Cent quarante et un mille quatre cent treize dinars
// algériens" (+ « et XX centimes » si décimales non nulles).
export function numberToFrenchWords(amount) {
  const n = Math.round(Math.abs(Number(amount) || 0) * 100) / 100
  const integerPart = Math.floor(n)
  const centimes = Math.round((n - integerPart) * 100)

  let result = `${integerToWords(integerPart)} dinar${integerPart > 1 ? 's' : ''} algérien${integerPart > 1 ? 's' : ''}`
  if (centimes > 0) {
    result += ` et ${integerToWords(centimes)} centime${centimes > 1 ? 's' : ''}`
  }
  return result.charAt(0).toUpperCase() + result.slice(1)
}
