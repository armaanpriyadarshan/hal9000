/**
 * Circular gauge. `pct` fills 0..1 around the ring (used for CMG momentum).
 * `angle` (optional, degrees 0-360) draws a rotating tick mark (used for
 * SARJ position). Only one of the two should be used per call.
 */
export function RadialGauge({
  size = 48,
  stroke = 1,
  pct,
  angle,
  label,
  value,
}: {
  size?: number;
  stroke?: number;
  pct?: number;
  angle?: number;
  label: string;
  value: string;
}) {
  const r = size / 2 - stroke;
  const circumference = 2 * Math.PI * r;
  const offset =
    pct !== undefined ? circumference * (1 - Math.max(0, Math.min(1, pct))) : 0;

  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} className="flex-shrink-0">
        {/* track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
        {/* fill (pct mode) */}
        {pct !== undefined && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
        )}
        {/* tick (angle mode) */}
        {angle !== undefined && (
          <line
            x1={size / 2}
            y1={stroke}
            x2={size / 2}
            y2={stroke + Math.min(6, r / 2)}
            stroke="#fff"
            strokeWidth={stroke}
            transform={`rotate(${angle} ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
          {label}
        </span>
        <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums">
          {value}
        </span>
      </div>
    </div>
  );
}
