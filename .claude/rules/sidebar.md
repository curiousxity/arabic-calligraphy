---
paths:
  - "src/components/Sidebar.tsx"
  - "src/components/sidebar/**"
  - "src/components/TemplateWizardDialog.tsx"
---

# Sidebar structure

`Sidebar.tsx` is a large single component that reads/writes through props from `App.tsx`. Shared low-level form pieces (`SelectRow`, `ColorRow`, `RangeRow`, `CheckboxRow`, `PresetKeyboard`) live in `src/components/sidebar/FormControls.tsx`; the layer list is `src/components/sidebar/LayersPanel.tsx`. `src/components/sidebar/utils.ts` has one helper (`makeId`).

Its panels are ordered in **three tiers by scope**, each introduced by a
`SidebarTier` rule (a quiet labelled divider, deliberately lighter than a
panel title so it groups without competing):

| Tier | Panels |
|---|---|
| `document` | Start from a Template · Background & Grid · Project & Export |
| `canvas` | Block Controls · Layers · Align & Arrange |
| `selected` | Content · *type panel* · Typography · Transform · Effects |

Then Shortcuts, outside any tier. The point of the split is that every
panel which appears and disappears with the selection sits in one
contiguous run, instead of interleaving with the permanent ones.

Two naming rules in the `selected` tier are worth knowing before adding a
panel there:

- **The *type panel* is named after the block type** — `Shape Fill`,
  `Curve`, `Image`, `Square Kufi` — and holds only what is specific to it (a
  Shape Fill block's scale/spacing/rotation rows, a Curve block's preset and
  pen-tool controls, a Square Kufi block's panel width and gaps). It renders directly under Content, above the
  shared panels, because for those types it is the panel that matters
  most. A plain text block has no type panel; its controls are the shared
  ones.
- **`Typography` is the shared styling panel** (font family, size,
  colour, alignment, line height, plus the text-only Warp and
  Move & scale sections). It is *not* called "Text" precisely because it renders for
  shape and curve blocks too, where a panel named "Text" sitting beside
  one named "Shape Fill" reads as two competing type panels.

`Transform` is therefore left holding only rotation — the one transform
every type shares. Anything type-specific that lands there belongs in the
type panel instead.

`Content` owns everything that puts characters into the block: the RTL
textarea, the Arabic Keyboard toggle, and the `PresetKeyboard` rows
(إعراب, Presets, Specials, Urdu-Farsi) that were once a separate "Arabic
Helpers" panel. That name is gone — character insertion lives in exactly
one place now.

The "Start from a Template" section's buttons don't apply a template
directly — each opens `TemplateWizardDialog.tsx`, a small modal with one
RTL text field per block in that template (`StarterTemplate.fields` in
`lib/templates.ts`, hand-authored per template, pre-filled with the
template's original text). Generate calls `App.tsx`'s
`generateFromTemplate`, which builds the new blocks via the pure
`buildBlocksFromTemplate(template, values)` (falls back to a field's
original text if left blank) before doing the same replace-canvas
sequence the old one-click apply used. This replaced a separate
`ConfirmDialog` "this clears the canvas" step — the wizard's own warning
text serves that purpose now, since filling out a form is already a
deliberate action and a second confirmation on top was redundant
friction.

**Block Controls is three labelled groups on fixed grids**, not one
wrapping row. `Add` (text, shape fill, curved text, square kufi, image,
ornament, mirror, medallion) sits on a 4-column grid, which the eight buttons
now fill exactly two rows of; `Selected` (duplicate, delete) and
`History` (undo, redo, history) share a line below it. The row this replaced
was a centred `flex-wrap` of twelve identical chips, which at the sidebar's
own width wrapped **8 / 1 / 3** — stranding the ornament button alone on a
line, which reads as a bug rather than a layout. Columns are fixed so the
shape is chosen rather than emergent. The split also moves the destructive
`Delete` out of the leading position, where it sat immediately beside
`Duplicate`.

Icon-button labels follow **sentence case and name the outcome**, not the
mechanism: `Add shape fill`, not "Upload SVG for Shape Fill". The `title`
tooltip carries a trailing `…` when the button opens a picker or a file
dialog; the `aria-label` stays clean, which is also what keeps the e2e
selectors plain. Renaming one means updating `e2e/` in the same commit —
`mirror.spec.ts`, `ornaments.spec.ts` and `ink-surface.spec.ts` all address
these buttons by accessible name.

`PresetKeyboard` takes a `collapsible` flag and renders as a native
`<details>` when set — no owning state, and keyboard-operable for free.
Presets, Specials and Urdu-Farsi use it and start closed; the إعراب harakat
row stays open, being the one wanted on nearly every edit. Four open at once
was most of why the sidebar ran four screens tall.

CSS is one global stylesheet (`src/index.css`) using CSS custom properties for theming — navy+gold is the unconditional default (`:root`), with an ivory/parchment palette under `@media (prefers-color-scheme: light)` (inverted from the usual light-default/dark-override convention — check this file's structure before assuming which block is "the default").

**Keyboard focus is defined once, at the bottom of `index.css`**, as a
2px `var(--accent)` outline on `:where(button, select, input, textarea,
[tabindex]):focus-visible`. Before it, the only `:focus` rules in the file
were on two text inputs, so every other control fell back to the UA ring —
Chrome's light blue, 1px, close to invisible on the navy panels and foreign
to the palette. `:where()` holds the specificity at zero so any component's
own focus treatment still wins, and the rule deliberately sets no
`border-radius`: an outline already follows the element's own, and forcing
one flattens the circular buttons while they are focused.

Known CSS-layout footgun in this codebase: **CSS Grid and Flex children default to `min-width: auto`**, which refuses to shrink below content size and causes silent overflow/clipping at narrow sidebar widths. When adding a new multi-item row (grid or flex), give items `min-width: 0` explicitly or the row will overflow at the sidebar's minimum width instead of degrading gracefully.

**Demo GIFs on hover.** `CheckboxRow` takes an optional `demo` (`{ src, alt }`),
which adds a `DemoHint` play icon beside the label: never inside it, because a
button inside a `<label>` toggles the checkbox. Hovering or focusing the icon
shows the GIF in a popover portalled to `<body>` with fixed positioning, so the
sidebar's scroll container can't clip it. The `<img>` mounts only while the
popover is open, so the recordings never load unless someone asks. The files
live in `public/demos/` and are 480x380 recordings cropped to the lettering.
They are separate from the README's full-window GIFs in `docs/media/`, which
the app can't serve.
