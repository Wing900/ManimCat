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