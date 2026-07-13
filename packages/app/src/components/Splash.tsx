/**
 * The first two seconds.
 *
 * Booting the WASM kernel, repairing the mesh, searching for a pull axis and cutting
 * the mold takes a moment. Showing nothing at all in that window reads as a broken
 * page, so this says what is happening -- and says the one thing a first-time visitor
 * most needs to know, which is that their file is not going anywhere.
 */
export function Splash() {
  return (
    <div
      className="flex h-dvh flex-col items-center justify-center gap-5 bg-shell-900 text-ink-100"
      data-testid="splash"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-10 w-10 animate-pulse"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      >
        <path d="M11 6h10l-1 3h-8l-1-3z" className="text-pick" stroke="currentColor" />
        <path d="M6 12h20v7H6zM6 21h20v7H6z" />
        <path d="M13 12v7M19 12v7" opacity="0.45" />
      </svg>

      <div className="text-center">
        <div className="text-sm font-semibold tracking-tight">SlipCast</div>
        <div className="mt-1 text-xs text-ink-500">Cutting a mold…</div>
      </div>

      <p className="max-w-xs text-center text-[11px] leading-relaxed text-ink-500">
        Everything runs here in your browser. Nothing is uploaded, and no file you open
        ever leaves this machine.
      </p>
    </div>
  );
}
