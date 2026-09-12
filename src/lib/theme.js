// Bascule mode sombre / mode clair. Persisté en localStorage ; appliqué via
// l'attribut [data-theme] sur <html>, lu par les variables CSS dans
// src/index.css (voir le bloc `[data-theme="light"]`). Le thème par défaut
// (aucune préférence enregistrée, ou localStorage indisponible) est 'dark'.
//
// Le flash-of-wrong-theme au chargement est évité par un petit script inline
// dans index.html qui applique la même clé AVANT que React (et le CSS) ne
// s'exécutent -- garder les deux synchronisés si la clé change ici.
const STORAGE_KEY = 'axxam-theme'

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)

  // Teinte la barre d'adresse / status bar mobile (meta theme-color) en
  // accord avec le fond principal du thème actif.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f5f7' : '#1a1a2e')

  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // localStorage indisponible (navigation privée, quota...) : le thème
    // reste appliqué pour la session en cours, simplement pas persisté.
  }
}
