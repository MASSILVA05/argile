import { useRef } from 'react'

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function TruckIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M2 8h11v9H2z" />
      <path d="M13 11h4l4 3v3h-8z" />
      <circle cx="6.5" cy="18.5" r="1.6" />
      <circle cx="17.5" cy="18.5" r="1.6" />
    </svg>
  )
}

function ListIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </svg>
  )
}

function WrenchIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M14.7 6.3a4 4 0 0 0-5.6 4.6L3 17l3 3 6.1-6.1a4 4 0 0 0 4.6-5.6l-2.5 2.5-2-2z" />
    </svg>
  )
}

function FactoryIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M3 21h18" />
      <path d="M4 21V10l6 4V10l6 4V6l4 2v13" />
      <path d="M7 21v-4" />
      <path d="M12 21v-4" />
      <path d="M17 21v-4" />
    </svg>
  )
}

function PackageIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5" />
      <path d="M12 12v9" />
      <path d="M8 5.2l8 4.6" />
    </svg>
  )
}

function FuelIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M4 21V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14" />
      <path d="M4 21h10" />
      <path d="M14 10h2l3 3v5a1.5 1.5 0 0 1-3 0v-1a1 1 0 0 0-1-1h-1" />
      <path d="M7 6v3h4V6" />
    </svg>
  )
}

function SandIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M3 20h18" />
      <path d="M5 20l6-13 6 13" />
      <path d="M9 20l2.5-9L14 20" />
    </svg>
  )
}

function InvoiceIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M6 2h9l3 3v17H6z" />
      <path d="M15 2v3h3" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
      <path d="M9 19h3" />
    </svg>
  )
}

function PercentIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

function WalletIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h13v4" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
      <path d="M20 9v6h-4a3 3 0 0 1 0-6z" />
      <path d="M16 12h.01" />
    </svg>
  )
}

function CalculatorIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8" />
      <path d="M8 11h.01" />
      <path d="M12 11h.01" />
      <path d="M16 11h.01" />
      <path d="M8 15h.01" />
      <path d="M12 15h.01" />
      <path d="M16 15h.01" />
      <path d="M8 19h.01" />
      <path d="M12 19h.01" />
      <path d="M16 19h.01" />
    </svg>
  )
}

function StoreIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M3 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
}

function BuildingIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M14 9h4a2 2 0 0 1 2 2v10" />
      <path d="M3 21h18" />
      <path d="M8 7h2M8 11h2M8 15h2" />
    </svg>
  )
}

function PumpIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <rect x="3" y="3" width="10" height="18" rx="1" />
      <path d="M3 10h10" />
      <path d="M13 7h3l3 3v7a1.5 1.5 0 0 1-3 0v-3a1 1 0 0 0-1-1h-2" />
      <path d="M3 21h10" />
    </svg>
  )
}

function ChequeIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="8" cy="12" r="2.4" />
      <path d="M14 10h4M14 14h4" />
      <path d="M2 9h20" />
    </svg>
  )
}

// Menu groupé par catégorie. Les catégories/onglets sans accès (allowedTabs)
// sont masqués -- voir ROLE_TABS dans src/lib/auth.js.
const CATEGORIES = [
  {
    label: 'Chargement',
    items: [
      { id: 'form', label: 'Saisie', Icon: TruckIcon },
      { id: 'registry', label: 'Registre', Icon: ListIcon },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { id: 'maintenance', label: 'Maintenance', Icon: WrenchIcon },
      { id: 'production', label: 'Production', Icon: FactoryIcon },
      { id: 'fuel', label: 'Carburant', Icon: FuelIcon },
      { id: 'sand', label: 'Sable', Icon: SandIcon },
    ],
  },
  {
    label: 'Finances',
    items: [
      { id: 'invoices', label: 'Factures', Icon: InvoiceIcon },
      { id: 'tva', label: 'TVA Récupération', Icon: PercentIcon },
      { id: 'tva-payer', label: 'TVA à Payer', Icon: CalculatorIcon },
      { id: 'caisse', label: 'Caisse', Icon: WalletIcon },
      { id: 'cheques', label: 'Chèques', Icon: ChequeIcon },
    ],
  },
  {
    label: 'Industrie',
    items: [
      { id: 'prodnet', label: 'Prodnet', Icon: PackageIcon },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { id: 'magasin', label: 'Magasin Bejaia', Icon: StoreIcon },
      { id: 'station', label: 'Station', Icon: PumpIcon },
    ],
  },
  {
    label: 'Autre',
    items: [
      { id: 'residence', label: 'Résidence', Icon: BuildingIcon },
    ],
  },
]

// Distance de swipe (px, vers la gauche) à partir de laquelle le panneau se ferme.
const SWIPE_CLOSE_THRESHOLD = 60

export default function SideNav({ open, onClose, active, onChange, allowedTabs }) {
  const touchStartX = useRef(null)

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }

  function handleTouchEnd(e) {
    if (touchStartX.current == null) return
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current
    if (touchStartX.current - endX > SWIPE_CLOSE_THRESHOLD) onClose()
    touchStartX.current = null
  }

  const visibleCategories = CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => allowedTabs.includes(item.id)),
  })).filter((cat) => cat.items.length > 0)

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-border bg-bg-card shadow-2xl transition-transform duration-300 ease-in-out sm:w-[300px] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <span className="font-display text-lg text-ink">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-ink-muted hover:text-ink"
            aria-label="Fermer le menu"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          {visibleCategories.map((cat) => (
            <div key={cat.label} className="flex flex-col gap-1">
              <p className="px-3 pb-1 font-display text-xs tracking-widest text-ink-muted uppercase">{cat.label}</p>
              {cat.items.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onChange(id)
                    onClose()
                  }}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    active === id
                      ? 'bg-terracotta text-ink'
                      : 'text-ink-muted hover:bg-border/40 hover:text-ink'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
