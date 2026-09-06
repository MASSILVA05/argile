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

function buildDocumentHtml({ title, subtitle, columns, rows, totalsRows, filters, orientation }) {
  const dataFontPt = columns.length >= 13 ? 7 : 8

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

  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  th, td {
    border: 1px solid #000000;
    padding: 3px 6px;
    font-size: ${dataFontPt}pt;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }
  th {
    background: #e0e0e0;
    font-weight: bold;
    font-size: ${dataFontPt + 1}pt;
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

export function printRegistry({
  title = 'SARL DPR AXXAM BRIQUETERIE',
  subtitle = '',
  columns,
  rows,
  totals,
  filters,
  orientation = 'landscape',
}) {
  const totalsRows = Array.isArray(totals) ? totals : totals ? [totals] : []
  const html = buildDocumentHtml({ title, subtitle, columns, rows, totalsRows, filters, orientation })

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
