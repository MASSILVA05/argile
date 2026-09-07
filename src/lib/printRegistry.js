// Impression : construit un document HTML COMPLET et autonome (<!DOCTYPE html>
// + <head><style> + <body>) puis l'ouvre dans une fenêtre séparée via une URL
// Blob de type text/html (garantit le rendu HTML -- pas de "HTML brut" affiché
// comme du texte), et déclenche window.print() une fois la page chargée.
// Repli sur un <iframe> caché si les pop-up sont bloquées.
//
// Utilisé par le bouton « Imprimer » de chaque registre ET par
// EntitySheetModal (fiches par entité, portrait).
//
// NB : seules les VALEURS de cellules sont échappées (escapeHtml) pour éviter
// qu'un contenu contenant « < » casse le tableau ; la structure HTML du
// document n'est jamais échappée.

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function formatPrintedAt(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Formatage nombres fr-FR pour les documents d'impression.
const nf2 = (v) => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nfQty = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })
const dateFR = (iso) => {
  const [y, m, d] = String(iso ?? '').split('-')
  return d && m && y ? `${d}/${m}/${y}` : String(iso ?? '')
}

// Coordonnées société — en-tête de TOUS les documents imprimés.
export const COMPANY_INFO = {
  name: 'SARL DPR AXXAM',
  activity: 'Construction de carrosseries automobiles, remorques et bennes • Briqueterie',
  address: 'Village Tissa, Lieu-dit Tizi — Commune de Smaoun — Wilaya de Béjaïa',
  rc: '08 B 0185858-00/06',
  nif: '000806018585831',
  nis: '000806120009464',
}

// En-tête société standard (4 lignes centrées + filet), commun à printRegistry,
// printFabrications et printProductsConstitution.
const COMPANY_HEADER_CSS = `
  .company-header { text-align: center; margin: 0 0 6px; }
  .ch-name { font-size: 14pt; font-weight: bold; margin: 0; letter-spacing: 0.3px; }
  .ch-activity { font-size: 9pt; margin: 2px 0 0; }
  .ch-address { font-size: 9pt; margin: 1px 0 0; }
  .ch-legal { font-size: 8pt; margin: 1px 0 0; }
  .company-rule { border: none; border-top: 1.5px solid #000000; margin: 6px 0 10px; }
`

function companyHeaderHtml() {
  return `<div class="company-header">
    <p class="ch-name">${escapeHtml(COMPANY_INFO.name)}</p>
    <p class="ch-activity">${escapeHtml(COMPANY_INFO.activity)}</p>
    <p class="ch-address">${escapeHtml(COMPANY_INFO.address)}</p>
    <p class="ch-legal">RC ${escapeHtml(COMPANY_INFO.rc)} — NIF ${escapeHtml(COMPANY_INFO.nif)} — NIS ${escapeHtml(COMPANY_INFO.nis)}</p>
  </div>
  <hr class="company-rule">`
}

// Les lignes de totaux : à plat ({clé: valeur}) ou { cells: {...}, highlight }
// (fiches / PrintableSheet) -- on accepte les deux.
function normalizeRow(row) {
  return row && typeof row === 'object' && 'cells' in row ? row.cells : row
}

function isHighlighted(row) {
  return !!(row && typeof row === 'object' && 'cells' in row && row.highlight)
}

function cellValue(column, row) {
  const raw = row[column.key]
  if (raw == null || raw === '') return ''
  return column.format ? column.format(raw) : raw
}

function buildRowHtml(columns, row, { total = false } = {}) {
  const cells = normalizeRow(row)
  const cls = total ? ` class="totals${isHighlighted(row) ? ' totals-strong' : ''}"` : ''
  return `<tr${cls}>${columns
    .map((c) => {
      const align = c.align === 'right' ? 'right' : 'left'
      return `<td class="${align}">${escapeHtml(cellValue(c, cells))}</td>`
    })
    .join('')}</tr>`
}

function buildDocumentHtml({ title, subtitle, columns, rows, totalsRows, filters, orientation, fontSizePt }) {
  const dataFontPt = fontSizePt ?? (columns.length >= 12 ? 7 : 8)

  // Largeurs de colonnes explicites (ex. `width: '34%'`) -> table-layout fixed
  // + <colgroup>, ce qui garde la colonne « Matières » large et les autres
  // compactes. Sinon layout automatique (comportement des autres registres).
  const hasWidths = columns.some((c) => c.width)
  // Tableau « large » (beaucoup de colonnes, sans largeurs explicites) : on
  // laisse les en-têtes se replier aux espaces plutôt que d'imposer une
  // largeur mini qui ferait déborder la page.
  const wideTable = !hasWidths && columns.length >= 12
  const colgroupHtml = hasWidths
    ? `<colgroup>${columns.map((c) => `<col${c.width ? ` style="width:${escapeHtml(c.width)}"` : ''}>`).join('')}</colgroup>`
    : ''

  const headerHtml = columns
    .map((c) => `<th class="${c.align === 'right' ? 'right' : 'left'}">${escapeHtml(c.label ?? c.header)}</th>`)
    .join('')

  const bodyHtml = rows.length
    ? rows.map((row) => buildRowHtml(columns, row)).join('')
    : `<tr><td class="empty" colspan="${columns.length}">Aucune donnée pour ces critères.</td></tr>`

  const totalsHtml = totalsRows.map((t) => buildRowHtml(columns, t, { total: true })).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subtitle || title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body {
    font-family: Calibri, Arial, Helvetica, sans-serif;
    font-size: ${dataFontPt}pt;
    padding: 10px 14px;
  }

  @page {
    size: A4 ${orientation};
    margin: 1.5cm;
  }

  ${COMPANY_HEADER_CSS}
  .doc-title { text-align: center; font-size: 12pt; font-weight: bold; margin: 0 0 4px; }
  .doc-meta-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    font-size: 9pt;
    color: #333333;
    margin-top: 6px;
  }
  .doc-meta-line .left { text-align: left; }
  .doc-meta-line .right { text-align: right; white-space: nowrap; }
  .doc-rule { border: none; border-top: 1.5px solid #000000; margin: 4px 0 10px; }

  table {
    width: 100%;
    border-collapse: collapse;
    ${hasWidths ? 'table-layout: fixed;' : ''}
  }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  th, td {
    border: 1px solid #000000;
    padding: 3px 6px;
    font-size: ${dataFontPt}pt;
    text-align: left;
    vertical-align: top;
    ${wideTable ? '' : 'min-width: 60px;'}
  }
  /* En-têtes : ${wideTable
    ? 'retour à la ligne uniquement aux espaces (jamais mot par mot ni vertical).'
    : 'jamais de retour à la ligne (évite l\'affichage vertical).'} */
  th {
    background: #e0e0e0;
    font-weight: bold;
    font-size: ${dataFontPt + 1}pt;
    white-space: ${wideTable ? 'normal' : 'nowrap'};
    word-break: keep-all;
    overflow-wrap: normal;
  }
  /* Cellules de données : respectent les \\n (matières une par ligne),
     pas de nowrap, coupe les mots trop longs pour ne pas déborder. */
  td {
    white-space: pre-line;
    overflow-wrap: anywhere;
    word-break: normal;
  }
  th.right, td.right { text-align: right; }
  tbody tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #f9f9f9; }

  tr.totals td {
    font-weight: bold;
    background: #f0f0f0;
    border-top: 1.5px solid #000000;
  }
  tr.totals-strong td { background: #e0e0e0; }

  td.empty { text-align: center; padding: 16px; color: #555555; font-style: italic; }

  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  ${companyHeaderHtml()}
  ${subtitle ? `<p class="doc-title">${escapeHtml(subtitle)}</p>` : title ? `<p class="doc-title">${escapeHtml(title)}</p>` : ''}
  <div class="doc-meta-line">
    <span class="left">${filters ? escapeHtml(filters) : ''}</span>
    <span class="right">Imprimé le ${escapeHtml(formatPrintedAt(new Date()))}</span>
  </div>
  <hr class="doc-rule">
  <table>
    ${colgroupHtml}
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
    ${totalsHtml ? `<tfoot>${totalsHtml}</tfoot>` : ''}
  </table>
</body>
</html>`
}

function printViaHiddenIframe(html) {
  const prev = document.getElementById('__dpr_print_frame__')
  if (prev) prev.remove()

  const iframe = document.createElement('iframe')
  iframe.id = '__dpr_print_frame__'
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => setTimeout(() => iframe.remove(), 1000)
  iframe.contentWindow.onafterprint = cleanup
  setTimeout(() => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } catch (err) {
      console.error('Impression iframe impossible :', err)
    }
    cleanup()
  }, 350)
}

// Ouvre un document HTML autonome dans une fenêtre (URL Blob text/html) et
// lance l'impression ; repli iframe si les pop-up sont bloquées.
function openAndPrint(html) {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')

  if (!win) {
    URL.revokeObjectURL(url)
    printViaHiddenIframe(html)
    return
  }

  let printed = false
  const triggerPrint = () => {
    if (printed) return
    printed = true
    try {
      win.focus()
      win.print()
    } catch (err) {
      console.error('Impression fenêtre impossible :', err)
    }
  }

  win.addEventListener('load', triggerPrint)
  // Repli si « load » a déjà eu lieu (blob parfois rendu instantanément).
  setTimeout(triggerPrint, 700)
  win.addEventListener('afterprint', () => {
    try { win.close() } catch { /* ignore */ }
  })
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function printRegistry({
  title = '',
  subtitle = '',
  columns,
  rows,
  totals,
  filters,
  orientation = 'landscape',
  fontSizePt,
}) {
  const totalsRows = Array.isArray(totals) ? totals : totals ? [totals] : []
  const html = buildDocumentHtml({ title, subtitle, columns, rows, totalsRows, filters, orientation, fontSizePt })
  openAndPrint(html)
}

// ============================================================
// FICHE DE FABRICATION : un document officiel A4 portrait par fabrication
// (en-tête société, produit fini, matières premières consommées, récapitulatif
// des coûts, pied de page + signatures). Saut de page entre chaque fiche.
// ============================================================
function ficheFabricationHtml(fab, index) {
  const mats = Array.isArray(fab.matieres) ? fab.matieres : []
  const totalCout =
    Number(fab.cout_total) || mats.reduce((s, m) => s + (Number(m.total) || 0), 0)
  const qteProduite = Number(fab.quantite_produite) || 0
  const coutUnit =
    Number(fab.cout_unitaire) || (qteProduite > 0 ? totalCout / qteProduite : 0)

  const matRows = mats.length
    ? mats
        .map(
          (m, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(m.designation)}</td>
        <td class="right">${escapeHtml(nfQty(m.quantite_utilisee))}</td>
        <td class="right">${escapeHtml(nf2(m.prix_unitaire))}</td>
        <td class="right">${escapeHtml(nf2(m.total))}</td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="empty">Aucune matière première consommée.</td></tr>`

  const noFiche = String(index).padStart(3, '0')

  return `<section class="fiche">
  ${companyHeaderHtml()}

  <p class="fiche-title">FICHE DE FABRICATION N° ${escapeHtml(noFiche)} — Date : ${escapeHtml(dateFR(fab.entry_date))}</p>

  <p class="sec-label">PRODUIT FINI</p>
  <table class="kv">
    <colgroup><col style="width:32%"><col style="width:68%"></colgroup>
    <tbody>
      <tr><td class="k">Référence</td><td>${escapeHtml(fab.product_reference || '—')}</td></tr>
      <tr><td class="k">Désignation</td><td>${escapeHtml(fab.product_designation || '—')}</td></tr>
      <tr><td class="k">Quantité</td><td>${escapeHtml(nfQty(fab.quantite_produite))} unité(s)</td></tr>
      <tr><td class="k">Destination</td><td>Stock produits finis</td></tr>
    </tbody>
  </table>

  <p class="sec-label">MATIÈRES PREMIÈRES CONSOMMÉES</p>
  <table class="mat">
    <colgroup><col style="width:7%"><col style="width:43%"><col style="width:15%"><col style="width:17%"><col style="width:18%"></colgroup>
    <thead>
      <tr>
        <th class="center">N°</th>
        <th>Désignation</th>
        <th class="right">Quantité</th>
        <th class="right">Prix U. (DA)</th>
        <th class="right">Total (DA)</th>
      </tr>
    </thead>
    <tbody>${matRows}</tbody>
    <tfoot>
      <tr class="t-row">
        <td colspan="4">TOTAL MATIÈRES</td>
        <td class="right">${escapeHtml(nf2(totalCout))}</td>
      </tr>
    </tfoot>
  </table>

  <p class="sec-label">RÉCAPITULATIF DES COÛTS</p>
  <table class="kv">
    <colgroup><col style="width:55%"><col style="width:45%"></colgroup>
    <tbody>
      <tr><td class="k">Coût total matières</td><td class="right">${escapeHtml(nf2(totalCout))} DA</td></tr>
      <tr><td class="k">Quantité produite</td><td class="right">${escapeHtml(nfQty(fab.quantite_produite))} unité(s)</td></tr>
      <tr><td class="k strong">Coût unitaire</td><td class="right strong">${escapeHtml(nf2(coutUnit))} DA</td></tr>
    </tbody>
  </table>

  <div class="fiche-foot">
    <span>Saisi par : ${escapeHtml(fab.entered_by_user || '—')}</span>
    <span>Le : ${escapeHtml(formatPrintedAt(new Date()))}</span>
  </div>
  <div class="fiche-sign">
    <div class="sign-box"><span class="sign-line"></span><span class="sign-label">Responsable</span></div>
    <div class="sign-box"><span class="sign-line"></span><span class="sign-label">Directeur</span></div>
  </div>
</section>`
}

export function printFabrications(fabrications) {
  const list = Array.isArray(fabrications) ? fabrications : []
  const sections = list.length
    ? list.map((f, i) => ficheFabricationHtml(f, i + 1)).join('')
    : `<p class="empty">Aucune fabrication sélectionnée.</p>`

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fiches de fabrication</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10pt; }

  @page { size: A4 portrait; margin: 2cm; }

  .fiche { page-break-after: always; }
  .fiche:last-child { page-break-after: auto; }

  ${COMPANY_HEADER_CSS}

  .fiche-title {
    text-align: center;
    font-size: 12pt;
    font-weight: bold;
    margin: 12px 0 14px;
    padding: 5px 0;
    border-top: 3px double #000000;
    border-bottom: 3px double #000000;
  }

  .sec-label {
    font-size: 10pt;
    font-weight: bold;
    margin: 14px 0 4px;
    padding-bottom: 2px;
    border-bottom: 1.5px solid #000000;
  }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.kv, table.mat { border: 3px double #000000; }
  th, td {
    border: 1px solid #000000;
    padding: 4px 7px;
    font-size: 10pt;
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  th { background: #e8e8e8; font-weight: bold; }
  .right { text-align: right; }
  .center { text-align: center; }
  .strong { font-weight: bold; }

  table.kv td.k { background: #f2f2f2; font-weight: bold; }

  table.mat tfoot td {
    font-weight: bold;
    background: #eeeeee;
    border-top: 1.5px solid #000000;
  }
  table.mat td.empty { text-align: center; color: #555555; font-style: italic; }

  .fiche-foot {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    margin-top: 18px;
  }
  .fiche-sign {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    margin-top: 34px;
  }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { display: block; border-top: 1px solid #000000; margin: 0 12px; }
  .sign-label { display: block; font-size: 9pt; margin-top: 3px; }

  p.empty { text-align: center; color: #555555; font-style: italic; padding: 24px 0; }

  @media print { body { padding: 0; } }
</style>
</head>
<body>
  ${sections}
</body>
</html>`

  openAndPrint(html)
}

// ============================================================
// Impression de la liste des produits finis AVEC leur constitution
// (nomenclature). Un bloc par produit : identité + lignes de constitution +
// coût de revient estimé.
// ============================================================
export function printProductsConstitution(products) {
  const list = Array.isArray(products) ? products : []

  const blocks = list.length
    ? list
        .map((p) => {
          const cons = Array.isArray(p.constitution) ? p.constitution : []
          const estime = cons.reduce(
            (s, c) => s + (Number(c.quantite) || 0) * (Number(c.prix_unitaire) || 0),
            0
          )
          const lignes = cons.length
            ? cons
                .map((c) => {
                  const q = Number(c.quantite) || 0
                  const pu = Number(c.prix_unitaire) || 0
                  return `<li>— ${escapeHtml(c.matiere_designation)} : ${escapeHtml(nfQty(q))} × ${escapeHtml(nf2(pu))} DA = ${escapeHtml(nf2(q * pu))} DA</li>`
                })
                .join('')
            : `<li class="none">Constitution non définie.</li>`
          const titre = [p.reference, p.designation].filter(Boolean).join(' — ') || '—'
          return `<div class="prod">
      <p class="prod-title">${escapeHtml(titre)}
        <span class="prod-meta">Stock : ${escapeHtml(nfQty(p.quantite))} · Prix moyen HT : ${escapeHtml(nf2(p.prix_moyen_ht))} DA</span>
      </p>
      <p class="prod-sub">Constitution :</p>
      <ul>${lignes}</ul>
      ${cons.length ? `<p class="prod-cost">Coût de revient estimé : ${escapeHtml(nf2(estime))} DA</p>` : ''}
    </div>`
        })
        .join('')
    : `<p class="empty">Aucun produit fini.</p>`

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Produits finis — constitution</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10pt; padding: 10px 14px; }

  @page { size: A4 portrait; margin: 1.5cm; }

  ${COMPANY_HEADER_CSS}
  .doc-title { text-align: center; font-size: 12pt; font-weight: bold; margin: 0 0 4px; }
  .doc-meta-line { text-align: right; font-size: 9pt; color: #333333; margin-top: 6px; }
  .doc-rule { border: none; border-top: 1.5px solid #000000; margin: 4px 0 12px; }

  .prod {
    page-break-inside: avoid;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #999999;
  }
  .prod-title { font-weight: bold; font-size: 11pt; margin: 0; }
  .prod-meta { font-weight: normal; font-size: 9pt; color: #444444; margin-left: 8px; }
  .prod-sub { font-style: italic; margin: 3px 0 2px; }
  .prod ul { margin: 0 0 4px; padding-left: 14px; list-style: none; }
  .prod li { margin: 1px 0; }
  .prod li.none { font-style: italic; color: #555555; }
  .prod-cost { font-weight: bold; margin: 2px 0 0; }

  p.empty { text-align: center; color: #555555; font-style: italic; padding: 24px 0; }

  @media print { body { padding: 0; } }
</style>
</head>
<body>
  ${companyHeaderHtml()}
  <p class="doc-title">Produits finis — Constitution</p>
  <div class="doc-meta-line">Imprimé le ${escapeHtml(formatPrintedAt(new Date()))}</div>
  <hr class="doc-rule">
  ${blocks}
</body>
</html>`

  openAndPrint(html)
}
