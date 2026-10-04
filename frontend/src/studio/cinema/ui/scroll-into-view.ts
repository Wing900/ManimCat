/**
 * Bring a row or a tab into view the way the studio moves: it scrolls, it never jumps.
 *
 * A jump next to motion that eases everywhere else reads as a glitch, so the default is `smooth`. A
 * user who asked for reduced motion keeps the instant version. jsdom has no layout and no
 * `scrollIntoView` at all, which is a no-op here, so a spec never has to stub one.
 */
export function scrollIntoViewSoftly(element: Element | null | undefined): void {
  if (!element || typeof element.scrollIntoView !== 'function') {
    return
  }
  const reduced =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  element.scrollIntoView({
    behavior: reduced ? 'auto' : 'smooth',
    block: 'nearest',
    inline: 'nearest',
  })
}
