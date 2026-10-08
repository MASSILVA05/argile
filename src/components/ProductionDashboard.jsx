import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  EQUIPES,
  computeTauxCasse,
  computeTauxPremierChoix,
  entryPiecesBonnes,
  formatInt,
  formatNum,
  formatPercent,
  parseArrets,
  ratioPercent,
  toNum,
} from '../lib/production'

// Dates locales (pas toISOString : en UTC+1, minuit local = veille en UTC).
function localISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isoNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localISO(d)
}

function startOfWeekISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return localISO(d)
}

function startOfMonthISO() {
  const d = new Date()
  return localISO(new Date(d.getFullYear(), d.getMonth(), 1))
}

function startOfQuarterISO() {
  const d = new Date()
  return localISO(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1))
}

const PERIODES = [
  { id: 'semaine', label: 'Semaine', start: startOfWeekISO },
  { id: 'mois', label: 'Mois', start: startOfMonthISO },
  { id: 'trimestre', label: 'Trimestre', start: startOfQuarterISO },
]

const TEAM_COLORS = { A: 'var(--color-team-a)', B: 'var(--color-team-b)', C: 'var(--color-team-c)' }

const GAZ_OBJECTIF_KEY = 'production.gazObjectif1000'
const DEFAULT_GAZ_OBJECTIF = 25

function readGazObjectif() {
  try {
    const v = Number(localStorage.getItem(GAZ_OBJECTIF_KEY))
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_GAZ_OBJECTIF
  } catch {
    return DEFAULT_GAZ_OBJECTIF
  }
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

// Indicateurs qualité / rendement d'un ensemble de saisies.
function analyse(entries) {
  const sum = (k) => entries.reduce((s, e) => s + toNum(e[k]), 0)
  const bonnes = entries.reduce((s, e) => s + entryPiecesBonnes(e), 0)
  // Conso gaz/1000 : uniquement sur les lignes qui ont à la fois du gaz et
  // des pièces bonnes (sinon une ligne sans défournement fausse le ratio).
  const gazRows = entries.filter((e) => toNum(e.four_gaz) > 0 && entryPiecesBonnes(e) > 0)
  const gaz = gazRows.reduce((s, e) => s + toNum(e.four_gaz), 0)
  const gazPieces = gazRows.reduce((s, e) => s + entryPiecesBonnes(e), 0)
  return {
    pieces: sum('presse_total_pieces'),
    bonnes,
    tauxPremier: computeTauxPremierChoix(sum('defourn_premier_choix'), sum('defourn_deuxieme_choix'), sum('defourn_rebut')),
    hasClassement: sum('defourn_premier_choix') + sum('defourn_deuxieme_choix') + sum('defourn_rebut') > 0,
    tauxCasse: computeTauxCasse(sum('defourn_conformes'), sum('defourn_cassees'), sum('defourn_fissurees')),
    gaz1000: gazPieces > 0 ? (gaz / gazPieces) * 1000 : null,
    etapes: [
      { label: 'Presse → Séchoir', value: ratioPercent(sum('sechoir_entres'), sum('presse_chariots')) },
      { label: 'Séchoir → Four', value: ratioPercent(sum('four_enfournes'), sum('sechoir_sortis')) },
      { label: 'Four → Défournement', value: ratioPercent(sum('defourn_chariots'), sum('four_defournes')) },
    ],
    rendementGlobal: ratioPercent(bonnes, sum('presse_total_pieces')),
  }
}

function arretsStats(entries) {
  let minutes = 0
  const causes = new Map()
  for (const e of entries) {
    for (const a of parseArrets(e.presse_arrets)) {
      minutes += a.minutes
      const c = causes.get(a.cause) ?? { cause: a.cause, minutes: 0, count: 0 }
      c.minutes += a.minutes
      c.count += 1
      causes.set(a.cause, c)
    }
  }
  const top = [...causes.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count).slice(0, 3)
  return { heures: minutes / 60, top }
}

function formatHeures(h) {
  const total = Math.round(h * 60)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`
}

export default function ProductionDashboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [periode, setPeriode] = useState('mois')
  const [gazObjectif, setGazObjectif] = useState(readGazObjectif)

  useEffect(() => {
    let active = true
    // Couvre le trimestre en cours + 45 jours glissants (graphiques 7/30 j).
    const from = [startOfQuarterISO(), isoNDaysAgo(45)].sort()[0]
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('production_entries')
        .select('*')
        .gte('entry_date', from)
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

  function changeGazObjectif(value) {
    setGazObjectif(value)
    try {
      localStorage.setItem(GAZ_OBJECTIF_KEY, String(value))
    } catch {
      // stockage indisponible : l'objectif reste en mémoire pour la session
    }
  }

  const today = localISO(new Date())
  const weekStart = startOfWeekISO()
  const monthStart = startOfMonthISO()
  const periodeStart = PERIODES.find((p) => p.id === periode).start()

  const day = useMemo(() => aggregate(rows.filter((e) => e.entry_date === today)), [rows, today])
  const week = useMemo(() => aggregate(rows.filter((e) => e.entry_date >= weekStart)), [rows, weekStart])
  const month = useMemo(() => aggregate(rows.filter((e) => e.entry_date >= monthStart)), [rows, monthStart])

  const periodeRows = useMemo(() => rows.filter((e) => e.entry_date >= periodeStart), [rows, periodeStart])
  const periodeAnalyse = useMemo(() => analyse(periodeRows), [periodeRows])
  const equipes = useMemo(
    () => EQUIPES.map((eq) => ({ equipe: eq, ...analyse(periodeRows.filter((e) => e.equipe === eq)) })),
    [periodeRows]
  )

  const monthRows = useMemo(() => rows.filter((e) => e.entry_date >= monthStart), [rows, monthStart])
  const monthResume = useMemo(() => {
    const piecesOf = (p) => monthRows.filter((e) => e.produit === p).reduce((s, e) => s + toNum(e.presse_total_pieces), 0)
    return { b8: piecesOf('B8'), b12: piecesOf('B12'), ...analyse(monthRows), arrets: arretsStats(monthRows) }
  }, [monthRows])

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

  const gaz30 = useMemo(() => {
    const days = []
    for (let i = 29; i >= 0; i--) {
      const iso = isoNDaysAgo(i)
      days.push({ iso, label: iso.slice(5), value: analyse(rows.filter((e) => e.entry_date === iso)).gaz1000 })
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

      <MonthResume resume={monthResume} />

      <GazChart days={gaz30} objectif={gazObjectif} onObjectifChange={changeGazObjectif} />

      {/* Analyses sur période sélectionnable */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg text-ink">Analyse par période</h3>
          <div className="flex gap-2" role="group" aria-label="Période">
            {PERIODES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriode(p.id)}
                aria-pressed={periode === p.id}
                className={`min-h-10 rounded-full border px-4 py-1.5 text-sm font-display transition-colors ${
                  periode === p.id
                    ? 'border-terracotta bg-terracotta text-ink'
                    : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="-mt-2 text-xs text-ink-muted">Depuis le {periodeStart} · {formatInt(periodeRows.length)} saisies</p>

        <RendementEtapes etapes={periodeAnalyse.etapes} />
        <EquipesComparaison equipes={equipes} />
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

function Card({ label, value, danger, hint }) {
  return (
    <div className={`rounded-lg border p-4 ${danger ? 'border-terracotta/60 bg-terracotta/10' : 'border-border bg-bg-soft'}`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`font-display text-2xl ${danger ? 'text-terracotta' : 'text-ink'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

function MonthResume({ resume }) {
  const total = resume.b8 + resume.b12
  const pctB8 = total > 0 ? (resume.b8 / total) * 100 : 0
  return (
    <div>
      <h3 className="mb-3 font-display text-lg text-ink">Résumé du mois</h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg-soft p-4">
          <p className="text-sm text-ink-muted">Production B8 / B12 (pièces pressées)</p>
          <div className="mt-2 flex justify-between font-display text-lg text-ink">
            <span>B8 : {formatInt(resume.b8)}</span>
            <span>B12 : {formatInt(resume.b12)}</span>
          </div>
          <div className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded" aria-hidden="true">
            {total > 0 ? (
              <>
                <div className="rounded-l bg-terracotta" style={{ width: `${pctB8}%` }} title={`B8 : ${formatPercent(pctB8)}`} />
                <div className="flex-1 rounded-r bg-ocre" title={`B12 : ${formatPercent(100 - pctB8)}`} />
              </>
            ) : (
              <div className="flex-1 bg-bg" />
            )}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {total > 0 ? `B8 ${formatPercent(pctB8)} · B12 ${formatPercent(100 - pctB8)}` : 'Aucune production ce mois'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Card
            label="Rendement global"
            value={resume.rendementGlobal == null ? '—' : formatPercent(resume.rendementGlobal)}
            hint="pièces bonnes / pièces pressées"
          />
          <Card label="Heures d'arrêt" value={formatHeures(resume.arrets.heures)} hint="presse, cumul du mois" />
        </div>
        <div className="rounded-lg border border-border bg-bg-soft p-4">
          <p className="text-sm text-ink-muted">Top 3 des causes d'arrêt</p>
          {resume.arrets.top.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Aucun arrêt saisi ce mois.</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-1.5">
              {resume.arrets.top.map((c, i) => (
                <li key={c.cause} className="flex justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {i + 1}. <span className="capitalize">{c.cause}</span>
                  </span>
                  <span className="whitespace-nowrap text-ink-muted">
                    {formatHeures(c.minutes / 60)} · {c.count}×
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

// Statut du taux de passage : vert > 90 %, orange 70–90 %, rouge < 70 %.
function etapeStatus(value) {
  if (value == null) return null
  if (value > 90) return { color: 'var(--color-success)', label: 'Bon', icon: '✓' }
  if (value >= 70) return { color: 'var(--color-warning)', label: 'À surveiller', icon: '!' }
  return { color: 'var(--color-error)', label: 'Critique', icon: '✗' }
}

function RendementEtapes({ etapes }) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft p-4">
      <p className="mb-3 font-display text-ink">Taux de passage par étape (chariots)</p>
      <div className="flex flex-col gap-3">
        {etapes.map((et) => {
          const st = etapeStatus(et.value)
          return (
            <div key={et.label} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[11rem_1fr_auto]">
              <span className="text-sm text-ink-muted">{et.label}</span>
              <div className="h-4 overflow-hidden rounded bg-bg" title={et.value == null ? 'Pas de données' : formatPercent(et.value)}>
                {st && (
                  <div
                    className="h-full rounded-r"
                    style={{ width: `${Math.min(100, et.value)}%`, background: st.color }}
                  />
                )}
              </div>
              <span className="w-28 text-right text-sm text-ink">
                {st ? (
                  <>
                    {formatPercent(et.value)} <span className="text-xs text-ink-muted">{st.icon} {st.label}</span>
                  </>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Seuils : &gt; 90 % bon · 70–90 % à surveiller · &lt; 70 % critique. Un taux &gt; 100 % signale un décalage de saisie entre postes.
      </p>
    </div>
  )
}

function GazChart({ days, objectif, onObjectifChange }) {
  const [hover, setHover] = useState(null)
  const W = 640
  const H = 200
  const pad = { l: 40, r: 12, t: 12, b: 24 }
  const values = days.map((d) => d.value).filter((v) => v != null)
  const max = Math.max(objectif * 1.2, ...values, 1)
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (days.length - 1)
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b)

  // Segments continus (un jour sans donnée coupe la ligne).
  const segments = []
  let cur = []
  days.forEach((d, i) => {
    if (d.value == null) {
      if (cur.length) segments.push(cur)
      cur = []
    } else cur.push(`${x(i)},${y(d.value)}`)
  })
  if (cur.length) segments.push(cur)

  const ticks = [0, max / 2, max]
  const h = hover != null ? days[hover] : null

  return (
    <div className="rounded-lg border border-border bg-bg-soft p-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-ink">Consommation gaz pour 1 000 briques (m³) — 30 derniers jours</p>
          <p className="text-xs text-ink-muted">Gaz du jour / pièces bonnes × 1 000 · pointillés = objectif</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Objectif
          <input
            type="number"
            min="0"
            step="0.1"
            value={objectif}
            onChange={(e) => onObjectifChange(toNum(e.target.value))}
            className="min-h-9 w-20 rounded-lg border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta"
          />
          m³
        </label>
      </div>
      <div className="relative">
        <p className="h-5 text-xs text-ink">
          {h ? `${h.iso} : ${h.value == null ? 'pas de donnée' : `${formatNum(h.value)} m³ / 1 000`}` : ''}
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Consommation de gaz pour 1000 briques, 30 derniers jours" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--color-ink-muted)">
                {formatNum(Math.round(t))}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % 5 === 0 || i === days.length - 1 ? (
              <text key={d.iso} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-ink-muted)">
                {d.label}
              </text>
            ) : null
          )}
          <line
            x1={pad.l} x2={W - pad.r} y1={y(objectif)} y2={y(objectif)}
            stroke="var(--color-ink-muted)" strokeWidth="1.5" strokeDasharray="6 4"
          />
          <text x={W - pad.r} y={y(objectif) - 4} textAnchor="end" fontSize="10" fill="var(--color-ink-muted)">
            objectif {formatNum(objectif)}
          </text>
          {h && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-ink-muted)" strokeWidth="1" />}
          {segments.map((pts, i) => (
            <polyline key={i} points={pts.join(' ')} fill="none" stroke="var(--color-terracotta)" strokeWidth="2" strokeLinejoin="round" />
          ))}
          {days.map((d, i) =>
            d.value == null ? null : (
              <circle
                key={d.iso}
                cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3.5}
                fill={d.value > objectif ? 'var(--color-error)' : 'var(--color-terracotta)'}
                stroke="var(--color-bg-soft)" strokeWidth="2"
              />
            )
          )}
          {days.map((d, i) => (
            <rect
              key={`hit-${d.iso}`}
              x={x(i) - (W - pad.l - pad.r) / (days.length - 1) / 2}
              y={pad.t}
              width={(W - pad.l - pad.r) / (days.length - 1)}
              height={H - pad.t - pad.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>
      </div>
      {values.length === 0 && <p className="text-sm text-ink-muted">Aucune donnée gaz + défournement sur 30 jours.</p>}
    </div>
  )
}

const TEAM_METRICS = [
  { key: 'pieces', label: 'Total pièces', format: formatInt },
  { key: 'tauxPremier', label: 'Taux 1er choix', format: formatPercent, needs: 'hasClassement' },
  { key: 'tauxCasse', label: 'Taux casse', format: formatPercent },
  { key: 'gaz1000', label: 'Conso gaz / 1000 (m³)', format: formatNum },
]

function metricValue(team, m) {
  if (m.needs && !team[m.needs]) return null
  return team[m.key]
}

function EquipesComparaison({ equipes }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-soft p-4">
      <p className="font-display text-ink">Comparaison des équipes</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-ink-muted">
              <th className="px-2 py-2 font-display font-medium">Équipe</th>
              {TEAM_METRICS.map((m) => (
                <th key={m.key} className="px-2 py-2 text-right font-display font-medium">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {equipes.map((t) => (
              <tr key={t.equipe} className="border-b border-border last:border-0">
                <td className="px-2 py-2 text-ink">
                  <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: TEAM_COLORS[t.equipe] }} />
                  {t.equipe}
                </td>
                {TEAM_METRICS.map((m) => {
                  const v = metricValue(t, m)
                  return (
                    <td key={m.key} className="px-2 py-2 text-right text-ink">{v == null ? '—' : m.format(v)}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Petits multiples : une échelle par indicateur (jamais deux unités sur un axe). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TEAM_METRICS.map((m) => {
          const max = Math.max(...equipes.map((t) => metricValue(t, m) ?? 0), 0)
          return (
            <div key={m.key} className="rounded-lg border border-border bg-bg p-3">
              <p className="mb-2 text-xs text-ink-muted">{m.label}</p>
              <div className="flex flex-col gap-1.5">
                {equipes.map((t) => {
                  const v = metricValue(t, m)
                  return (
                    <div key={t.equipe} className="grid grid-cols-[1rem_1fr_auto] items-center gap-2" title={`Équipe ${t.equipe} : ${v == null ? '—' : m.format(v)}`}>
                      <span className="text-xs text-ink">{t.equipe}</span>
                      <div className="h-3">
                        {v != null && max > 0 && (
                          <div
                            className="h-full rounded-r"
                            style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: TEAM_COLORS[t.equipe] }}
                          />
                        )}
                      </div>
                      <span className="text-xs text-ink">{v == null ? '—' : m.format(v)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-4 text-xs text-ink-muted">
        {EQUIPES.map((eq) => (
          <span key={eq} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TEAM_COLORS[eq] }} /> Équipe {eq}
          </span>
        ))}
      </div>
    </div>
  )
}
