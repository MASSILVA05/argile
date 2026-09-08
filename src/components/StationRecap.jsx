import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { printRegistry } from '../lib/printRegistry'
import { periodLabel, QUICK_PERIODS, defaultPeriod } from '../lib/period'
import { formatDA, buildStationRecap, buildStationClientSheet, RECAP_COLUMNS } from '../lib/station'
import { downloadStationRecapExcel } from '../lib/stationExcel'
import EntitySheetModal from './EntitySheetModal'

export default function StationRecap() {
  const initial = defaultPeriod()
  const [startDate, setStartDate] = useState(initial.startDate)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const [{ data: carburant, error: e1 }, { data: lubrifiants }, { data: gaz }] = await Promise.all([
        supabase.from('station_carburant').select('*'),
        supabase.from('station_lubrifiants').select('*'),
        supabase.from('station_gaz').select('*'),
      ])
      if (!active) return
      if (e1) setError(`Erreur de chargement : ${e1.message}`)
      else {
        setData({ carburant: carburant ?? [], lubrifiants: lubrifiants ?? [], gaz: gaz ?? [] })
        setError('')
      }
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('station-recap')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_carburant' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_lubrifiants' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_gaz' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const rows = useMemo(
    () => (data ? buildStationRecap(data, startDate, endDate) : []),
    [data, startDate, endDate]
  )

  const totals = useMemo(() => {
    const sum = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
    return {
      total_carburant: sum('total_carburant'),
      total_lubrifiants: sum('total_lubrifiants'),
      total_gaz: sum('total_gaz'),
      total_general: sum('total_general'),
      paye: sum('paye'),
      reste: sum('reste'),
    }
  }, [rows])

  function handlePrint() {
    printRegistry({
      subtitle: 'Récapitulatif par client — Station',
      orientation: 'landscape',
      filters: periodLabel(startDate, endDate),
      columns: RECAP_COLUMNS,
      rows,
      totals: [{ client: 'TOTAUX', ...totals }],
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadStationRecapExcel(rows, {
        filename: `Recap_Station_${startDate || 'debut'}_au_${endDate || 'fin'}.xlsx`,
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Du</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Au</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          </label>
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

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handlePrint} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted">
            Imprimer
          </button>
          <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
          <button type="button" onClick={() => setSheetOpen(true)} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10">
            Fiche client
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-ink-muted">Aucune opération sur cette période.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                {RECAP_COLUMNS.map((c) => (
                  <th key={c.key} className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.client} className="border-b border-border last:border-0">
                  {RECAP_COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${c.align === 'right' ? 'text-right' : 'font-medium text-ink'} ${
                        c.key === 'reste' && Number(r.reste) > 0 ? 'text-terracotta' : ''
                      }`}
                    >
                      {c.format ? c.format(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-bg-soft font-display">
                <td className="px-1 py-2 sm:px-3">TOTAUX</td>
                {RECAP_COLUMNS.slice(1).map((c) => (
                  <td key={c.key} className="px-1 py-2 text-right sm:px-3">
                    {formatDA(totals[c.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche client — Station"
        nameLabel="Client"
        nameOptions={() => (data ? recapClientNames(data) : [])}
        onGenerate={(_typeId, name, s, e) =>
          buildStationClientSheet(data ?? { carburant: [], lubrifiants: [], gaz: [] }, name, s, e)
        }
        excelSheetName="Fiche client station"
      />
    </div>
  )
}

function recapClientNames(data) {
  const set = new Set()
  for (const list of [data.carburant, data.lubrifiants, data.gaz]) {
    for (const r of list ?? []) if (r.client_name) set.add(r.client_name)
  }
  return [...set].sort()
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
