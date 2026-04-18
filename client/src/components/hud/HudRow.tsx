export function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 leading-tight">
      <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
        {label}
      </span>
      <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
        {value}
      </span>
    </div>
  );
}
