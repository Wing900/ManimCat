import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CatCharacter } from './CatCharacter'

/**
 * CatCharacter (doc §6): the independent cat-head SVG, extracted from `ManimCatLogo`.
 *
 * The brand base plate and the M stroke are removed; the head keeps its recognisable blue-gray
 * silhouette, two pointed ears, white eyes and dark pupils. The viewBox is compact but leaves
 * animation headroom so ears are never clipped. Body and tail are out of scope until the static
 * draft is visually accepted.
 */

describe('CatCharacter', () => {
  it('renders a single decorative svg that is hidden from assistive tech', () => {
    const { container } = render(<CatCharacter />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('focusable')).toBe('false')
  })

  it('drops the brand base plate and the M stroke from the original logo', () => {
    const { container } = render(<CatCharacter />)
    // The cream square base plate of ManimCatLogo.
    expect(container.querySelector('rect[fill="#faf9f5"]')).toBeNull()
    // The M stroke (a <path> with stroke and no fill) is gone too.
    const paths = Array.from(container.querySelectorAll('path'))
    const strokedPaths = paths.filter((path) => path.getAttribute('stroke'))
    expect(strokedPaths).toHaveLength(0)
  })

  it('keeps the head, two white eyes and two dark pupils', () => {
    const { container } = render(<CatCharacter />)
    const head = container.querySelector('[data-part="head"]')
    expect(head).not.toBeNull()
    const eyes = container.querySelectorAll('[data-part="eye"]')
    expect(eyes).toHaveLength(2)
    eyes.forEach((eye) => expect(eye.getAttribute('fill')).toBe('#ffffff'))
    const pupils = container.querySelectorAll('[data-part="pupil"]')
    expect(pupils).toHaveLength(2)
  })

  it('wears the conical wizard hat from the brand draft', () => {
    const { container } = render(<CatCharacter />)
    const hat = container.querySelector('[data-part="hat"]')
    expect(hat).not.toBeNull()
    // Cone, shaded fold, band and brim — the four pieces of the draft, with its exact palette.
    expect(container.querySelector('[data-part="hat-cone"]')?.getAttribute('fill')).toBe('#37474f')
    expect(container.querySelector('[data-part="hat-fold"]')?.getAttribute('fill')).toBe('#263238')
    expect(container.querySelector('[data-part="hat-band"]')?.getAttribute('fill')).toBe('#b0bec5')
    expect(container.querySelector('[data-part="hat-brim"]')?.getAttribute('fill')).toBe('#455a64')
    // Drawn after the head, so the cone and brim sit on top of the ears instead of behind them.
    const head = container.querySelector('[data-part="head"]')
    expect(head).not.toBeNull()
    expect(hat).not.toBeNull()
    const position = head!.compareDocumentPosition(hat!)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('fits the hat tip and the chin inside the viewBox so nothing is clipped', () => {
    const { container } = render(<CatCharacter />)
    const [, , width, height] = (container.querySelector('svg')?.getAttribute('viewBox') ?? '')
      .split(/\s+/)
      .map(Number)
    // The group sits at (100, 90): the hat tip reaches y=-70 → 20, the chin y=70 → 160, ears x=±80 → 20/180.
    expect(90 - 70).toBeGreaterThanOrEqual(0)
    expect(90 + 70).toBeLessThanOrEqual(height)
    expect(100 - 80).toBeGreaterThanOrEqual(0)
    expect(100 + 80).toBeLessThanOrEqual(width)
  })

  it('uses a compact viewBox that contains the ears with headroom', () => {
    const { container } = render(<CatCharacter />)
    const svg = container.querySelector('svg')
    const viewBox = svg?.getAttribute('viewBox') ?? ''
    const [, , width, height] = viewBox.split(/\s+/).map(Number)
    // Doc §6: compact but with animation headroom; not the 512×512 brand canvas.
    expect(width).toBeLessThan(512)
    expect(height).toBeLessThan(512)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })

  it('exposes the pose as a data attribute instead of cloning the svg', () => {
    const { container } = render(<CatCharacter pose="busy" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('data-pose')).toBe('busy')
  })

  it('lets the caller drive the size through className without a fixed pixel size', () => {
    const { container } = render(<CatCharacter className="h-24 w-24" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('h-24')
    expect(svg?.getAttribute('width')).toBeNull()
    expect(svg?.getAttribute('height')).toBeNull()
  })
})