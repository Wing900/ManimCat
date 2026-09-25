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
{"query":"what you need to know","symbols":["RelevantClass.method"]}
[[END]]

Every SEARCH block must match the current code verbatim. Preserve intended behavior, unrelated code, structure, anchors, and on-screen language. Never remove the failing feature merely to make rendering pass. You may request API information repeatedly before returning a patch.
