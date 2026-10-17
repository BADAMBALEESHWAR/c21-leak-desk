// The Profyn mark: a magnifier (know more) with a rising arrow breaking out of it (earn better).
// Brand colours: navy #1E293B, emerald #10B981, orange #F97316. On dark backgrounds the navy parts turn white.
export const LOGO_COLORS = { navy: '#1E293B', green: '#10B981', orange: '#F97316' } as const;

export function LogoMark({ size = 32, onDark = false, title }: { size?: number; onDark?: boolean; title?: string }) {
  const ink = onDark ? '#FFFFFF' : LOGO_COLORS.navy;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {/* Lens and handle */}
      <circle cx="27" cy="29" r="17" stroke={ink} strokeWidth="5.5" />
      <path d="M40.5 42.5 50 52" stroke={ink} strokeWidth="7" strokeLinecap="round" />
      {/* Top of the lens: emerald sweeping into orange */}
      <path d="M10.6 24.6 A17 17 0 0 1 29.95 12.26" stroke={LOGO_COLORS.green} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M29.95 12.26 A17 17 0 0 1 41.72 20.5" stroke={LOGO_COLORS.orange} strokeWidth="5.5" strokeLinecap="round" />
      {/* Trend: navy start, emerald rise, arrow out of the lens */}
      <path d="M5 50 16 38" stroke={ink} strokeWidth="6" strokeLinecap="round" />
      <path d="M16 38 21.5 32.5 27.5 40 45.4 14.8" stroke={LOGO_COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M51.9 5.9 50.3 18.3 40.5 11.3Z" fill={LOGO_COLORS.green} stroke={LOGO_COLORS.green} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
