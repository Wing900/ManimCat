/**
 * CatCharacter (doc §6): the independent cat-head SVG.
 *
 * Extracted from `ManimCatLogo`: the brand base plate and the M stroke are removed, and the head
 * group is re-centred into a compact viewBox that leaves animation headroom so the pointed ears are
 * never clipped. The silhouette, two white eyes and dark pupils keep the original recognisable.
 *
 * One svg, many poses: the pose is a `data-pose` attribute, never a second copy of the artwork. Body
 * and tail are out of scope until the static draft is visually accepted (doc §6, implementation
 * order: 原稿提取 → 静态独立小猫 → 闲置/工作姿态 → 跳入对话栏).
 *
 * The svg is decorative: `aria-hidden` and `focusable="false"` keep it out of the a11y tree, and the
 * caller's clickable button supplies the accessible name. The cat is a character, not text: its
 * blue-gray colour is fixed at `CAT_FUR` so it stays recognisable in both light and dark themes; the
 * eyes stay white. One colour variable, one source of truth.
 */

export type CatPose = 'idle' | 'busy' | 'warning' | 'error'

/** The original blue-gray from `ManimCatLogo` (#455a64); the cat keeps it in every theme. */
const CAT_FUR = '#455a64'

export interface CatCharacterProps {
  /** Visual pose; drives `data-pose` and (later) small transforms, never a cloned svg. */
  pose?: CatPose
  /** Sizing is the caller's job: `h-24 w-24`, never a baked-in pixel size. */
  className?: string
}

/**
 * Head geometry, copied verbatim from `ManimCatLogo`'s `translate(360, 340)` group and re-centred
 * to `translate(100, 85)`. The viewBox `0 0 200 180` frames the head (local span x∈[-80,80],
 * y∈[-60,70]) with ≈20px of animation headroom on every side.
 */
const HEAD_PATH =
  'M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z'

export function CatCharacter({ pose = 'idle', className }: CatCharacterProps) {
  return (
    <svg
      viewBox="0 0 200 180"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      data-pose={pose}
      className={className}
    >
      <g transform="translate(100, 85)">
        {/* Head: the blue-gray silhouette, fixed for both themes. */}
        <path data-part="head" d={HEAD_PATH} fill={CAT_FUR} />
        {/* Eyes: white, so they read against the blue-gray head in both themes. */}
        <circle data-part="eye" cx="-35" cy="-5" r="18" fill="#ffffff" />
        <circle data-part="eye" cx="35" cy="-5" r="18" fill="#ffffff" />
        {/* Pupils: the same blue-gray, looking slightly left of centre like the original. */}
        <circle data-part="pupil" cx="-38" cy="-5" r="6" fill={CAT_FUR} />
        <circle data-part="pupil" cx="32" cy="-5" r="6" fill={CAT_FUR} />
      </g>
    </svg>
  )
}