export default function Watermark({ username }) {
  const label = `CONFIDENTIEL — ${username}`

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] overflow-hidden select-none">
      <div className="absolute top-1/2 left-1/2 flex w-[200vw] -translate-x-1/2 -translate-y-1/2 -rotate-[30deg] flex-col gap-12 opacity-10">
        {Array.from({ length: 14 }).map((_, row) => (
          <div key={row} className="flex justify-around gap-12">
            {Array.from({ length: 6 }).map((_, col) => (
              <span key={col} className="font-display text-lg whitespace-nowrap text-ink">
                {label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
