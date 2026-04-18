/**
 * Minimal multi-series line chart with optional grid and horizontal
 * reference band. All series normalise to the combined min/max of their
 * values. Secondary series render at reduced opacity to differentiate
 * from the primary.
 */

export type ChartSeries = {
  label: string;
  values: readonly number[];
  dashed?: boolean;
};

export function LineChart({
  series,
  width = 240,
  height = 48,
  stroke = 1,
}: {
  series: readonly ChartSeries[];
  width?: number;
  height?: number;
  stroke?: number;
}) {
  const allValues = series.flatMap((s) => s.values);
  if (allValues.length < 2) {
    return (
      <svg width={width} height={height}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const renderSeries = (s: ChartSeries, index: number) => {
    if (s.values.length < 2) return null;
    const step = width / (s.values.length - 1);
    const points = s.values
      .map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / range) * (height - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      <polyline
        key={s.label}
        fill="none"
        stroke="#fff"
        strokeOpacity={index === 0 ? 1 : 0.4}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={s.dashed ? "3 2" : undefined}
        points={points}
      />
    );
  };

  return (
    <svg width={width} height={height}>
      {/* frame */}
      <line
        x1={0.5}
        y1={0}
        x2={0.5}
        y2={height}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={0.5}
      />
      <line
        x1={width - 0.5}
        y1={0}
        x2={width - 0.5}
        y2={height}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={0.5}
      />
      <line
        x1={0}
        y1={height - 0.5}
        x2={width}
        y2={height - 0.5}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={0.5}
      />
      {/* two horizontal grid lines at 1/3 and 2/3 */}
      <line
        x1={0}
        y1={height / 3}
        x2={width}
        y2={height / 3}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={0.5}
        strokeDasharray="2 3"
      />
      <line
        x1={0}
        y1={(height * 2) / 3}
        x2={width}
        y2={(height * 2) / 3}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={0.5}
        strokeDasharray="2 3"
      />
      {series.map(renderSeries)}
    </svg>
  );
}
