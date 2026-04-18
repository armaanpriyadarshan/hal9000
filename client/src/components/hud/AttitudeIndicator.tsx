/**
 * Miniature attitude indicator. A circular window showing:
 * - horizon line rotated by `roll` (degrees)
 * - horizon offset vertically by `pitch` (degrees, ~1° = 1 px at default size)
 * - small fixed reticle in the centre
 * - `yaw` rendered as a numeric bearing below
 *
 * Stylised rather than accurate — good enough to convey "the station has
 * non-zero attitude error" at a glance.
 */
export function AttitudeIndicator({
  roll = 0,
  pitch = 0,
  yaw = 0,
  size = 56,
}: {
  roll?: number;
  pitch?: number;
  yaw?: number;
  size?: number;
}) {
  const r = size / 2 - 1;
  const clampedPitch = Math.max(-15, Math.min(15, pitch));
  const pitchOffset = clampedPitch * (r / 15);

  return (
    <div className="flex flex-col items-center leading-tight">
      <svg width={size} height={size} className="flex-shrink-0">
        <defs>
          <clipPath id="adi-clip">
            <circle cx={size / 2} cy={size / 2} r={r} />
          </clipPath>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
        />
        <g clipPath="url(#adi-clip)">
          <g
            transform={`rotate(${roll} ${size / 2} ${size / 2}) translate(0 ${pitchOffset})`}
          >
            <line
              x1={-size}
              y1={size / 2}
              x2={size * 2}
              y2={size / 2}
              stroke="#fff"
              strokeWidth={1}
            />
            <line
              x1={size / 2}
              y1={size / 2 - 4}
              x2={size / 2}
              y2={size / 2 + 4}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={1}
            />
          </g>
        </g>
        {/* fixed reticle */}
        <line
          x1={size / 2 - 6}
          y1={size / 2}
          x2={size / 2 + 6}
          y2={size / 2}
          stroke="#fff"
          strokeWidth={1}
        />
        <line
          x1={size / 2}
          y1={size / 2 - 2}
          x2={size / 2}
          y2={size / 2 + 2}
          stroke="#fff"
          strokeWidth={1}
        />
      </svg>
      <span className="font-mono uppercase tracking-[0.12em] text-[9px] text-white-dim mt-1 tabular-nums">
        YAW {yaw.toFixed(1)}°
      </span>
    </div>
  );
}
