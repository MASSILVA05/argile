export default function AdminCodeModal({ prompt, codeValue, onCodeChange, error, busy, onConfirm, onCancel }) {
  if (!prompt) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg text-ink">Code administrateur requis</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Cette entrée a plus de 72h. Saisis le code administrateur pour{' '}
          {prompt.action === 'edit' ? 'la modifier' : 'la supprimer'}.
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={codeValue}
          onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
          className="mb-2 min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          placeholder="Code administrateur"
        />
        {error && <p className="mb-2 text-sm text-terracotta">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-2 text-sm text-ink-muted"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
          >
            {busy ? 'Vérification…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}
