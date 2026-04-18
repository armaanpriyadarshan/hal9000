/**
 * Minimal multi-series line chart. Each series normalises against its
 * OWN min/max — lines share the chart's vertical space, not a shared
 * numeric axis. That means you can overlay series with totally different
 * magnitudes (ppCO₂ in the thousands, ppO₂ around 3) and see each line's
 * shape. Absolute magnitudes are lost; trend shapes are preserved.
 */

export type ChartSeries = {
  label: string;
  values: readonly number[];
  dashed?: boolean;
};

function seriesPoints(
  values: readonly number[],
  width: number,
  height: number,
): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y =
        range === 0
          ? height / 2
          : height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

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
  const anyValues = series.some((s) => s.values.length >= 2);
  if (!anyValues) {
    return (
      <svg width={width} height={height}>
        <rect
          x={0.25}
          y={0.25}
          width={width - 0.5}
          height={height - 0.5}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={0.5}
        />
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

  return (
    <svg width={width} height={height}>
      {/* frame */}
      <rect
        x={0.25}
        y={0.25}
        width={width - 0.5}
        height={height - 0.5}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={0.5}
      />
      {/* two subtle horizontal grid lines */}
      <line
        x1={0}
        y1={height / 3}
        x2={width}
        y2={height / 3}
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={0.5}
        strokeDasharray="2 3"
      />
      <line
        x1={0}
        y1={(height * 2) / 3}
        x2={width}
        y2={(height * 2) / 3}
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={0.5}
        strokeDasharray="2 3"
      />
      {series.map((s, index) => {
        if (s.values.length < 2) return null;
        return (
          <polyline
            key={s.label}
            fill="none"
            stroke="#fff"
            strokeOpacity={index === 0 ? 1 : 0.35}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? "3 2" : undefined}
            points={seriesPoints(s.values, width, height)}
          />
        );
      })}
    </svg>
  );
}
