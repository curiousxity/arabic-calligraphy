# Template Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing static "Start from a Template" sidebar section into a parameterized generator — clicking a template opens a modal wizard with one labeled RTL text field per block, pre-filled with the template's original text, and Generate replaces the canvas with the template's blocks using the edited text.

**Architecture:** `StarterTemplate` (`src/lib/templates.ts`) gains an optional `fields: { blockIndex: number; label: string }[]` array, hand-authored for all 13 existing templates. A new pure `buildBlocksFromTemplate(template, values)` clones a template's blocks with each field's text substituted in (falling back to the original text for blank input). A new `TemplateWizardDialog.tsx` modal (modeled on `ImageTraceDialog.tsx`/`ConfirmDialog.tsx`) shows one input per field plus the existing "replaces canvas" warning text, and calls back once on Generate. `Sidebar.tsx`'s template buttons open the wizard instead of applying directly; `App.tsx`'s new `generateFromTemplate` reuses `applyStarterTemplate`'s replace-canvas mechanics but builds blocks via `buildBlocksFromTemplate`. The old `applyStarterTemplate`/`requestApplyStarterTemplate` (and the `ConfirmDialog` step they used) are deleted — the wizard's own warning text replaces that confirmation.

**Tech Stack:** React 19, TypeScript, Vitest.

## Global Constraints

- Text-only parameterization — no style/color/font fields, no new templates, no procedural layout logic.
- Every block in every one of the 13 existing templates gets exactly one field (no curation of "primary" vs "secondary" blocks).
- No floating Arabic keyboard integration — plain `dir="rtl" lang="ar"` text inputs.
- `randomizeLayout` and its 🎲 button are untouched.
- After each task: run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, in that order, and fix anything that fails before moving on. Run `npm run build` at the end of the plan (Task 3).

---

### Task 1: Data model, `buildBlocksFromTemplate`, and tests

**Files:**
- Modify: `src/lib/templates.ts`
- Create: `src/lib/templates.test.ts`

**Interfaces:**
- Produces: `StarterTemplate.fields?: { blockIndex: number; label: string }[]` (new optional field on the existing type), `buildBlocksFromTemplate(template: StarterTemplate, values: string[]): Omit<TextBlock, "id">[]` — consumed by Task 3's `App.tsx` and referenced by Task 2's `TemplateWizardDialog.tsx` (which renders `template.fields` but does not itself call `buildBlocksFromTemplate` — that happens in `App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { STARTER_TEMPLATES, buildBlocksFromTemplate } from "./templates";

describe("STARTER_TEMPLATES fields", () => {
  it("every template has exactly one field per block", () => {
    for (const t of STARTER_TEMPLATES) {
      expect(t.fields, `${t.id} is missing fields`).toBeDefined();
      expect(t.fields!.length).toBe(t.blocks.length);
    }
  });

  it("every field's blockIndex is a valid, unique index into that template's blocks", () => {
    for (const t of STARTER_TEMPLATES) {
      const indices = t.fields!.map((f) => f.blockIndex).sort();
      expect(indices).toEqual(t.blocks.map((_, i) => i).sort());
    }
  });

  it("every field has a non-empty label", () => {
    for (const t of STARTER_TEMPLATES) {
      for (const f of t.fields!) {
        expect(f.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildBlocksFromTemplate", () => {
  const eidGreeting = STARTER_TEMPLATES.find((t) => t.id === "eid-greeting")!;
  const bismillah = STARTER_TEMPLATES.find((t) => t.id === "bismillah-card")!;

  it("reproduces the original blocks when every value matches the default", () => {
    const defaults = eidGreeting.fields!.map((f) => eidGreeting.blocks[f.blockIndex].text);
    const result = buildBlocksFromTemplate(eidGreeting, defaults);
    expect(result.map((b) => b.text)).toEqual(eidGreeting.blocks.map((b) => b.text));
  });

  it("applies an edited value to the correct block by index, leaving the other block untouched", () => {
    const result = buildBlocksFromTemplate(eidGreeting, ["عيد سعيد", "كل عام وأنتم بخير"]);
    expect(result[0].text).toBe("عيد سعيد");
    expect(result[1].text).toBe("كل عام وأنتم بخير");
  });

  it("falls back to the original text for a blank value", () => {
    const result = buildBlocksFromTemplate(eidGreeting, ["", "   "]);
    expect(result[0].text).toBe(eidGreeting.blocks[0].text);
    expect(result[1].text).toBe(eidGreeting.blocks[1].text);
  });

  it("does not mutate the original template", () => {
    const originalText = bismillah.blocks[0].text;
    buildBlocksFromTemplate(bismillah, ["something else entirely"]);
    expect(bismillah.blocks[0].text).toBe(originalText);
  });

  it("preserves every other block property (font, color, size, position) unchanged", () => {
    const result = buildBlocksFromTemplate(bismillah, ["new text"]);
    expect(result[0].fontFamily).toBe(bismillah.blocks[0].fontFamily);
    expect(result[0].color).toBe(bismillah.blocks[0].color);
    expect(result[0].fontSize).toBe(bismillah.blocks[0].fontSize);
    expect(result[0].x).toBe(bismillah.blocks[0].x);
    expect(result[0].y).toBe(bismillah.blocks[0].y);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/templates.test.ts`
Expected: FAIL — `fields` is undefined on every template, and `buildBlocksFromTemplate` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/lib/templates.ts` with:

```ts
import type { TextBlock } from "../types";

export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  backgroundColor: string;
  blocks: Omit<TextBlock, "id">[];
  /**
   * One entry per block that should be user-editable through the Template
   * Wizard (TemplateWizardDialog.tsx) — every block in every template
   * currently gets exactly one field (no "primary vs. secondary block"
   * curation), but this stays optional so a future template added without
   * field metadata falls back to Sidebar.tsx's plain one-click-apply path
   * instead of erroring.
   */
  fields?: { blockIndex: number; label: string }[];
};

const baseText: Omit<TextBlock, "id" | "text" | "x" | "y" | "fontSize" | "fontFamily" | "color"> = {
  type: "text",
  fontStyle: "normal",
  align: "center",
  lineHeight: 1.2,
  opacity: 1,
  stroke: "#000000",
  strokeWidth: 0,
  shadowColor: "#000000",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0.35,
  locked: false,
  rotation: 0,
};

// Block coordinates are centered on the world origin (0,0) — the canvas has
// no declared page size, so "reset view" fits/centers on whatever the
// template's blocks' combined bounding box turns out to be.
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "bismillah-card",
    label: "Bismillah Card",
    description: "Centered Bismillah in gold on a navy square.",
    backgroundColor: "#0d1526",
    fields: [{ blockIndex: 0, label: "Bismillah phrase" }],
    blocks: [
      {
        ...baseText,
        text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
        fontFamily: "FatemiMaqala",
        color: "#d4af37",
        fontSize: 110,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "eid-greeting",
    label: "Eid Greeting",
    description: "Large greeting with a subtitle line, sized for a story post.",
    backgroundColor: "#f2ead9",
    fields: [
      { blockIndex: 0, label: "Main greeting" },
      { blockIndex: 1, label: "Subtitle" },
    ],
    blocks: [
      {
        ...baseText,
        text: "عِيدكُم مُبارَك",
        fontFamily: "TahaNaskhRegular",
        color: "#a8791a",
        fontSize: 140,
        x: 0,
        y: -110,
      },
      {
        ...baseText,
        text: "كل عام وأنتم بخير",
        fontFamily: "Amiri",
        color: "#1a2340",
        fontSize: 60,
        x: 0,
        y: 110,
      },
    ],
  },
  {
    id: "name-monogram",
    label: "Name Monogram",
    description: "A single bold word, centered — good for names or short titles.",
    backgroundColor: "#ffffff",
    fields: [{ blockIndex: 0, label: "Name" }],
    blocks: [
      {
        ...baseText,
        text: "اسم",
        fontFamily: "Thuluth",
        color: "#1e3a5f",
        fontSize: 260,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "quote-card",
    label: "Quote Card",
    description: "A body line with a smaller attribution, sized for print (A4).",
    backgroundColor: "#faf5e8",
    fields: [
      { blockIndex: 0, label: "Main verse" },
      { blockIndex: 1, label: "Reference" },
    ],
    blocks: [
      {
        ...baseText,
        text: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
        fontFamily: "TahaNaskhRegular",
        color: "#1a2340",
        fontSize: 130,
        x: 0,
        y: -125,
      },
      {
        ...baseText,
        text: "سورة طه ١١٤",
        fontFamily: "Amiri",
        color: "#8a92a8",
        fontSize: 55,
        x: 0,
        y: 125,
      },
    ],
  },
  {
    id: "salawat-card",
    label: "Salawat Card",
    description: "An elegant Salawat phrase in gold on deep navy.",
    backgroundColor: "#15213a",
    fields: [{ blockIndex: 0, label: "Salawat phrase" }],
    blocks: [
      {
        ...baseText,
        text: "اللَّهُمَّ صَلِّ عَلَى مُحَمَّد",
        fontFamily: "AlFatemi",
        color: "#d4af37",
        fontSize: 90,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "ramadan-greeting",
    label: "Ramadan Greeting",
    description: "Festive Ramadan greeting in gold on deep purple.",
    backgroundColor: "#2a1a3d",
    fields: [{ blockIndex: 0, label: "Greeting" }],
    blocks: [
      {
        ...baseText,
        text: "رَمَضَان مُبَارَك",
        fontFamily: "ThuluthDeco",
        color: "#e8c766",
        fontSize: 170,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "mashaallah-tag",
    label: "MashaAllah Tag",
    description: "A small punchy phrase — good for stickers or badges.",
    backgroundColor: "#f5eeda",
    fields: [{ blockIndex: 0, label: "Phrase" }],
    blocks: [
      {
        ...baseText,
        text: "مَا شَاءَ اللّٰه",
        fontFamily: "Wessam",
        color: "#8b1e3f",
        fontSize: 130,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "alhamdulillah-tag",
    label: "Alhamdulillah Tag",
    description: "A single word of gratitude on a warm cream background.",
    backgroundColor: "#f5f1e0",
    fields: [{ blockIndex: 0, label: "Phrase" }],
    blocks: [
      {
        ...baseText,
        text: "الحَمْدُ لِلّٰهِ",
        fontFamily: "Qahiri",
        color: "#0f5c4a",
        fontSize: 140,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "jumuah-greeting",
    label: "Jumu'ah Greeting",
    description: "Friday greeting in gold on deep green, geometric Kufi style.",
    backgroundColor: "#1b3a2f",
    fields: [{ blockIndex: 0, label: "Greeting" }],
    blocks: [
      {
        ...baseText,
        text: "جُمُعَة مُبَارَكَة",
        fontFamily: "Kufi2",
        color: "#e8c766",
        fontSize: 120,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "wedding-blessing",
    label: "Wedding Blessing",
    description: "A blessing line with a smaller occasion subtitle, blush palette.",
    backgroundColor: "#f9ece9",
    fields: [
      { blockIndex: 0, label: "Blessing" },
      { blockIndex: 1, label: "Subtitle" },
    ],
    blocks: [
      {
        ...baseText,
        text: "بَارَكَ اللهُ لَكُمَا",
        fontFamily: "Scheherazade",
        color: "#9c3b53",
        fontSize: 100,
        x: 0,
        y: -100,
      },
      {
        ...baseText,
        text: "زَفَافٌ مُبَارَك",
        fontFamily: "Lateef",
        color: "#6b6b6b",
        fontSize: 55,
        x: 0,
        y: 100,
      },
    ],
  },
  {
    id: "newborn-mabrook",
    label: "Newborn Mabrook",
    description: "Congratulations on a new baby, soft blue palette.",
    backgroundColor: "#eaf3f7",
    fields: [
      { blockIndex: 0, label: "Main word" },
      { blockIndex: 1, label: "Subtitle" },
    ],
    blocks: [
      {
        ...baseText,
        text: "مَبْرُوك",
        fontFamily: "Ruqaa",
        color: "#2f6b8f",
        fontSize: 170,
        x: 0,
        y: -100,
      },
      {
        ...baseText,
        text: "مَوْلُودٌ جَدِيد",
        fontFamily: "Amiri",
        color: "#8a92a8",
        fontSize: 55,
        x: 0,
        y: 110,
      },
    ],
  },
  {
    id: "condolence-card",
    label: "Condolence Card",
    description: "A somber black-on-white card with the Quranic verse reference.",
    backgroundColor: "#ffffff",
    fields: [
      { blockIndex: 0, label: "Main phrase" },
      { blockIndex: 1, label: "Verse reference" },
    ],
    blocks: [
      {
        ...baseText,
        text: "إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُون",
        fontFamily: "Yekan",
        color: "#2b2b2b",
        fontSize: 75,
        x: 0,
        y: -90,
      },
      {
        ...baseText,
        text: "سُورَة البَقَرَة ١٥٦",
        fontFamily: "Amiri",
        color: "#8a8a8a",
        fontSize: 45,
        x: 0,
        y: 90,
      },
    ],
  },
  {
    id: "shukran-tag",
    label: "Shukran Tag",
    description: "A punchy thank-you word — good for stickers or cards.",
    backgroundColor: "#fff8e7",
    fields: [{ blockIndex: 0, label: "Phrase" }],
    blocks: [
      {
        ...baseText,
        text: "شُكْرًا",
        fontFamily: "Kufi",
        color: "#a8791a",
        fontSize: 170,
        x: 0,
        y: 0,
      },
    ],
  },
];

/**
 * Builds a template's blocks with each field's text substituted in, indexed
 * positionally against `template.fields` (values[i] corresponds to
 * template.fields[i], not directly to template.blocks[i] — a field's own
 * `blockIndex` says which block it targets). A blank/whitespace-only value
 * falls back to that block's original authored text, so a user can't
 * generate a block with empty text by accident. Every other block property
 * (font, color, size, position) is untouched. Does not mutate `template`.
 */
export function buildBlocksFromTemplate(
  template: StarterTemplate,
  values: string[]
): Omit<TextBlock, "id">[] {
  const blocks = template.blocks.map((b) => ({ ...b }));
  const fields = template.fields ?? [];
  fields.forEach((field, i) => {
    const value = values[i]?.trim();
    if (value) {
      blocks[field.blockIndex] = { ...blocks[field.blockIndex], text: value };
    }
  });
  return blocks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/templates.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green.

```bash
git add src/lib/templates.ts src/lib/templates.test.ts
git commit -m "Add per-template field metadata and buildBlocksFromTemplate"
```

---

### Task 2: `TemplateWizardDialog.tsx`

**Files:**
- Create: `src/components/TemplateWizardDialog.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `StarterTemplate` (Task 1, `src/lib/templates.ts`).
- Produces: `TemplateWizardDialogProps = { template: StarterTemplate; onGenerate: (values: string[]) => void; onCancel: () => void }` and the `TemplateWizardDialog` component, consumed by Task 3's `Sidebar.tsx`.

- [ ] **Step 1: Add CSS for the dialog**

In `src/index.css`, right after the existing `.imageTraceDialogConfirm:disabled { opacity: 0.5; cursor: not-allowed; }` line (added by the image-trace-shape-warp feature — if that line isn't present, add this block right after `.morphHelpBody h4:first-child { margin-top: 0; }` instead), add:

```css
.templateWizardDialog { width: min(420px, 100%); }
.templateWizardField { margin-bottom: 12px; }
.templateWizardField label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.templateWizardInput { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; direction: rtl; border: none; border-radius: 8px; background: var(--bg-input); color: var(--text-primary); }
.templateWizardInput:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.templateWizardWarning { font-size: 12px; color: var(--text-muted); margin: 4px 0 14px; }
```

- [ ] **Step 2: Create the component**

Create `src/components/TemplateWizardDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StarterTemplate } from "../lib/templates";

export type TemplateWizardDialogProps = {
  template: StarterTemplate;
  onGenerate: (values: string[]) => void;
  onCancel: () => void;
};

/**
 * Modal for the "Start from a Template" wizard flow: one RTL text field per
 * template field (StarterTemplate.fields), pre-filled with that block's
 * original text. Modeled on ConfirmDialog.tsx's portaled-overlay pattern.
 * Folds in the "this replaces the canvas" warning ConfirmDialog used to
 * show separately for templates — filling out this form is already a
 * deliberate multi-step action, so a second confirmation on top of
 * Generate would be redundant friction, not added safety.
 */
export const TemplateWizardDialog: React.FC<TemplateWizardDialogProps> = ({
  template,
  onGenerate,
  onCancel,
}) => {
  const fields = template.fields ?? [];
  const [values, setValues] = useState<string[]>(() =>
    fields.map((f) => template.blocks[f.blockIndex]?.text ?? "")
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirmDialog templateWizardDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="templateWizardDialogTitle"
      >
        <div id="templateWizardDialogTitle" className="confirmDialogTitle">
          {template.label}
        </div>
        <div className="confirmDialogMessage">{template.description}</div>

        {fields.map((field, i) => (
          <div className="templateWizardField" key={field.blockIndex}>
            <label htmlFor={`template-wizard-field-${field.blockIndex}`}>{field.label}</label>
            <input
              id={`template-wizard-field-${field.blockIndex}`}
              className="templateWizardInput"
              type="text"
              value={values[i] ?? ""}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                setValues(next);
              }}
              dir="rtl"
              lang="ar"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        ))}

        <div className="templateWizardWarning">
          This replaces every block currently on the canvas. Ctrl+Z will bring your design back if you change your mind.
        </div>

        <div className="confirmDialogActions">
          <button type="button" className="sidebarSmallAction" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="sidebarSmallAction"
            autoFocus
            onClick={() => onGenerate(values)}
          >
            Generate
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default TemplateWizardDialog;
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green. (No new tests in this task — this component has no unit tests, matching this project's existing convention for modal UI components; see `ConfirmDialog.tsx`, `ImageTraceDialog.tsx`.)

- [ ] **Step 4: Commit**

```bash
git add src/components/TemplateWizardDialog.tsx src/index.css
git commit -m "Add TemplateWizardDialog"
```

---

### Task 3: Wire into `Sidebar.tsx`/`App.tsx`, remove the old apply-as-is path, docs

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ConfirmDialog.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `TemplateWizardDialog` (Task 2); `buildBlocksFromTemplate` (Task 1).
- Produces: `Sidebar`'s new `onGenerateFromTemplate?: (templateId: string, values: string[]) => void` prop (replaces the old `onApplyTemplate` prop entirely — no other file references `onApplyTemplate` after this task).

- [ ] **Step 1: `Sidebar.tsx` — replace the `onApplyTemplate` prop and wire the dialog**

In `src/components/Sidebar.tsx`:

1. Add the import near the other component imports (after wherever `ImageTraceDialog` is imported, if present from the image-trace-shape-warp feature — otherwise near the other local component imports):

```ts
import { TemplateWizardDialog } from "./TemplateWizardDialog";
import type { StarterTemplate } from "../lib/templates";
```

2. In the `SidebarProps` type, replace:

```ts
  onApplyTemplate?: (templateId: string) => void;
```

with:

```ts
  onGenerateFromTemplate?: (templateId: string, values: string[]) => void;
```

3. In the destructured props, replace `onApplyTemplate,` with `onGenerateFromTemplate,`.

4. Add local dialog state near the component's other `useState` declarations:

```ts
  const [wizardTemplate, setWizardTemplate] = useState<StarterTemplate | null>(null);
```

5. Change the template button section (the `{onApplyTemplate && (...)}` block containing the `STARTER_TEMPLATES.map(...)` grid) — replace:

```tsx
        {onApplyTemplate && (
```

with:

```tsx
        {onGenerateFromTemplate && (
```

and inside that block, replace:

```tsx
                      onClick={() => onApplyTemplate(t.id)}
```

with:

```tsx
                      onClick={() => setWizardTemplate(t)}
```

6. Render the dialog — add this right after the closing of that `{onGenerateFromTemplate && (...)}` block (or anywhere else in the component's returned JSX; it portals to `document.body` so exact position doesn't affect layout):

```tsx
        {wizardTemplate && onGenerateFromTemplate && (
          <TemplateWizardDialog
            template={wizardTemplate}
            onCancel={() => setWizardTemplate(null)}
            onGenerate={(values) => {
              onGenerateFromTemplate(wizardTemplate.id, values);
              setWizardTemplate(null);
            }}
          />
        )}
```

- [ ] **Step 2: `App.tsx` — replace `applyStarterTemplate`/`requestApplyStarterTemplate` with `generateFromTemplate`**

In `src/App.tsx`:

1. Add `buildBlocksFromTemplate` to the existing templates import (find the line `import { STARTER_TEMPLATES } from "./lib/templates";` and change it to):

```ts
import { STARTER_TEMPLATES, buildBlocksFromTemplate } from "./lib/templates";
```

2. Replace the two functions `applyStarterTemplate` and `requestApplyStarterTemplate` (search for `const applyStarterTemplate = (templateId: string) => {` — the two functions and the blank line between them) with a single function:

```ts
  const generateFromTemplate = (templateId: string, values: string[]) => {
    const template = STARTER_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    pushHistory();
    const templateBlocks = buildBlocksFromTemplate(template, values);
    const newBlocks: Block[] = templateBlocks.map((b) => ({ ...b, id: createNextId() }));
    setBlocks(newBlocks);
    setBackgroundColor(template.backgroundColor);
    setShowGrid(false);
    setSelectedIds([]);
    setSelectedId(newBlocks[0]?.id ?? null);
    setTimeout(() => resetView(newBlocks), 0);
  };
```

3. Find where `<Sidebar` is invoked with `onApplyTemplate={requestApplyStarterTemplate}` and change it to:

```tsx
        onGenerateFromTemplate={generateFromTemplate}
```

4. Double-check (grep) that nothing else in `App.tsx` references `applyStarterTemplate`, `requestApplyStarterTemplate`, or `onApplyTemplate` — there shouldn't be, but confirm before moving on.

- [ ] **Step 3: Update `ConfirmDialog.tsx`'s stale comment**

In `src/components/ConfirmDialog.tsx`, the doc comment currently reads:

```ts
/**
 * Portaled confirmation modal for actions that can't be undone with Ctrl+Z
 * (or that are easy to trigger by accident and expensive to redo by hand) —
 * see App.tsx's requestDeleteNamedProject / requestApplyStarterTemplate.
 * Not used for ordinary block/layer delete, which stays a single click
 * since it's a frequent, undo-covered action; those just get danger styling.
 */
```

Change it to:

```ts
/**
 * Portaled confirmation modal for actions that can't be undone with Ctrl+Z
 * (or that are easy to trigger by accident and expensive to redo by hand) —
 * see App.tsx's requestDeleteNamedProject.
 * Not used for ordinary block/layer delete, which stays a single click
 * since it's a frequent, undo-covered action; those just get danger styling.
 * Template application (Sidebar.tsx's "Start from a Template") used to go
 * through this dialog too, but TemplateWizardDialog.tsx now folds that
 * same warning into its own Generate step instead.
 */
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, open the app. In the sidebar, open "Start from a Template", click a two-field template (e.g. "Eid Greeting"). Confirm: a modal opens showing both fields pre-filled with the template's original Arabic text, RTL-aligned; edit one field; click Generate; confirm the canvas is replaced with the template's layout but the edited field's text appears in the right block, and the other block keeps its original text; confirm Ctrl+Z restores whatever was on the canvas before. Then open a single-field template (e.g. "Name Monogram"), clear its field entirely, click Generate, and confirm the block falls back to the original "اسم" text rather than being blank. Finally confirm Escape and the Cancel button both close the dialog with no change to the canvas.

- [ ] **Step 6: Update `CLAUDE.md`**

In the "Sidebar structure" section of `CLAUDE.md`, find the paragraph describing `Sidebar.tsx` (the one listing "Styling, Align & Arrange, Shape Fill/Warp controls, Save/Export, Canvas Size, Arabic Helpers/Presets"). Add a new paragraph right after that section's existing content (or after the most relevant existing paragraph if the section has grown since this plan was written — use judgment to keep it near related content):

```markdown
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
```

- [ ] **Step 7: Full verification loop**

Run, in order:

```bash
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test
npm run build
```

Expected: all four succeed.

- [ ] **Step 8: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx src/components/ConfirmDialog.tsx CLAUDE.md
git commit -m "Wire Template Wizard into Sidebar/App, remove one-click apply path"
```
