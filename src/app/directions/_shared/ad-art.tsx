import type { Aspect, Variant } from "./sample";

// Sample ad variants drawn entirely in code: scenery from shapes, and the
// words, logo and button composed on top. This is rule 8 in miniature; the
// real build composes generated imagery the same way.

const SIZE: Record<Aspect, [number, number]> = {
  "1:1": [400, 400],
  "4:5": [400, 500],
  "9:16": [360, 640],
  "1.91:1": [764, 400],
};

function sceneShapes(v: Variant, w: number, h: number) {
  const [sky, mid, deep, ink] = v.palette;
  const horizon = h * 0.58;
  switch (v.scene) {
    case "ridge":
      return (
        <>
          <rect width={w} height={h} fill={sky} />
          <circle cx={w * 0.72} cy={horizon * 0.62} r={Math.min(w, h) * 0.09} fill="#FFF4E2" opacity="0.85" />
          <path d={`M0 ${horizon} L${w * 0.3} ${h * 0.36} L${w * 0.52} ${horizon * 0.95} L${w * 0.76} ${h * 0.3} L${w} ${horizon * 0.9} V${h} H0Z`} fill={mid} />
          <path d={`M0 ${h * 0.75} L${w * 0.22} ${h * 0.6} L${w * 0.48} ${h * 0.78} L${w * 0.8} ${h * 0.58} L${w} ${h * 0.7} V${h} H0Z`} fill={deep} />
          <rect y={h * 0.86} width={w} height={h * 0.14} fill={ink} />
        </>
      );
    case "lake":
      return (
        <>
          <rect width={w} height={h} fill={sky} />
          <path d={`M0 ${horizon} Q${w * 0.25} ${h * 0.44} ${w * 0.5} ${horizon * 0.96} T${w} ${horizon * 0.92} V${horizon} Z`} fill={mid} />
          <rect y={horizon} width={w} height={h - horizon} fill={deep} />
          {[0.66, 0.72, 0.8].map((k, i) => (
            <rect key={i} x={w * (0.2 + i * 0.12)} y={h * k} width={w * (0.4 - i * 0.08)} height={2} fill={sky} opacity="0.5" />
          ))}
          <rect y={h * 0.88} width={w} height={h * 0.12} fill={ink} />
        </>
      );
    case "forest":
      return (
        <>
          <rect width={w} height={h} fill={sky} />
          {Array.from({ length: 9 }, (_, i) => {
            const x = (w / 8) * i;
            const top = h * (0.34 + ((i * 37) % 17) / 100);
            return <path key={i} d={`M${x} ${top} L${x + w * 0.09} ${h * 0.72} L${x - w * 0.09} ${h * 0.72}Z`} fill={i % 2 ? mid : deep} />;
          })}
          <path d={`M${w * 0.42} ${h} Q${w * 0.5} ${h * 0.8} ${w * 0.47} ${h * 0.7} L${w * 0.53} ${h * 0.7} Q${w * 0.6} ${h * 0.8} ${w * 0.66} ${h}Z`} fill={sky} opacity="0.6" />
          <rect y={h * 0.72} width={w} height={h * 0.28} fill={ink} opacity="0.92" />
        </>
      );
    case "snow":
      return (
        <>
          <rect width={w} height={h} fill={mid} />
          <path d={`M0 ${h * 0.62} Q${w * 0.3} ${h * 0.48} ${w * 0.6} ${h * 0.6} T${w} ${h * 0.55} V${h} H0Z`} fill={sky} />
          <path d={`M0 ${h * 0.8} Q${w * 0.4} ${h * 0.7} ${w} ${h * 0.82} V${h} H0Z`} fill="#FFFFFF" />
          {Array.from({ length: 14 }, (_, i) => (
            <circle key={i} cx={(w * ((i * 53) % 100)) / 100} cy={(h * ((i * 29) % 55)) / 100} r={2} fill="#FFFFFF" opacity="0.8" />
          ))}
        </>
      );
  }
}

export function AdArt({ v, className, title }: { v: Variant; className?: string; title?: string }) {
  const [w, h] = SIZE[v.aspect];
  const ink = v.scene === "snow" ? "#FFFFFF" : "#FFFDF8";
  const pad = Math.min(w, h) * 0.07;
  const headSize = Math.min(w, h) * (v.aspect === "1.91:1" ? 0.085 : 0.075);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-label={title ?? `${v.name}, ${v.aspect}: ${v.headline}`}>
      {sceneShapes(v, w, h)}
      <text x={pad} y={pad + headSize * 0.4} fontSize={headSize * 0.45} fontWeight="700" letterSpacing="0.08em" fill={ink} fontFamily="system-ui, sans-serif">
        FERNHOLLOW
      </text>
      <foreignObject x={pad} y={h * 0.62} width={w - pad * 2} height={h * 0.28}>
        <p style={{ margin: 0, color: ink, fontFamily: "system-ui, sans-serif", fontWeight: 700, fontSize: headSize, lineHeight: 1.1, letterSpacing: "-0.01em" }}>
          {v.headline}
        </p>
      </foreignObject>
      <rect x={pad} y={h - pad - headSize * 1.3} width={headSize * 0.62 * v.cta.length * 0.75 + headSize} height={headSize * 1.3} rx={headSize * 0.65} fill={ink} />
      <text x={pad + headSize * 0.5} y={h - pad - headSize * 0.42} fontSize={headSize * 0.55} fontWeight="600" fill={v.palette[3]} fontFamily="system-ui, sans-serif">
        {v.cta}
      </text>
    </svg>
  );
}
