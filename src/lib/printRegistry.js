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

  .doc-header { text-align: center; margin: 0 0 4px; }
  .doc-company { font-size: 14pt; font-weight: bold; margin: 0; letter-spacing: 0.3px; }
  .doc-subtitle { font-size: 12pt; font-weight: bold; margin: 3px 0 0; }
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
  <div class="doc-header">
    <p class="doc-company">${escapeHtml(title)}</p>
    ${subtitle ? `<p class="doc-subtitle">${escapeHtml(subtitle)}</p>` : ''}
  </div>
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
  title = 'SARL DPR AXXAM BRIQUETERIE',
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
// Impression dédiée au registre de fabrication : UNE FICHE PAR FABRICATION
// (en-tête d'infos + tableau 4 colonnes des matières + total + coût unitaire),
// séparées par un filet, saut de page automatique entre elles.
// ============================================================
function fabricationSectionHtml(fab, index) {
  const mats = Array.isArray(fab.matieres) ? fab.matieres : []
  const totalQte = mats.reduce((s, m) => s + (Number(m.quantite_utilisee) || 0), 0)
  const totalCout =
    Number(fab.cout_total) || mats.reduce((s, m) => s + (Number(m.total) || 0), 0)
  const qteProduite = Number(fab.quantite_produite) || 0
  const coutUnit =
    Number(fab.cout_unitaire) || (qteProduite > 0 ? totalCout / qteProduite : 0)

  const bodyRows = mats.length
    ? mats
        .map(
          (m) => `<tr>
        <td>${escapeHtml(m.designation)}</td>
        <td class="right">${escapeHtml(nfQty(m.quantite_utilisee))}</td>
        <td class="right">${escapeHtml(nf2(m.prix_unitaire))}</td>
        <td class="right">${escapeHtml(nf2(m.total))}</td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="empty">Aucune matière première.</td></tr>`

  const produit = [fab.product_reference, fab.product_designation].filter(Boolean).join(' — ') || '—'

  return `<section class="fab">
    <div class="fab-head">
      <p class="fab-title">FABRICATION N° ${index} — Date : ${escapeHtml(dateFR(fab.entry_date))}</p>
      <p>Produit : ${escapeHtml(produit)}</p>
      <p>Quantité produite : ${escapeHtml(nfQty(fab.quantite_produite))}</p>
      <p>Saisi par : ${escapeHtml(fab.entered_by_user || '—')}</p>
    </div>
    <table class="fab-table">
      <colgroup><col style="width:40%"><col style="width:15%"><col style="width:20%"><col style="width:25%"></colgroup>
      <thead>
        <tr>
          <th>Matière première</th>
          <th class="right">Qté utilisée</th>
          <th class="right">Prix unitaire (DA)</th>
          <th class="right">Total (DA)</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr class="ft-total">
          <td>TOTAL</td>
          <td class="right">${escapeHtml(nfQty(totalQte))}</td>
          <td></td>
          <td class="right">${escapeHtml(nf2(totalCout))}</td>
        </tr>
        <tr class="ft-unit">
          <td>Coût unitaire</td>
          <td></td>
          <td></td>
          <td class="right">${escapeHtml(nf2(coutUnit))}</td>
        </tr>
      </tfoot>
    </table>
  </section>`
}

export function printFabrications(fabrications, { title = 'SARL DPR AXXAM', subtitle = 'Fiches de Fabrication' } = {}) {
  const list = Array.isArray(fabrications) ? fabrications : []
  const sections = list.length
    ? list.map((f, i) => fabricationSectionHtml(f, i + 1)).join('')
    : `<p class="empty">Aucune fabrication sélectionnée.</p>`

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subtitle)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 9pt; padding: 10px 14px; }

  @page { size: A4 portrait; margin: 1.5cm; }

  .doc-header { text-align: center; margin: 0 0 4px; }
  .doc-company { font-size: 14pt; font-weight: bold; margin: 0; letter-spacing: 0.3px; }
  .doc-subtitle { font-size: 12pt; font-weight: bold; margin: 3px 0 0; }
  .doc-meta-line { text-align: right; font-size: 9pt; color: #333333; margin-top: 6px; }
  .doc-rule { border: none; border-top: 1.5px solid #000000; margin: 4px 0 12px; }

  .fab {
    page-break-inside: avoid;
    margin: 0 0 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid #000000;
  }
  .fab:last-child { border-bottom: none; }

  .fab-head {
    border-bottom: 1.5px solid #000000;
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  .fab-head p { margin: 1px 0; font-size: 9pt; }
  .fab-title { font-weight: bold; font-size: 11pt !important; }

  .fab-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
  .fab-table th, .fab-table td {
    border: 1px solid #000000;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .fab-table th { background: #e0e0e0; font-weight: bold; }
  .fab-table .right { text-align: right; }
  .fab-table tfoot td { font-weight: bold; background: #f0f0f0; }
  .fab-table tr.ft-total td { border-top: 1.5px solid #000000; }
  .fab-table td.empty { text-align: center; color: #555555; font-style: italic; }

  p.empty { text-align: center; color: #555555; font-style: italic; padding: 24px 0; }

  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="doc-header">
    <p class="doc-company">${escapeHtml(title)}</p>
    <p class="doc-subtitle">${escapeHtml(subtitle)}</p>
  </div>
  <div class="doc-meta-line">Imprimé le ${escapeHtml(formatPrintedAt(new Date()))}</div>
  <hr class="doc-rule">
  ${sections}
</body>
</html>`

  openAndPrint(html)
}
