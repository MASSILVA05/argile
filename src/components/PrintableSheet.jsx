// Fiche imprimable A4 portrait, fond blanc/texte noir imposé quel que soit
// le thème sombre de l'app (voir .printable-sheet dans index.css, y compris
// la règle @page nommée "fiche-a4" qui force le portrait à l'impression --
// distincte du @page paysage utilisé par les registres classiques).
//
// `columns`: [{ key, header, align: 'left'|'right', format?: (value) => string }]
// `rows`: objets bruts (valeurs numériques/texte, PAS pré-formatées) --
// `column.format` est appliqué au rendu, aussi bien pour les lignes de
// données que pour les lignes de totaux (`totalRows[].cells`), qui suivent
// exactement la même forme que `rows` (clé de colonne -> valeur brute).
export default function PrintableSheet({ title, subtitle, periodLabel, extra, columns, rows, totalRows, emptyMessage }) {
  function formatCell(column, value) {
    if (value == null || value === '') return ''
    return column.format ? column.format(value) : value
  }

  return (
    <div className="printable-sheet">
      <div className="printable-sheet-header">
        <p className="printable-sheet-company">SARL DPR AXXAM</p>
        <h1 className="printable-sheet-title">{title}</h1>
        {subtitle && <p className="printable-sheet-subtitle">{subtitle}</p>}
        {periodLabel && <p className="printable-sheet-period">{periodLabel}</p>}
      </div>

      {extra && <div className="printable-sheet-extra">{extra}</div>}

      {rows.length === 0 ? (
        <p className="printable-sheet-empty">{emptyMessage || 'Aucune opération sur cette période.'}</p>
      ) : (
        <table className="printable-sheet-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align || 'left' }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align || 'left' }}>
                    {formatCell(c, row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totalRows?.length > 0 && (
            <tfoot>
              {totalRows.map((t, i) => (
                <tr key={i} className={t.highlight ? 'printable-sheet-highlight' : ''}>
                  {columns.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align || 'left' }}>
                      {formatCell(c, t.cells[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      )}
    </div>
  )
}
