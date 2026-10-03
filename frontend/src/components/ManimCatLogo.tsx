/**
 * The project mark: an artistic "M" with the cat's head at its shoulder.
 *
 * `glyph` drops the ivory plate and the cat head and paints the M with `currentColor`, so the mark can
 * be used as a faint watermark (the empty cinema stage) instead of a brand stamp. The default shape
 * and colours are unchanged for every existing caller.
 */
const ManimCatLogo = ({ className, glyph = false }: { className?: string; glyph?: boolean }) => (
  <svg
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {glyph ? null : <rect width="512" height="512" fill="#faf9f5" />}
    <path
      d="M 100 400 V 140 L 230 300 L 360 140 V 260"
      fill="none"
      stroke={glyph ? 'currentColor' : '#455a64'}
      strokeWidth="55"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {glyph ? null : (
      <g transform="translate(360, 340)">
        <path
          d="M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z"
          fill="#455a64"
        />
        <circle cx="-35" cy="-5" r="18" fill="#ffffff" />
        <circle cx="35" cy="-5" r="18" fill="#ffffff" />
        <circle cx="-38" cy="-5" r="6" fill="#455a64" />
        <circle cx="32" cy="-5" r="6" fill="#455a64" />
      </g>
    )}
  </svg>
);

export default ManimCatLogo;
