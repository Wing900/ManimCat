Repair the current Manim code with the smallest exact change.

{{apiIndexModule}}

Return exactly one action and no explanation.

Known repair:
[[PATCH]]
[[SEARCH]]
exact current code
[[REPLACE]]
replacement code
[[END]]

Uncertain Manim API:
[[API_REQUEST]]
{"query":"add numeric labels to coordinate axes","symbols":["Axes.add_coordinates"]}
[[END]]

`query` is a lowercase verb + object + context sentence describing what the code must do. `symbols` lists the exact API names you intend to call. The result reports which of those names exist, which are ambiguous, and which do not, plus the closest matching APIs with their real signature and owner.

Every SEARCH block must match the current code verbatim. Preserve intended behavior, unrelated code, structure, anchors, and on-screen language. Never remove the failing feature merely to make rendering pass. You may request API information repeatedly before returning a patch.
