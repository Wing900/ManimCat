import type { SVGProps } from 'react'

/**
 * Inline UI glyphs for the cinema shell (doc §3/§4: actions are icons, not text).
 *
 * No icon dependency is added: every glyph is a 20px stroke SVG that inherits `currentColor` and
 * follows the home screen's icon style (`w-5 h-5`, stroke width 2, round caps). Each icon is
 * decorative (`aria-hidden`); the owning button carries the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

/** Back to the home screen; matches the home top-left arrow idiom. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Send: an up arrow, the composer's primary action. */
export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  )
}

/** Stop: a filled square, shown while a Run can be cancelled. Sized to read at a glance next to Send. */
export function StopIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, fill: 'currentColor', stroke: 'none' })}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
    </svg>
  )
}
