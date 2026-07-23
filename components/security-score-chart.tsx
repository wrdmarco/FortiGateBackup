export function SecurityScoreChart({ points }: { points: Array<{ score: number; label: string }> }) {
  if (!points.length) return <p className="text-sm text-muted-foreground">Nog geen voltooide analyses.</p>;
  const width = 760;
  const height = 190;
  const padding = 30;
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : padding + index * (width - 2 * padding) / (points.length - 1),
    y: padding + (100 - point.score) * (height - 2 * padding) / 100
  }));
  return (
    <div className="overflow-x-auto">
      <svg aria-label="Historische FortiGate beveiligingsscore" className="min-w-[620px]" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 25, 50, 75, 100].map((score) => {
          const y = padding + (100 - score) * (height - 2 * padding) / 100;
          return <g key={score}><line stroke="hsl(var(--border))" x1={padding} x2={width-padding} y1={y} y2={y}/><text fill="currentColor" fontSize="10" x="2" y={y+3}>{score}%</text></g>;
        })}
        <path d={`M ${coordinates.map((point) => `${point.x} ${point.y}`).join(" L ")}`} fill="none" stroke="hsl(var(--primary))" strokeWidth="3"/>
        {coordinates.map((point, index) => <circle cx={point.x} cy={point.y} fill="hsl(var(--primary))" key={`${point.label}-${index}`} r="5"><title>{point.label}: {point.score}%</title></circle>)}
      </svg>
    </div>
  );
}
