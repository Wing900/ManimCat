import type { SVGProps } from 'react'

/**
 * Marks for the Settings rail, drawn in the project's own hand.
 *
 * The house style comes from `ManimCatLogo`: one flat ink geometry (`currentColor`, so a row keeps
 * its own text colour), round caps and joins, no fills, no gradients, no icon dependency.
 *
 * These are deliberately three strokes or fewer. An earlier pass hung cat ears off each shape; at
 * the rail's 22px the ears and the body merged into one black blob, so the cat lives in the wordmark
 * and the rail stays legible.
 */
type IconProps = SVGProps<SVGSVGElement>

function mark(props: IconProps) {
  return {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

/**
 * AI connection: the link itself — two hooks closing on a shared bar.
 *
 * This credential decides which model the far end talks to, so the glyph is the thing the setting
 * is about, not a metaphor for it.
 */
export function AiConnectionMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path d="M9.9 13.4a3.6 3.6 0 0 0 5.4.4l2.3-2.3a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3" />
      <path d="M14.1 10.6a3.6 3.6 0 0 0-5.4-.4l-2.3 2.3a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3" />
    </svg>
  )
}

/** Video output: a frame and a play head. */
export function VideoMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2" />
      <path d="M10.4 9.6 15.2 12l-4.8 2.4z" />
    </svg>
  )
}
