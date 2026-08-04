import { useEffect, useState } from 'react'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function startOfWeekISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // 0 = lundi
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

function endOfWeekISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() + (6 - day))
  return d.toISOString().slice(0, 10)
}

function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function endOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

export default function ExportFilterModal({
  open,
  categorical, // { field, label, options: string[] } | undefined
  textFilters = [], // [{ field, label, suggestions: string[] }]
  hasPhotos = true,
  error,
  onExport, // (filters, includePhotos) => void
  onCancel,
}) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedCategorical, setSelectedCategorical] = useState([])
  const [textValues, setTextValues] = useState({})

  useEffect(() => {
    if (!open) return
    setStartDate(startOfMonthISO())
    setEndDate(endOfMonthISO())
    setSelectedCategorical(categorical ? [...categorical.options] : [])
    setTextValues(Object.fromEntries(textFilters.map((f) => [f.field, ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  function toggleCategorical(value) {
    setSelectedCategorical((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    )
  }

  function handleExport(includePhotos) {
    onExport(
      {
        startDate: startDate || null,
        endDate: endDate || null,
        categoricalValues: categorical ? selectedCategorical : null,
        textValues,
      },
      includePhotos
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="my-8 w-full max-w-md rounded-xl border border-border bg-bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 font-display text-lg text-ink">Filtrer l'export</h2>

        <div className="mb-4 flex flex-col gap-2">
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
            <QuickButton onClick={() => { setStartDate(todayISO()); setEndDate(todayISO()) }}>
              Aujourd'hui
            </QuickButton>
            <QuickButton onClick={() => { setStartDate(startOfWeekISO()); setEndDate(endOfWeekISO()) }}>
              Cette semaine
            </QuickButton>
            <QuickButton onClick={() => { setStartDate(startOfMonthISO()); setEndDate(endOfMonthISO()) }}>
              Ce mois
            </QuickButton>
            <QuickButton onClick={() => { setStartDate(''); setEndDate('') }}>Tout</QuickButton>
          </div>
        </div>

        {categorical && (
          <div className="mb-4">
            <p className="mb-1 text-sm text-ink-muted">{categorical.label}</p>
            <div className="flex flex-col gap-1">
              {categorical.options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={selectedCategorical.includes(opt)}
                    onChange={() => toggleCategorical(opt)}
                    className="h-4 w-4 accent-terracotta"
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        )}

        {textFilters.map((f) => (
          <div key={f.field} className="mb-4 flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">{f.label}</span>
            <input
              type="text"
              list={`export-${f.field}-list`}
              value={textValues[f.field] ?? ''}
              onChange={(e) => setTextValues((v) => ({ ...v, [f.field]: e.target.value }))}
              className={inputClass}
              placeholder="tous"
              autoComplete="off"
            />
            <datalist id={`export-${f.field}-list`}>
              {f.suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        ))}

        {error && <p className="mb-3 text-sm text-terracotta">{error}</p>}

        <div className="flex flex-col gap-2">
          {hasPhotos ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => handleExport(true)}
                className="min-h-11 flex-1 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover"
              >
                Exporter avec photos
              </button>
              <button
                type="button"
                onClick={() => handleExport(false)}
                className="min-h-11 flex-1 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10"
              >
                Exporter sans photos
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleExport(false)}
              className="min-h-11 w-full rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover"
            >
              Exporter
            </button>
          )}
          <button type="button" onClick={onCancel} className="w-full text-center text-sm text-ink-muted">
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}

function QuickButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border px-3 py-1 text-xs text-ink-muted hover:border-terracotta hover:text-terracotta"
    >
      {children}
    </button>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
