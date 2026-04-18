/**
 * Miniature vertical thermometer. Stem + bulb, filled proportional to
 * where `valueC` sits between `minC` and `maxC`. Typical ISS cabin band
 * is 18-27 °C — anything outside gets clamped to the ends.
 */
export function Thermometer({
  valueC,
  minC = 18,
  maxC = 27,
  width = 16,
  height = 56,
}: {
  valueC: number | null;
  minC?: number;
  maxC?: number;
  width?: number;
  height?: number;
}) {
  const bulbR = width / 2;
  const stemX = width / 2;
  const stemW = 4;
  const stemHeight = height - bulbR * 2;
  const stemTop = 1;
  const stemBottom = stemTop + stemHeight;
  const bulbCy = stemBottom + bulbR - 1;

  const clampedInput =
    valueC === null
      ? null
      : Math.max(minC, Math.min(maxC, valueC));
  const fillPct =
    clampedInput === null ? 0 : (clampedInput - minC) / (maxC - minC);
  const fillTop = stemBottom - stemHeight * fillPct;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      {/* stem outline */}
      <rect
        x={stemX - stemW / 2}
        y={stemTop}
        width={stemW}
        height={stemHeight}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={0.5}
      />
      {/* bulb outline */}
      <circle
        cx={stemX}
        cy={bulbCy}
        r={bulbR - 0.5}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={0.5}
      />
      {/* mid tick at 50% of range */}
      <line
        x1={stemX - stemW / 2 - 3}
        y1={stemTop + stemHeight / 2}
        x2={stemX - stemW / 2 - 1}
        y2={stemTop + stemHeight / 2}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={0.5}
      />
      {/* fill inside stem */}
      {clampedInput !== null && (
        <rect
          x={stemX - (stemW - 2) / 2}
          y={fillTop}
          width={stemW - 2}
          height={stemBottom - fillTop + 1}
          fill="#fff"
        />
      )}
      {/* filled bulb */}
      <circle
        cx={stemX}
        cy={bulbCy}
        r={bulbR - 2}
        fill={clampedInput !== null ? "#fff" : "rgba(255,255,255,0.15)"}
      />
    </svg>
  );
}
