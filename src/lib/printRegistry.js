// Impression : ouvre une fenêtre séparée contenant un document HTML autonome
// (fond blanc, mise en page « PDF » propre) puis déclenche window.print()
// dessus -- la page principale de l'app n'est jamais imprimée.
//
// Utilisé par le bouton « Imprimer » de chaque registre (table complète
// filtrée à l'écran, paysage) ET par EntitySheetModal (fiches par entité :
// fournisseur / client / chauffeur…, portrait). Le format ci-dessous
// s'applique aux deux : en-tête société, filtre/période, tableau à bordures
// complètes avec en-têtes gris et lignes alternées, totaux en gras séparés
// par un filet, et « Page X / Y » en pied via les compteurs CSS de @page.

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function formatPrintedAt(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Les lignes de totaux peuvent être passées à plat ({clé: valeur}) ou sous la
// forme { cells: {...}, highlight } (fiches / PrintableSheet) : on accepte les
// deux pour réutiliser sheet.totalRows tel quel.
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

export function printRegistry({
  title = 'SARL DPR AXXAM BRIQUETERIE',
  subtitle = '',
  columns,
  rows,
  totals,
  filters,
  orientation = 'landscape',
}) {
  const win = window.open('', '_blank')
  if (!win) {
    window.alert("Impossible d'ouvrir la fenêtre d'impression (bloqueur de pop-up ?). Autorisez les pop-up pour ce site puis réessayez.")
    return
  }

  const totalsRows = Array.isArray(totals) ? totals : totals ? [totals] : []

  // Réduction automatique de la police quand le tableau a beaucoup de colonnes
  // (pour tenir en A4) : 8pt par défaut, 7pt à partir de 13 colonnes.
  const dataFontPt = columns.length >= 13 ? 7 : 8

  const headerHtml = columns
    .map((c) => `<th class="${c.align === 'right' ? 'right' : 'left'}">${escapeHtml(c.label ?? c.header)}</th>`)
    .join('')

  const bodyHtml = rows.length
    ? rows.map((row) => buildRowHtml(columns, row)).join('')
    : `<tr><td class="empty" colspan="${columns.length}">Aucune donnée pour ces critères.</td></tr>`

  const totalsHtml = totalsRows.map((t) => buildRowHtml(columns, t, { total: true })).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(subtitle || title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color: #000000; margin: 0; padding: 0; }
  body {
    font-family: Calibri, Arial, Helvetica, sans-serif;
    font-size: ${dataFontPt}pt;
  }

  @page {
    size: A4 ${orientation};
    margin: 2cm 1.5cm;
    @bottom-center {
      content: "Page " counter(page) " / " counter(pages);
      font-family: Arial, sans-serif;
      font-size: 9pt;
      color: #555555;
    }
  }

  .doc-header { text-align: center; margin-bottom: 6px; }
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
    background: #e2e2e2;
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
  tr.totals-strong td { background: #e2e2e2; }

  td.empty { text-align: center; padding: 16px; color: #555555; font-style: italic; }
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
  <hr class="doc-rule" />
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
    ${totalsHtml ? `<tfoot>${totalsHtml}</tfoot>` : ''}
  </table>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()

  // Laisser un tick au moteur de rendu avant print() (sinon dialogue sur une
  // page pas encore peinte dans certains navigateurs).
  setTimeout(() => {
    win.print()
  }, 200)

  win.onafterprint = () => win.close()
}
