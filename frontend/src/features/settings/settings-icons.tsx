import type { SVGProps } from 'react'

/**
 * Marks for the Settings page, drawn in the project's own hand.
 *
 * The house style comes from `ManimCatLogo`: one flat ink geometry (`#455a64` via `ink`, or whatever
 * `currentColor` the row already carries), round caps and joins, no fills, no gradients, no icon
 * dependency. The cat is never a picture — it is one silhouette detail (ears) attached to the idea
 * the glyph is about, the way the logo hangs a head off the shoulder of the M.
 */
type IconProps = SVGProps<SVGSVGElement>

function mark(props: IconProps) {
  return {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

/**
 * AI connection: a cat-eared node joined to a four-point spark.
 *
 * The left shape is the local side (this app, cat); the spark is the model on the far end; the short
 * bar between them is the link itself. It replaces the old three-nodes "share" glyph, which said
 * "providers" — a word this app no longer uses.
 */
export function AiConnectionMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="7" cy="13" r="3.4" />
      <path d="M4.8 10.4 4.1 7.9" />
      <path d="M9.2 10.4 9.9 7.9" />
      <path d="M10.6 13h3.2" />
      <path d="M17.2 9.8 18.2 12l2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" />
    </svg>
  )
}

/** Video settings: a frame with cat ears and a play triangle. */
export function VideoMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path d="M4.6 8.4 5.2 4.9 8.4 6.7" />
      <path d="M19.4 8.4 18.8 4.9 15.6 6.7" />
      <rect x="4.6" y="6.7" width="14.8" height="12.6" rx="2.8" />
      <path d="M10.4 11.6 15 14.4l-4.6 2.8z" />
    </svg>
  )
}
