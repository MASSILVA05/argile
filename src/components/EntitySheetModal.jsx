import { useEffect, useState } from 'react'
import PrintableSheet from './PrintableSheet'
import { downloadSheetExcel } from '../lib/sheetExcel'
import { printRegistry } from '../lib/printRegistry'
import { QUICK_PERIODS, defaultPeriod } from '../lib/period'

// Modale générique "Fiche" réutilisée par tous les registres : choix d'une
// entité (fournisseur/transporteur/client/chauffeur/matricule selon le
// module appelant, via `types`) + période, puis génère une fiche imprimable
// A4 (PrintableSheet) avec impression et export Excel. `onGenerate` fait
// tout le travail spécifique au module (filtrage des données déjà chargées
// dans le registre, mise en forme des colonnes/totaux) et renvoie les
// données de la fiche ; cette modale ne connaît rien du domaine métier.
export default function EntitySheetModal({
  open,
  onClose,
  modalTitle = 'Générer une fiche',
  types, // [{ id, label }] | null (pas de sélecteur de type si null/absent)
  initialType,
  nameLabel = 'Nom',
  nameOptions, // (typeId) => string[]
  onGenerate, // (typeId, name, startDate, endDate) => sheetData | { error }
  excelSheetName = 'Fiche',
}) {
  const [typeId, setTypeId] = useState(initialType ?? types?.[0]?.id ?? null)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTypeId(initialType ?? types?.[0]?.id ?? null)
    setName('')
    const { startDate: s, endDate: e } = defaultPeriod()
    setStartDate(s)
    setEndDate(e)
    setSheet(null)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialType])

  if (!open) return null

  const currentType = types?.find((t) => t.id === typeId) ?? null
  const options = nameOptions ? nameOptions(typeId) : []
  const effectiveNameLabel = currentType?.nameLabel ?? nameLabel

  function handleGenerate() {
    if (!name.trim()) {
      setError(`Le champ "${effectiveNameLabel}" est obligatoire.`)
      return
    }
    const result = onGenerate(typeId, name.trim(), startDate || '', endDate || '')
    if (result?.error) {
      setError(result.error)
      return
    }
    setError('')
    setSheet(result)
  }

  async function handleExport() {
    if (!sheet) return
    setExporting(true)
    try {
      await downloadSheetExcel(
        {
          sheetName: excelSheetName,
          title: sheet.title,
          subtitle: sheet.subtitle,
          periodLabel: sheet.periodLabel,
          columns: sheet.columns,
          rows: sheet.rows,
          totalRows: sheet.totalRows,
        },
        { filename: sheet.excelFilename }
      )
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  function handleClose() {
    onClose()
  }

  function handlePrint() {
    if (!sheet) return
    printRegistry({
      title: 'SARL DPR AXXAM BRIQUETERIE',
      subtitle: sheet.title,
      columns: sheet.columns,
      rows: sheet.rows,
      totals: sheet.totalRows,
      filters: sheet.periodLabel,
      orientation: 'portrait',
    })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-0 sm:flex sm:items-center sm:justify-center sm:p-4">
      <div className="min-h-full w-full bg-bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-3xl sm:rounded-xl sm:border sm:border-border">
        <div className="no-print mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">{modalTitle}</h2>
          <button type="button" onClick={handleClose} className="text-sm text-ink-muted hover:text-ink">
            Fermer ✕
          </button>
        </div>

        {!sheet ? (
          <div className="no-print flex flex-col gap-4">
            {types && types.length > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-ink-muted">Type</span>
                <select
                  value={typeId ?? ''}
                  onChange={(e) => {
                    setTypeId(e.target.value)
                    setName('')
                  }}
                  className={inputClass}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-ink-muted">{effectiveNameLabel}</span>
              <input
                type="text"
                list="entity-sheet-name-list"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                autoComplete="off"
                placeholder="Rechercher…"
              />
              <datalist id="entity-sheet-name-list">
                {options.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </label>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-muted">Période</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Du</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-muted">Au</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_PERIODS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const [s, e] = p.range()
                      setStartDate(s)
                      setEndDate(e)
                    }}
                    className="rounded-full border border-border px-3 py-1 text-xs text-ink-muted hover:border-terracotta hover:text-terracotta"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-terracotta">{error}</p>}

            <button
              type="button"
              onClick={handleGenerate}
              className="min-h-11 w-full rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover"
            >
              Générer
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="no-print flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
              >
                Imprimer
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting ? 'Génération…' : 'Exporter Excel'}
              </button>
              <button
                type="button"
                onClick={() => setSheet(null)}
                className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
              >
                Nouvelle fiche
              </button>
            </div>

            {error && <p className="no-print text-sm text-terracotta">{error}</p>}

            <div className="max-h-[65vh] overflow-y-auto rounded-lg">
              <PrintableSheet {...sheet} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
