## Visual style
1. Background: paper white #FAF9F5 throughout.
2. Ink: #455A64 for text and base geometry; build hierarchy with weight and opacity.
3. Palette: PINK #E89B96, BLUE #9AAEDB, APRICOT #E8B184 as the limited main colors, with SAGE #CAD895 and MINT #97CEB9 as backups. Keep each object's color consistent; main lines stay saturated, never washed out.
4. Hierarchy: primary elements at 90–100% opacity, guide lines at 15–25%, translucent fills at 8–15%; guides thin, with primary line width about 3× guide width; foreground text at 100% with ample contrast. Never bleach the whole frame.
5. Expression: serve the user's request with synchronized geometric change plus necessary parameters and formulas, not large titles or paragraphs of explanation. Add no decorative captions, background grids, or teaching steps unless requested; do not expand the topic or force split screens. Leave breathing room, keep the main object stable, and drive related objects from the same mathematical state.

## Timing
When revealing relationships, move through key states as change, brief hold, next change, with smooth ease-in-out. Use smoothstep 3t²−2t³ (0≤t≤1) when helpful, but only through APIs the current runtime supports or a small custom function. Use linear for uniform motion and equal-time sampling so easing never distorts mathematical meaning. Keep the camera steady by default; add gentle motion only when 3D needs it, never forced drift or rotation. Explicit user requests take priority.
