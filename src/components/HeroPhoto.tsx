/**
 * The photo sent in the hero chat: a sunset over Seoul with Namsan tower. Drawn in SVG (no stock
 * photos), plus an "x-ray" version of the same scene that shows the hidden sats.
 */

const SKYLINE: [number, number, number][] = [
  // x, width, height
  [0, 22, 46], [20, 16, 62], [34, 26, 38], [58, 14, 70], [70, 24, 52], [92, 18, 40], [150, 20, 58],
  [168, 28, 44], [194, 14, 74], [206, 22, 50], [226, 18, 64], [242, 26, 42], [266, 16, 56], [280, 22, 48],
]
const GROUND = 205

function Skyline({ fill, stroke }: { fill: string; stroke?: string }) {
  return (
    <g fill={fill} stroke={stroke} strokeWidth={stroke ? 1 : 0}>
      {SKYLINE.map(([x, w, h]) => (
        <rect key={x} x={x} y={GROUND - h} width={w} height={h} />
      ))}
    </g>
  )
}

function Tower({ fill, stroke }: { fill: string; stroke?: string }) {
  return (
    <g fill={fill} stroke={stroke} strokeWidth={stroke ? 1.2 : 0}>
      <rect x="124" y="70" width="2" height="18" />
      <rect x="121" y="86" width="8" height="10" rx="2" />
      <rect x="122.5" y="96" width="5" height="40" />
      <path d="M118 136 h14 l-2 6 h-10 z" />
    </g>
  )
}

export function HeroPhoto() {
  return (
    <svg viewBox="0 0 300 225" className="hero-photo-svg" aria-hidden="true">
      <defs>
        <linearGradient id="hp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C6FD0" />
          <stop offset="0.45" stopColor="#F48CA0" />
          <stop offset="0.8" stopColor="#FFB36B" />
        </linearGradient>
        <linearGradient id="hp-river" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F79A8C" />
          <stop offset="1" stopColor="#6E5FB8" />
        </linearGradient>
        <radialGradient id="hp-sun">
          <stop offset="0" stopColor="#FFF4C2" />
          <stop offset="0.55" stopColor="#FFD77A" />
          <stop offset="1" stopColor="#FFB36B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="300" height="225" fill="url(#hp-sky)" />
      <circle cx="205" cy="128" r="58" fill="url(#hp-sun)" />
      <circle cx="205" cy="128" r="24" fill="#FFF1B8" />
      <path d="M0 160 Q60 108 128 132 T300 140 V225 H0 Z" fill="#6A4E9C" />
      <Tower fill="#3F2F6B" />
      <Skyline fill="#3A2C63" />
      <g fill="#FFD27A" opacity="0.85">
        {SKYLINE.flatMap(([x, w, h], i) =>
          [0, 1, 2].map((r) => (i + r) % 2 === 0 && <rect key={`${x}-${r}`} x={x + 4} y={GROUND - h + 6 + r * 12} width={w > 18 ? 5 : 3} height="3" />),
        )}
      </g>
      <rect y={GROUND} width="300" height="20" fill="url(#hp-river)" />
      <g fill="#FFF1B8" opacity="0.7">
        <rect x="186" y="209" width="38" height="2" rx="1" />
        <rect x="192" y="214" width="26" height="2" rx="1" />
        <rect x="198" y="219" width="14" height="2" rx="1" />
      </g>
    </svg>
  )
}

/** Same scene as a glowing x-ray, with the hidden coins showing. */
export function HeroXray() {
  const coins: [number, number, number][] = [
    [62, 70, 15],
    [150, 96, 18],
    [232, 64, 13],
    [104, 168, 12],
    [212, 172, 16],
  ]
  return (
    <svg viewBox="0 0 300 225" className="hero-photo-svg" aria-hidden="true">
      <defs>
        <pattern id="hx-grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0 H0 V12" fill="none" stroke="#3FE0D0" strokeOpacity="0.18" strokeWidth="0.8" />
        </pattern>
        <radialGradient id="hx-glow">
          <stop offset="0" stopColor="#FEE500" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FEE500" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="300" height="225" fill="#0C1B33" />
      <rect width="300" height="225" fill="url(#hx-grid)" />
      <g fill="none" stroke="#3FE0D0" strokeOpacity="0.55">
        <path d="M0 160 Q60 108 128 132 T300 140" strokeWidth="1.2" />
      </g>
      <Tower fill="none" stroke="#3FE0D0" />
      <Skyline fill="none" stroke="#3FE0D0" />
      <g fontFamily="ui-monospace, Menlo, monospace" fontSize="7" fill="#3FE0D0" fillOpacity="0.35">
        {['01010011', '01000001', '01010100', '01010011', '00000001'].map((b, i) => (
          <text key={i} x={8 + i * 58} y={20 + (i % 2) * 10}>
            {b}
          </text>
        ))}
      </g>
      {coins.map(([x, y, r], i) => (
        <g key={i} className="hx-coin" style={{ animationDelay: `${i * 0.12}s` }}>
          <circle cx={x} cy={y} r={r * 2.2} fill="url(#hx-glow)" />
          <circle cx={x} cy={y} r={r} fill="#FEE500" stroke="#B88A00" strokeWidth="1.5" />
          <text
            x={x}
            y={y + r * 0.38}
            textAnchor="middle"
            fontSize={r * 1.1}
            fontWeight="800"
            fill="#7A5A00"
            fontFamily="system-ui, sans-serif"
          >
            ₿
          </text>
        </g>
      ))}
    </svg>
  )
}
