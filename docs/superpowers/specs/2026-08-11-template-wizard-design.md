# Template Wizard — Design

Date: 2026-08-11
Status: Approved, ready for implementation planning

This is sub-project 2 of 3 in the larger "Fiddlesticks-inspired features"
initiative (sub-project 1, image-trace Shape Warp, is spec'd/planned/built
separately — see `docs/superpowers/specs/2026-08-11-image-trace-shape-warp-design.md`;
sub-project 3, cloud persistence, is not yet spec'd). Each sub-project is
its own branch/PR, merged independently. This sub-project has no
dependency on the other two.

## Summary

Turn the existing static `STARTER_TEMPLATES` ("Start from a Template"
sidebar section, which currently applies a template's hardcoded text
as-is with one click) into a parameterized generator: clicking a template
opens a modal wizard with one labeled, RTL text input per block in that
template, pre-filled with the template's original text. Editing fields and
clicking Generate replaces the canvas with the template's blocks using the
edited text. This is the smallest version of Fiddlesticks' "Builder"
concept — text-only parameterization of existing templates, not a new
procedural-layout engine.

## Non-goals

- No style/color/font parameters — only block `text` is editable through
  the wizard. A template's authored font, color, size, and position stay
  fixed, exactly as they render today.
- No new templates — this retrofits the 13 existing `STARTER_TEMPLATES`
  entries with field metadata; it doesn't add template content.
- No procedural/rule-based layout (e.g. auto-scaling font to fit text
  length, conditional ornamental elements) — out of scope, a much larger
  feature than "fill in a few text fields."
- No floating Arabic on-screen keyboard integration in the wizard's
  inputs — plain `dir="rtl"` text inputs, matching every other text input
  in this app outside the canvas itself. OS input methods handle Arabic
  typing.
- No changes to `randomizeLayout` (the existing 🎲 "Randomize Look"
  button) — unrelated feature, untouched.

## Data model

`StarterTemplate` (`src/lib/templates.ts`) gains an optional field:

```ts
export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  backgroundColor: string;
  blocks: Omit<TextBlock, "id">[];
  fields?: { blockIndex: number; label: string }[];
};
```

Every one of the 13 existing templates gets a `fields` entry for every
block it has (per the "every block is a field" decision) — single-block
templates (8 of the 13) get a one-item `fields` array, two-block templates
(5 of the 13) get two. Labels are hand-authored per template for clarity
(e.g. Eid Greeting: `"Main greeting"` / `"Subtitle"`; Name Monogram:
`"Name"`; Condolence Card: `"Main phrase"` / `"Verse reference"`) — not
generic "Line 1"/"Line 2", since the templates' blocks have genuinely
different roles.

A template with no `fields` array (shouldn't happen once all 13 are
retrofitted, but defensively) falls back to the current one-click-apply
behavior with no wizard — this keeps the type change backward-compatible
for any future template added without field metadata.

## New pure logic

`src/lib/templates.ts` adds:

```ts
export function buildBlocksFromTemplate(
  template: StarterTemplate,
  values: string[]
): Omit<TextBlock, "id">[]
```

Clones `template.blocks`, and for each entry in `template.fields`,
overwrites that block's `text` with the corresponding `values[i]` —
falling back to the block's original authored text if the value is empty
or whitespace-only (so a user can't generate a block with blank text by
accident). `values` is indexed positionally against `template.fields`
(not `template.blocks` directly), since a template could in principle
have fewer fields than blocks (defensive, not exercised by the current
13 templates since every block gets a field).

## New component: `TemplateWizardDialog.tsx`

Modal, modeled on `ImageTraceDialog.tsx`/`ConfirmDialog.tsx`'s portal
pattern (`createPortal` to `document.body`, Escape-to-cancel, click-outside
to cancel). Props:

```ts
type TemplateWizardDialogProps = {
  template: StarterTemplate;
  onGenerate: (values: string[]) => void;
  onCancel: () => void;
};
```

Renders: the template's `label` and `description`, one text input per
`fields` entry (label above/beside the input, pre-filled with that block's
original text, `dir="rtl" lang="ar" spellCheck={false}` matching the
existing block-text-editor convention in `Sidebar.tsx`), the same
"replaces the current canvas — Ctrl+Z to undo" warning text the current
flow already shows via `ConfirmDialog`, and Generate/Cancel buttons.
Generate calls `onGenerate` with the current field values in `fields`
order; Cancel/Escape/click-outside call `onCancel` with no side effects.

Folding the "replaces canvas" warning into this modal **replaces** today's
separate `ConfirmDialog` step for templates (`requestApplyStarterTemplate`)
— filling out a multi-field form is already a deliberate multi-step
action, so stacking a second confirmation dialog on top after clicking
Generate is redundant friction rather than added safety. The plan should
confirm nothing else references `requestApplyStarterTemplate` before
removing it.

## Wiring

- **`Sidebar.tsx`:** the template grid buttons (`"Start from a Template"`
  section) no longer call `onApplyTemplate(t.id)` directly. Instead they
  open `TemplateWizardDialog` for the clicked template (local dialog
  state, same pattern `ImageTraceDialog`'s `imageTraceFile` state
  established). The dialog's `onGenerate` calls a new
  `onGenerateFromTemplate(templateId, values)` prop.
- **`App.tsx`:** a new `generateFromTemplate(templateId, values)` reuses
  `applyStarterTemplate`'s existing replace-canvas mechanics
  (`pushHistory`, `setBlocks`, `setBackgroundColor`, `setShowGrid`,
  `setSelectedIds`/`setSelectedId`, `resetView`) but builds the new blocks
  via `buildBlocksFromTemplate(template, values)` instead of using
  `template.blocks` verbatim. `applyStarterTemplate` and
  `requestApplyStarterTemplate` (and the `ConfirmDialog` request they
  build) are deleted once `generateFromTemplate` is the only caller —
  the plan must grep for any other reference before removing them.

## Data flow

```
click a template button in Sidebar
  → open TemplateWizardDialog(template)
  → user edits 1-2 RTL text fields (pre-filled with template defaults)
  → click Generate
  → onGenerateFromTemplate(templateId, values)   [App.tsx]
  → buildBlocksFromTemplate(template, values)    [lib/templates.ts, pure]
  → same replace-canvas sequence applyStarterTemplate already used
```

## Error handling

No new failure modes — this is pure client-side string substitution, no
file I/O, no external library. An empty field silently falls back to the
template's default text (see "New pure logic" above) rather than erroring
or blocking Generate.

## Testing

`src/lib/templates.test.ts` (new file) covers `buildBlocksFromTemplate`:
generating with all fields at their defaults reproduces the original
`template.blocks` exactly; an edited field lands on the correct block by
index; a blank/whitespace-only field falls back to the original text;
a two-field template's two edits don't cross-contaminate each other's
blocks. `TemplateWizardDialog.tsx` is not unit-tested, matching this
codebase's existing convention for modal components
(`ConfirmDialog.tsx`, `ImageTraceDialog.tsx`).
