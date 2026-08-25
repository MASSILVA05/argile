// Remplace l'ancien système d'impression (@media print + .print-area/.no-print
// sur la page elle-même, qui imprimait le thème sombre/la navigation malgré
// les tentatives de masquage). Ouvre désormais une fenêtre séparée contenant
// un document HTML autonome (fond blanc, tableau propre), et déclenche
// window.print() dessus -- la page principale de l'app n'est jamais imprimée.
//
// Utilisé à la fois par le bouton "Imprimer" de chaque registre (colonnes
// larges, la table complète actuellement filtrée à l'écran) et par
// EntitySheetModal (fiches par entité, colonnes réduites, portrait).

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function formatPrintedAt(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Les lignes de totaux peuvent être passées soit à plat ({clé: valeur, ...}),
// soit sous la forme { cells: {...}, highlight } déjà utilisée par les
// fiches (EntitySheetModal/PrintableSheet) -- accepte les deux pour pouvoir
// réutiliser sheet.totalRows tel quel sans transformation.
function normalizeRow(row) {
  return row && typeof row === 'object' && 'cells' in row ? row.cells : row
}

function cellValue(column, row) {
  const raw = row[column.key]
  if (raw == null || raw === '') return ''
  return column.format ? column.format(raw) : raw
}

function buildRowHtml(columns, row, { bold = false } = {}) {
  const cells = normalizeRow(row)
  return `<tr${bold ? ' class="totals"' : ''}>${columns
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

  const headerHtml = columns
    .map((c) => `<th class="${c.align === 'right' ? 'right' : 'left'}">${escapeHtml(c.label ?? c.header)}</th>`)
    .join('')

  const bodyHtml = rows.length
    ? rows.map((row) => buildRowHtml(columns, row)).join('')
    : `<tr><td class="empty" colspan="${columns.length}">Aucune donnée pour ces critères.</td></tr>`

  const totalsHtml = totalsRows.map((t) => buildRowHtml(columns, t, { bold: true })).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(subtitle || title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    background: #ffffff;
    color: #000000;
    margin: 0;
    padding: 0;
  }
  body {
    font-family: Arial, Helvetica, sans-serif;
    padding: 16px 20px;
  }
  .header { text-align: center; margin-bottom: 14px; }
  .company { font-size: 16pt; font-weight: bold; margin: 0; }
  .subtitle { font-size: 12pt; font-weight: bold; margin: 4px 0; }
  .meta { font-size: 9pt; color: #333333; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td {
    border: 1px solid #000000;
    padding: 4px 8px;
    font-size: 9pt;
    text-align: left;
  }
  th {
    background: #e0e0e0;
    font-weight: bold;
    font-size: 10pt;
  }
  th.right, td.right { text-align: right; }
  tr.totals td { font-weight: bold; }
  td.empty { text-align: center; padding: 16px; color: #555555; }
  @page {
    size: A4 ${orientation};
    margin: 1.5cm 1cm 2cm 1cm;
  }
</style>
</head>
<body>
  <div class="header">
    <p class="company">${escapeHtml(title)}</p>
    ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
    <p class="meta">Imprimé le ${escapeHtml(formatPrintedAt(new Date()))}</p>
    ${filters ? `<p class="meta">Filtre : ${escapeHtml(filters)}</p>` : ''}
  </div>
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

  // document.write() est parsé de façon synchrone, mais laisser un tick au
  // moteur de rendu avant print() évite un dialogue d'impression sur une
  // page pas encore peinte dans certains navigateurs.
  setTimeout(() => {
    win.print()
  }, 150)

  win.onafterprint = () => win.close()
}
