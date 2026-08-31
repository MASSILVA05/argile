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

const TABS = [
  { id: 'form', label: 'Saisie', Icon: TruckIcon },
  { id: 'registry', label: 'Registre', Icon: ListIcon },
  { id: 'maintenance', label: 'Maintenance', Icon: WrenchIcon },
  { id: 'fuel', label: 'Carburant', Icon: FuelIcon },
  { id: 'sand', label: 'Sable', Icon: SandIcon },
  { id: 'invoices', label: 'Factures', Icon: InvoiceIcon },
  { id: 'tva', label: 'TVA', Icon: PercentIcon },
  { id: 'tva-payer', label: 'TVA à payer', Icon: CalculatorIcon },
  { id: 'caisse', label: 'Caisse', Icon: WalletIcon },
]

export default function BottomNav({ active, onChange, allowedTabs }) {
  const visibleTabs = allowedTabs ? TABS.filter((t) => allowedTabs.includes(t.id)) : TABS
  const compact = visibleTabs.length > 5

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-card pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-4xl overflow-x-auto">
        {visibleTabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors ${
              compact ? 'min-w-16 shrink-0' : ''
            } ${active === id ? 'text-terracotta' : 'text-ink-muted hover:text-ink'}`}
          >
            <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
            <span className={compact ? 'text-[10px]' : ''}>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
