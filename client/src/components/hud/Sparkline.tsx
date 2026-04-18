/**
 * Rolling sparkline. Caller passes a numeric history array — the component
 * normalises to its own min/max and renders a polyline. Optional marker
 * dot at the last point, and optional horizontal midline grid.
 */
export function Sparkline({
  values,
  width = 120,
  height = 18,
  stroke = 1,
  showMarker = false,
  grid = false,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  stroke?: number;
  showMarker?: boolean;
  grid?: boolean;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });

  const polyline = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height}>
      {grid && (
        <>
          <line
            x1={0}
            y1={height / 2}
            x2={width}
            y2={height / 2}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.5}
            strokeDasharray="2 3"
          />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={height}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={0.5}
          />
          <line
            x1={width - 0.5}
            y1={0}
            x2={width - 0.5}
            y2={height}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={0.5}
          />
        </>
      )}
      <polyline
        fill="none"
        stroke="#fff"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polyline}
      />
      {showMarker && last && (
        <circle cx={last[0]} cy={last[1]} r={1.5} fill="#fff" />
      )}
    </svg>
  );
}
