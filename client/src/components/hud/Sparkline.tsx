/**
 * Rolling sparkline. Caller passes a numeric history array — the component
 * normalises to its own min/max and renders a polyline.
 */
export function Sparkline({
  values,
  width = 120,
  height = 18,
  stroke = 1,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  stroke?: number;
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

  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height}>
      <polyline
        fill="none"
        stroke="#fff"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
