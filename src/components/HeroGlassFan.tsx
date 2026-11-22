import React from 'react';

interface TubeProps {
  x: number;
  y: number;
  angle: number;
  scale?: number;
  opacity?: number;
  idSuffix: string;
}

function GlassTube({ x, y, angle, scale = 1, opacity = 1, idSuffix }: TubeProps) {
  const bodyGradId = `glassBody_${idSuffix}`;
  const rimGradId = `glassRim_${idSuffix}`;
  const innerGradId = `glassInner_${idSuffix}`;
  const highlightId = `glassSpec_${idSuffix}`;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${angle}) scale(${scale})`} opacity={opacity}>
      <defs>
        <linearGradient id={bodyGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0F2D9E" stopOpacity="0.88" />
          <stop offset="14%" stopColor="#3B82F6" stopOpacity="0.55" />
          <stop offset="32%" stopColor="#93C5FD" stopOpacity="0.24" />
          <stop offset="50%" stopColor="#60A5FA" stopOpacity="0.14" />
          <stop offset="72%" stopColor="#2563EB" stopOpacity="0.45" />
          <stop offset="88%" stopColor="#DBEAFE" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0.92" />
        </linearGradient>

        <linearGradient id={innerGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1E3A8A" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1E40AF" stopOpacity="0.75" />
        </linearGradient>

        <linearGradient id={rimGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="45%" stopColor="#BFDBFE" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0.85" />
        </linearGradient>

        <linearGradient id={highlightId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.88" />
          <stop offset="65%" stopColor="#BFDBFE" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Subtle ambient glow behind cylinder */}
      <rect
        x="-38"
        y="-192"
        width="76"
        height="215"
        rx="38"
        fill="#1D4ED8"
        opacity="0.18"
      />

      {/* Main translucent glass cylinder shaft */}
      <path
        d="M -33,-178 L -33,0 A 33,13 0 0 0 33,0 L 33,-178 Z"
        fill={`url(#${bodyGradId})`}
        stroke="rgba(219, 234, 254, 0.55)"
        strokeWidth="1.2"
      />

      {/* Inner hollow glass bore */}
      <path
        d="M -23,-178 L -23,-4 A 23,8 0 0 0 23,-4 L 23,-178 Z"
        fill={`url(#${innerGradId})`}
      />

      {/* Left vertical specular refraction streak */}
      <rect
        x="-28"
        y="-172"
        width="5.5"
        height="158"
        rx="2.75"
        fill={`url(#${highlightId})`}
        opacity="0.75"
      />

      {/* Fine inner edge highlight */}
      <rect
        x="-19"
        y="-168"
        width="2"
        height="148"
        rx="1"
        fill="#FFFFFF"
        opacity="0.45"
      />

      {/* Right vertical bright rim reflection */}
      <rect
        x="21.5"
        y="-173"
        width="7"
        height="162"
        rx="3.5"
        fill={`url(#${highlightId})`}
        opacity="0.85"
      />

      {/* 3D Elliptical Glass Lip / Cap */}
      <ellipse
        cx="0"
        cy="-178"
        rx="33"
        ry="13"
        fill="rgba(147, 197, 253, 0.25)"
        stroke={`url(#${rimGradId})`}
        strokeWidth="3.2"
      />

      {/* Inner bevel ellipse of hollow tube */}
      <ellipse
        cx="0"
        cy="-178"
        rx="23"
        ry="8.2"
        fill="rgba(30, 58, 138, 0.42)"
        stroke="rgba(224, 242, 254, 0.72)"
        strokeWidth="1.3"
      />

      {/* Crisp top specular crescent */}
      <path
        d="M -28,-182 A 30,11 0 0 1 24,-184"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.92"
      />
    </g>
  );
}

export const HeroGlassFan: React.FC = () => {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* Radiant bloom behind the glass sculpture */}
      <div
        className="absolute left-[50%] bottom-[16%] -translate-x-1/2 w-[520px] h-[280px] rounded-full blur-3xl opacity-55"
        style={{
          background:
            'radial-gradient(circle, rgba(219, 234, 254, 0.65) 0%, rgba(96, 165, 250, 0.3) 45%, transparent 72%)',
        }}
      />

      <svg
        viewBox="0 0 1200 420"
        className="w-full h-full object-cover object-center"
        preserveAspectRatio="xMidYMax slice"
      >
        <g transform="translate(650, 325)">
          {/* Far left angled glass cylinder */}
          <GlassTube x={-95} y={14} angle={-54} scale={0.94} opacity={0.92} idSuffix="t1" />
          {/* Inner left glass cylinder */}
          <GlassTube x={-48} y={-2} angle={-27} scale={0.99} opacity={0.96} idSuffix="t2" />
          {/* Center upright glass cylinder */}
          <GlassTube x={4} y={-8} angle={1.5} scale={1.03} opacity={1} idSuffix="t3" />
          {/* Inner right glass cylinder */}
          <GlassTube x={54} y={0} angle={29} scale={0.98} opacity={0.95} idSuffix="t4" />
          {/* Far right angled glass cylinder */}
          <GlassTube x={98} y={16} angle={55} scale={0.92} opacity={0.9} idSuffix="t5" />
        </g>
      </svg>
    </div>
  );
};
