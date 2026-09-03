import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  computeTauxCasse,
  formatInt,
  formatNum,
  formatPercent,
  toNum,
  todayISO,
} from '../lib/production'

function isoNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function startOfWeekISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function aggregate(entries) {
  const sum = (k) => entries.reduce((s, e) => s + toNum(e[k]), 0)
  const conformes = sum('defourn_conformes')
  const cassees = sum('defourn_cassees')
  const fissurees = sum('defourn_fissurees')
  return {
    count: entries.length,
    pieces: sum('presse_total_pieces'),
    conformes,
    rebuts: sum('presse_rebutes') + sum('sechoir_rebutes') + cassees + fissurees,
    gaz: sum('four_gaz'),
    paquets: sum('emballage_paquets'),
    palettes: sum('emballage_palettes'),
    taux: computeTauxCasse(conformes, cassees, fissurees),
  }
}

export default function ProductionDashboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('production_entries')
        .select('*')
        .gte('entry_date', isoNDaysAgo(45))
        .order('entry_date', { ascending: false })
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setRows(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('production-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_entries' }, load)
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const today = todayISO()
  const weekStart = startOfWeekISO()
  const monthStart = startOfMonthISO()

  const day = useMemo(() => aggregate(rows.filter((e) => e.entry_date === today)), [rows, today])
  const week = useMemo(() => aggregate(rows.filter((e) => e.entry_date >= weekStart)), [rows, weekStart])
  const month = useMemo(() => aggregate(rows.filter((e) => e.entry_date >= monthStart)), [rows, monthStart])

  const last7 = useMemo(() => {
    const days = []
    for (let i = 6; i >= 0; i--) {
      const iso = isoNDaysAgo(i)
      const dayRows = rows.filter((e) => e.entry_date === iso)
      const b8 = dayRows.filter((e) => e.produit === 'B8').reduce((s, e) => s + toNum(e.presse_total_pieces), 0)
      const b12 = dayRows.filter((e) => e.produit === 'B12').reduce((s, e) => s + toNum(e.presse_total_pieces), 0)
      days.push({ iso, label: iso.slice(5), b8, b12, total: b8 + b12 })
    }
    return days
  }, [rows])

  const maxDay = Math.max(1, ...last7.map((d) => d.total))

  if (loading) return <p className="text-ink-muted">Chargement…</p>
  if (error) return <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>

  return (
    <div className="flex flex-col gap-6">
      <Block title="Aujourd'hui" agg={day} />
      <Block title="Cette semaine" agg={week} />
      <Block title="Ce mois" agg={month} />

      <div>
        <h3 className="mb-3 font-display text-lg text-ink">Production des 7 derniers jours (pièces pressées)</h3>
        <div className="flex gap-2 rounded-lg border border-border bg-bg-soft p-4">
          {last7.map((d) => (
            <div key={d.iso} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-ink-muted">{d.total ? formatInt(d.total) : ''}</span>
              <div className="flex w-full flex-col-reverse overflow-hidden rounded" style={{ height: 150 }}>
                <div className="w-full bg-bg" style={{ flex: `${Math.max(0, maxDay - d.total)} 0 0` }} />
                <div className="w-full bg-ocre" style={{ flex: `${d.b12} 0 0` }} title={`B12 : ${formatInt(d.b12)}`} />
                <div className="w-full bg-terracotta" style={{ flex: `${d.b8} 0 0` }} title={`B8 : ${formatInt(d.b8)}`} />
              </div>
              <span className="text-[10px] text-ink-muted">{d.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-terracotta" /> B8</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-ocre" /> B12</span>
        </div>
      </div>
    </div>
  )
}

function Block({ title, agg }) {
  return (
    <div>
      <h3 className="mb-3 font-display text-lg text-ink">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Pièces produites" value={formatInt(agg.pieces)} />
        <Card label="Pièces conformes" value={formatInt(agg.conformes)} />
        <Card label="Rebuts" value={formatInt(agg.rebuts)} danger={agg.rebuts > 0} />
        <Card label="Taux de casse" value={formatPercent(agg.taux)} danger={agg.taux >= 5} />
        <Card label="Paquets" value={formatInt(agg.paquets)} />
        <Card label="Palettes" value={formatInt(agg.palettes)} />
        <Card label="Gaz (m³)" value={formatNum(agg.gaz)} />
        <Card label="Saisies" value={formatInt(agg.count)} />
      </div>
    </div>
  )
}

function Card({ label, value, danger }) {
  return (
    <div className={`rounded-lg border p-4 ${danger ? 'border-terracotta/60 bg-terracotta/10' : 'border-border bg-bg-soft'}`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`font-display text-2xl ${danger ? 'text-terracotta' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
