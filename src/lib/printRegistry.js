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

import { numberToFrenchWords } from './numberToWords'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
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
<title>Document</title>
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
    margin: 2cm;
  }
  @media print {
    @page { margin: 2cm; }
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
  ${filters ? `<div class="doc-meta-line"><span class="left">${escapeHtml(filters)}</span></div>` : ''}
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

  // Numéro permanent de la fabrication (fab_number, figé en base par ordre de
  // création). Repli sur la position dans la sélection s'il est absent
  // (colonne fab_number pas encore présente en base).
  const noFiche = (fab.fab_number || index + 1).toString().padStart(3, '0')

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

  <div class="fiche-sign">
    <div class="sign-box"><span class="sign-line"></span><span class="sign-label">Responsable</span></div>
    <div class="sign-box"><span class="sign-line"></span><span class="sign-label">Directeur</span></div>
  </div>
</section>`
}

export function printFabrications(fabrications) {
  const list = Array.isArray(fabrications) ? fabrications : []
  const sections = list.length
    ? list.map((f, i) => ficheFabricationHtml(f, i)).join('')
    : `<p class="empty">Aucune fabrication sélectionnée.</p>`

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10pt; }

  @page { size: A4 portrait; margin: 2cm; }
  @media print {
    @page { margin: 2cm; }
  }

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

  .fiche-sign {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    margin-top: 48px;
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
<title>Document</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10pt; padding: 10px 14px; }

  @page { size: A4 portrait; margin: 2cm; }
  @media print {
    @page { margin: 2cm; }
  }

  ${COMPANY_HEADER_CSS}
  .doc-title { text-align: center; font-size: 12pt; font-weight: bold; margin: 0 0 4px; }
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
  <hr class="doc-rule">
  ${blocks}
</body>
</html>`

  openAndPrint(html)
}

// ============================================================
// FACTURE CLIENT : document officiel A4 portrait à remettre au client
// (en-tête société, identité client, détail produits, totaux, situation du
// compte, montant en lettres, signatures). Une page par facture -- PAS de
// "Saisi par", pas de date/heure d'impression, pas d'URL : c'est un document
// destiné au client, pas un registre interne.
// ============================================================

function invoiceDesignationLabel(inv) {
  return inv.designation === 'Autre' ? inv.designation_other || 'Autre' : inv.designation
}

// Une ligne par produit avec quantité > 0 (B8 / B12 / Autre-H). Repli sur une
// ligne unique si aucune quantité (facture sans détail produit, ex. import
// G50 avec amount_override).
function invoiceDetailRows(inv) {
  const rows = []
  if (Number(inv.qty_b8) > 0) rows.push({ label: 'Brique B8', qty: Number(inv.qty_b8), price: Number(inv.price_b8) })
  if (Number(inv.qty_b12) > 0) rows.push({ label: 'Brique B12', qty: Number(inv.qty_b12), price: Number(inv.price_b12) })
  if (Number(inv.qty_h) > 0) {
    const label = inv.designation === 'Autre' && inv.designation_other ? inv.designation_other : 'Autre (H)'
    rows.push({ label, qty: Number(inv.qty_h), price: Number(inv.price_h) })
  }
  if (rows.length === 0) {
    rows.push({ label: invoiceDesignationLabel(inv), qty: 1, price: Number(inv.amount_override ?? inv.amount) || 0 })
  }
  return rows
}

// Mode de paiement affiché : priorité aux chèques LIÉS (record_cheque_with_invoice,
// peuvent être postérieurs à la saisie) ; à défaut, le chèque saisi
// directement sur la facture (payment_status = 'Chèque') ; sinon le mode de
// règlement classique, ou « — » si rien n'a encore été réglé.
function invoicePaymentModeText(inv, linkedCheques) {
  if (linkedCheques && linkedCheques.length > 0) {
    return linkedCheques.map((c) => `Chèque N° ${c.cheque_number}${c.bank ? ` (${c.bank})` : ''}`).join(', ')
  }
  if (inv.payment_status === 'Chèque' && inv.cheque_number) {
    return `Chèque N° ${inv.cheque_number}${inv.cheque_bank ? ` (${inv.cheque_bank})` : ''}`
  }
  if (inv.payment_status && inv.payment_status !== 'Non payé') return inv.payment_status
  return '—'
}

function factureFicheHtml(inv, { clientInfo, linkedCheques } = {}) {
  const totalNet = Number(inv.total_net) || 0
  const montantPaye = Number(inv.montant_paye) || 0
  const balanceBefore = Number(inv.balance_before) || 0
  const nouveauSolde = balanceBefore + totalNet - montantPaye

  const detailRows = invoiceDetailRows(inv)
  const detailRowsHtml = detailRows
    .map(
      (r, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(r.label)}</td>
        <td class="right">${escapeHtml(nfQty(r.qty))}</td>
        <td class="right">${escapeHtml(nf2(r.price))}</td>
        <td class="right">${escapeHtml(nf2(r.qty * r.price))}</td>
      </tr>`
    )
    .join('')

  // NB : la remise est appliquée AVANT le calcul de la TVA (total_tva =
  // (amount - discount_amount) * 0.19, colonne générée -- voir schema.sql),
  // donc affichée ici juste après le HT brut plutôt qu'en toute dernière
  // ligne comme certaines maquettes papier : ça reste la seule présentation
  // dont l'addition des lignes reconstitue exactement total_net.
  const discountAmount = Number(inv.discount_amount) || 0
  const totalsRowsHtml = [
    { label: 'TOTAL HT', value: inv.amount },
    ...(discountAmount > 0 ? [{ label: 'Remise', value: -discountAmount }] : []),
    { label: 'TVA (19%)', value: inv.total_tva },
    { label: 'Total TTC', value: inv.total_ttc },
    { label: 'Timbre', value: inv.stamp_duty },
  ]
    .map(
      (t) => `<tr>
        <td colspan="3">${escapeHtml(t.label)}</td>
        <td class="right">${escapeHtml(nf2(t.value))}</td>
      </tr>`
    )
    .join('')

  const situationRows = [
    { label: 'Ancien solde', value: `${nf2(balanceBefore)} DA` },
    { label: 'Montant de cette facture', value: `${nf2(totalNet)} DA` },
    ...(montantPaye > 0 ? [{ label: 'Règlement reçu', value: `${nf2(montantPaye)} DA` }] : []),
    { label: 'Mode de paiement', value: invoicePaymentModeText(inv, linkedCheques) },
  ]
    .map((r) => `<tr><td class="k">${escapeHtml(r.label)}</td><td class="right">${escapeHtml(r.value)}</td></tr>`)
    .join('')

  const clientRows = [
    { label: 'Nom', value: inv.client_name },
    { label: 'Code client', value: clientInfo?.client_code },
    { label: 'Adresse', value: clientInfo?.city },
    { label: 'NIF', value: clientInfo?.nif },
  ]
    .map((r) => `<tr><td class="k">${escapeHtml(r.label)}</td><td>${escapeHtml(r.value || '—')}</td></tr>`)
    .join('')

  return `<section class="fiche">
  ${companyHeaderHtml()}

  <p class="fiche-title">FACTURE N° ${escapeHtml(inv.invoice_number)}<br><span class="fiche-date">Date : ${escapeHtml(dateFR(inv.entry_date))}</span></p>

  <p class="sec-label">CLIENT</p>
  <table class="kv">
    <colgroup><col style="width:28%"><col style="width:72%"></colgroup>
    <tbody>${clientRows}</tbody>
  </table>

  <p class="sec-label">DÉTAIL DE LA FACTURE</p>
  <table class="detail">
    <colgroup><col style="width:6%"><col style="width:40%"><col style="width:16%"><col style="width:17%"><col style="width:21%"></colgroup>
    <thead>
      <tr>
        <th class="center">N°</th>
        <th>Désignation</th>
        <th class="right">Quantité</th>
        <th class="right">Prix U. (DA)</th>
        <th class="right">Total (DA)</th>
      </tr>
    </thead>
    <tbody>${detailRowsHtml}</tbody>
    <tfoot>
      ${totalsRowsHtml}
      <tr class="net-row">
        <td colspan="3">TOTAL NET À PAYER</td>
        <td class="right">${escapeHtml(nf2(totalNet))}</td>
      </tr>
    </tfoot>
  </table>

  <p class="sec-label">SITUATION DU COMPTE</p>
  <table class="kv">
    <colgroup><col style="width:45%"><col style="width:55%"></colgroup>
    <tbody>
      ${situationRows}
      <tr class="net-row"><td>NOUVEAU SOLDE</td><td class="right">${escapeHtml(nf2(nouveauSolde))} DA</td></tr>
    </tbody>
  </table>

  <p class="montant-lettres">
    Arrêté la présente facture à la somme de :<br>
    <strong>${escapeHtml(numberToFrenchWords(totalNet))}</strong>
  </p>

  <div class="fiche-sign">
    <div class="sign-box"><span class="sign-line"></span><span class="sign-label">Le Client</span></div>
    <div class="sign-box"><span class="sign-line"></span><span class="sign-label">Le Directeur</span></div>
  </div>
</section>`
}

// invoices : lignes de la table `invoices` (sélectionnées dans InvoiceRegistry).
// extra.clientInfoById : Map<nom_client, { client_code, city }> (déjà chargée
// par le registre). extra.chequesByInvoice : Map<invoice_id, cheque[]>
// (chèques liés, déjà chargée par le registre pour sa colonne "Chèque").
export function printInvoices(invoices, extra = {}) {
  const list = Array.isArray(invoices) ? invoices : []
  const clientInfoByName = extra.clientInfoByName ?? new Map()
  const chequesByInvoice = extra.chequesByInvoice ?? new Map()

  const sections = list.length
    ? list
        .map((inv) =>
          factureFicheHtml(inv, {
            clientInfo: clientInfoByName.get(inv.client_name),
            linkedCheques: chequesByInvoice.get(inv.id),
          })
        )
        .join('')
    : `<p class="empty">Aucune facture sélectionnée.</p>`

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10pt; }

  @page { size: A4 portrait; margin: 2cm; }
  @media print {
    @page { margin: 2cm; }
  }

  .fiche { page-break-after: always; }
  .fiche:last-child { page-break-after: auto; }

  ${COMPANY_HEADER_CSS}

  .fiche-title {
    text-align: center;
    font-size: 13pt;
    font-weight: bold;
    margin: 12px 0 14px;
    padding: 6px 0;
    border-top: 3px double #000000;
    border-bottom: 3px double #000000;
  }
  .fiche-date { font-size: 10pt; font-weight: normal; }

  .sec-label {
    font-size: 10pt;
    font-weight: bold;
    margin: 14px 0 4px;
    padding-bottom: 2px;
    border-bottom: 1.5px solid #000000;
  }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.kv, table.detail { border: 3px double #000000; }
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

  table.kv td.k { background: #f2f2f2; font-weight: bold; width: 40%; }

  table.detail tfoot td {
    font-weight: bold;
    background: #f0f0f0;
    border-top: 1px solid #000000;
  }
  table.detail tfoot tr.net-row td {
    background: #dedede;
    font-size: 12pt;
    border-top: 2px solid #000000;
  }
  table.kv tr.net-row td {
    background: #dedede;
    font-weight: bold;
    font-size: 12pt;
  }

  .montant-lettres {
    margin: 14px 0 0;
    font-size: 10pt;
    line-height: 1.5;
  }

  .fiche-sign {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    margin-top: 56px;
  }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { display: block; border-top: 1px solid #000000; margin: 0 24px; }
  .sign-label { display: block; font-size: 10pt; margin-top: 4px; font-weight: bold; }

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
