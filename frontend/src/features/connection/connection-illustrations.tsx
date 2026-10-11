import type { SVGProps } from 'react'

/**
 * The two illustrations on the guide's first screen.
 *
 * This is 博士's own artwork, carried over as authored: viewBox 400×260, the line drawing, the cat
 * exactly as in `ManimCatLogo`, and the two gestures — the key standing beside the cat, and a hand
 * offering the key to the cat. Nothing was redrawn.
 *
 * There is no background of any kind. The plate the original carried has been removed, because a
 * card now sits behind the drawing (see `ConnectionChoice`) and a second, differently-coloured white
 * under the ink only argues with it. One surface, one white: the card's. Every shape is stroked and
 * nothing is filled except the cats' pupils, so the drawings work on whatever the card happens to be
 * — which is also what makes the dark theme safe, with no literal `#ffffff` to turn into a brick.
 *
 * The ink is `currentColor`, so it is the app's own text colour, in whichever theme.
 *
 * On the author's request the raised paw is gone — with it, the one place where the head's outline
 * was crossed by another line. The key it used to hold is still there, now standing on the horizon,
 * which is the only reason its shaft runs all the way down to y=224. The two cats differ in what is
 * in front of them, where the key is, and their mouths: a shallow upward arc («嗯，好了») on the
 * left, and the author's small oval on the right.
 *
 * What remains, still as authored: the key ring's arc runs into the fist in the second picture, and
 * there is nothing filling shapes to hide it. The strokes cross.
 */
type IllustrationProps = SVGProps<SVGSVGElement>

function illustration(props: IllustrationProps) {
  return {
    viewBox: '0 0 400 260',
    xmlns: 'http://www.w3.org/2000/svg',
    fill: 'none',
    stroke: 'currentColor',
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

/** CatKey：钥匙立在地上，猫看着它，嘴上是一道很浅的弧——「嗯，好了」。 */
export function CatKeyIllustration(props: IllustrationProps) {
  return (
    <svg {...illustration(props)}>
      <path d="M34 224 C115 223 286 223 366 224" strokeWidth={4} strokeLinecap="round" />

      <g strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="122" cy="128" r="16" />
        <circle cx="122" cy="128" r="9" />
        <line x1="122" y1="144" x2="122" y2="224" />
        <line x1="122" y1="184" x2="108" y2="184" />
        <line x1="122" y1="196" x2="112" y2="196" />
      </g>

      <g transform="translate(265, 143) scale(1.03)">
        <path
          d="M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z"
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <circle cx="-35" cy="-5" r="18" strokeWidth={4.5} />
        <circle cx="35" cy="-5" r="18" strokeWidth={4.5} />
        <circle cx="-38" cy="-5" r="6" fill="currentColor" stroke="none" />
        <circle cx="32" cy="-5" r="6" fill="currentColor" stroke="none" />

        <path d="M -15 30 q 7 9 14 0" strokeWidth={3} strokeLinecap="round" />
      </g>
    </svg>
  )
}

/** 自己的 API：手递钥匙，猫张开一颗小小的 O——「哦，你带来的」。 */
export function OwnApiIllustration(props: IllustrationProps) {
  return (
    <svg {...illustration(props)}>
      <path d="M28 224 C110 223 290 223 372 224" strokeWidth={4} strokeLinecap="round" />

      <g strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 24 112 C 48 113, 69 116, 88 122 C 96 118, 104 120, 110 126 C 115 131, 114 138, 108 143 C 102 148, 94 149, 85 146 C 66 151, 46 154, 24 154 Z" />
        <path d="M 87 122 C 92 125, 95 130, 94 135" strokeWidth={2.4} />
        <path d="M 94 121 C 100 124, 103 129, 102 135" strokeWidth={2.4} />

        <circle cx="112" cy="135" r="10" />
        <line x1="122" y1="135" x2="181" y2="135" />
        <line x1="161" y1="135" x2="161" y2="147" />
        <line x1="171" y1="135" x2="171" y2="143" />
      </g>

      <g transform="translate(286, 143) scale(1.03)">
        <path
          d="M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z"
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <circle cx="-35" cy="-5" r="18" strokeWidth={4.5} />
        <circle cx="35" cy="-5" r="18" strokeWidth={4.5} />
        <circle cx="-38" cy="-5" r="6" fill="currentColor" stroke="none" />
        <circle cx="32" cy="-5" r="6" fill="currentColor" stroke="none" />

        <ellipse cx="-12" cy="35" rx="5" ry="7" strokeWidth={3} />
      </g>
    </svg>
  )
}
