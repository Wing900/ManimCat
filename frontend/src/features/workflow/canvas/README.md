# Canvas workspace

`CanvasWorkspaceModal` assembles the workspace. Each mount owns a fresh document.

- `useCanvasDocument`: pages, object order, selection, committed edits and dirty state.
- `canvas-history`: pure history reducer with up to 100 undo steps. Snapshots share
  unchanged pages and objects. A new committed edit clears redo; selection and page
  navigation alone do not create history entries. Drawing/moving commits once;
  eraser gestures and inline text sessions use transactions. Cancellation restores
  the transaction snapshot without consuming redo history.
- `useCanvasInteraction`: pointer capture, transient drawing drafts, polygon completion,
  object movement and function-plot resizing. Drafts commit on completion;
  Escape and pointer cancellation discard them. Tool/page changes remount the surface.
- `CanvasShapePanel`: shape selection only. Selecting or creating an object keeps
  the panel open; the user can close it or switch to another toolbar tool.
- `objects/`: discriminated object types, geometry, text layout and drawing.
- `objects/object-transform`: reusable affine transforms for rendering, hit testing,
  local/world coordinates, movement, uniform scaling and rotation.
- `canvas-selection`: shared handle geometry and a thin neutral outline. Handle
  sizes remain constant on screen as objects and the workspace change size.
- `canvas-render`: shared scene rendering. Selection and pointer overlays are
  drawn separately and never included in thumbnails or exported reference images.
- `CanvasPreviewStrip`: memoized small canvases; repaint committed pages only.
- `canvas-export` / `useCanvasExport`: PNG conversion, upload and error state.

## Interaction

Drag to draw circles, ellipses, lines, arrows, rectangles and triangles. Click
successive vertices for a polyline; Enter finishes it open, clicking the first
vertex closes a polygon, and Escape cancels the draft. Text opens an inline input at the clicked position, with font-size controls and
a width handle. Text edits are reflected in the document as you type; Escape
restores the original object, clicking outside finishes editing. Functions open
a preview dialog using the shared modal transition and animation classes.

Select and drag objects to move them. Delete/Backspace removes a selected object.
Text and function plots can be edited by double-clicking or pressing Enter.
Selected objects have four corner handles for proportional scaling and a round
handle above the frame for rotation. Shift snaps rotation to 15-degree steps.
Selection has no floating Edit/Delete buttons. A complete transform gesture is
one undo step. The same transforms are retained in thumbnails and PNG exports.
Top-center Undo/Redo controls also support Ctrl/Command+Z, Ctrl/Command+Shift+Z
and Ctrl+Y. Inputs keep their native text undo behavior. Restoring history resets
the surface's transient pointer drafts and restores the corresponding page.
Style changes apply to the selection in Select mode and to new objects otherwise.
The eraser cuts handwriting into fragments and removes other objects as a whole.

## Function plots

`plot/expression.ts` parses a bounded arithmetic AST without evaluating JavaScript.
The grammar supports numbers (including scientific notation), `x`, `pi`, `e`,
parentheses, unary signs and `+ - * / ^`. Exponents associate to the right;
exponentiation binds more tightly than unary minus. Multiplication must be explicit.

Single-argument functions: `sin cos tan asin acos atan sqrt abs exp ln log log10
floor ceil round sign`. Angles use radians; `ln` is natural logarithm, `log` and
`log10` are base 10. An optional `y =` prefix is accepted.

`plot/sampling.ts` maps an explicit `y = f(x)` into local pixel coordinates with
bounded adaptive subdivision. Undefined samples and unresolved jumps break paths.
`plot/viewport.ts` expands all four edges by 0.5% of each axis's entered span,
without altering the saved inputs. For example, y in [1, 2] renders [0.995, 2.005].
Sampling resolution also accounts for object scaling to retain smooth curves.
This is numerical rendering: extreme oscillations and narrow features can exceed
the sampling budget. Implicit equations and symbolic solving are outside this scope.

The function object retains its expression, coordinate ranges, bounds and style.
`plot/render.ts` is shared by preview, surface, thumbnails and PNG export. It draws
no axes, ticks, grid or background fill. Transparent areas preserve the underlying
document content. The editor's light preview background is CSS only and is not
painted into the function object.
