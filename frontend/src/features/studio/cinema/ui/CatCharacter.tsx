/**
 * CatCharacter (doc §6): the independent ManimCat head — the blue-gray cat wearing its wizard hat.
 *
 * The brand base plate and the M stroke stay in `ManimCatLogo`; this is the character alone, on a
 * transparent background, so it can sit on any surface in either theme (a cream plate would glare in
 * the dark theme and read as a card, not a character). The silhouette, the two white eyes and the dark
 * pupils are the original; the hat is the conical wizard hat from the current brand draft.
 *
 * Geometry: the head spans x∈[-80,80], y∈[-60,70] and the hat tip reaches y=-70, so the group is
 * translated to (100, 90) inside a `0 0 200 180` viewBox — 20px of animation headroom on every side,
 * and neither the ears nor the hat tip can be clipped.
 *
 * One svg, many poses: the pose is a `data-pose` attribute, never a second copy of the artwork. Body
 * and tail are out of scope until the static draft is visually accepted (doc §6, implementation order:
 * 原稿提取 → 静态独立小猫 → 闲置/工作姿态 → 跳入对话栏).
 *
 * The svg is decorative: `aria-hidden` and `focusable="false"` keep it out of the a11y tree, and the
 * caller's clickable button supplies the accessible name. The cat is a character, not text: its
 * palette is fixed so it stays recognisable in both themes. One palette, one source of truth.
 */

export type CatPose = 'idle' | 'busy' | 'warning' | 'error'

/** The original blue-gray from `ManimCatLogo` (#455a64); the cat keeps it in every theme. */
const CAT_FUR = '#455a64'

/** Wizard hat palette, taken verbatim from the brand draft: cone, shaded fold, band. */
const HAT_CONE = '#37474f'
const HAT_FOLD = '#263238'
const HAT_BAND = '#b0bec5'

export interface CatCharacterProps {
  /** Visual pose; drives `data-pose` and (later) small transforms, never a cloned svg. */
  pose?: CatPose
  /** Sizing is the caller's job: `h-24 w-24`, never a baked-in pixel size. */
  className?: string
}

/** Head geometry, copied verbatim from `ManimCatLogo`'s `translate(360, 340)` head group. */
const HEAD_PATH =
  'M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z'

/** Conical hat: wide at the brim, pulling to a tip that leans right and folds. */
const HAT_CONE_PATH = 'M -21 -31 L -7 -70 L 18 -68 L 36 -52 L 14 -50 L 21 -31 Z'
/** The back fold, so the cone reads as cloth rather than a triangle. */
const HAT_FOLD_PATH = 'M 5 -69 L 18 -68 L 36 -52 L 14 -50 Z'
/** Brim: two shallow arcs whose ends tuck inside the ears' roots. */
const HAT_BRIM_PATH = 'M -24 -29 C -24 -34, 24 -34, 24 -29 C 24 -26, -24 -26, -24 -29 Z'

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
      <g transform="translate(100, 90)">
        {/* Head: the blue-gray silhouette, fixed for both themes. */}
        <path data-part="head" d={HEAD_PATH} fill={CAT_FUR} />
        {/* Eyes: white, so they read against the blue-gray head in both themes. */}
        <circle data-part="eye" cx="-35" cy="-5" r="18" fill="#ffffff" />
        <circle data-part="eye" cx="35" cy="-5" r="18" fill="#ffffff" />
        {/* Pupils: the same blue-gray, looking slightly left of centre like the original. */}
        <circle data-part="pupil" cx="-38" cy="-5" r="6" fill={CAT_FUR} />
        <circle data-part="pupil" cx="32" cy="-5" r="6" fill={CAT_FUR} />
        {/* The wizard hat, drawn last so the cone and brim sit on top of the ears. */}
        <g data-part="hat">
          <path data-part="hat-cone" d={HAT_CONE_PATH} fill={HAT_CONE} />
          <path data-part="hat-fold" d={HAT_FOLD_PATH} fill={HAT_FOLD} />
          <polygon data-part="hat-band" points="-21,-31 21,-31 20,-37 -20,-37" fill={HAT_BAND} />
          <path data-part="hat-brim" d={HAT_BRIM_PATH} fill={CAT_FUR} />
        </g>
      </g>
    </svg>
  )
}
