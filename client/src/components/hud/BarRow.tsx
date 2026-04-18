export function BarRow({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div>
      <div className="flex items-baseline gap-3 leading-tight">
        <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
          {label}
        </span>
        <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
          {value}
        </span>
      </div>
      <div className="h-[2px] w-full bg-white/10 mt-1">
        <div
          className="h-full bg-white"
          style={{ width: `${(clamped * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}
