import { useMemo, useState } from "react";
import { useStudioLibrary } from "../../hooks/useStudioLibrary";
import { polygonsPath, shapeInk, studioGroups, type StudioLibrary } from "../../lib/studioStrokes";
import type { Polygon } from "../../lib/penSweep";

/**
 * The studio's letters as recreated with the pen, to browse: one fold per letter, each shape a thumbnail; clicking
 * one shows it large with its strokes told apart and how each was written. View only. See
 * .claude/rules/studio-strokes.md.
 */

type Drawn = { box: [number, number, number, number]; strokes: { id: string; recipe: string; iou?: number; d: string }[] };

// A shape's ink takes a few milliseconds a stroke to sweep: each is drawn once, when first shown.
const drawn = new Map<string, Drawn>();
function drawShape(lib: StudioLibrary, id: string): Drawn {
  let out = drawn.get(id);
  if (out) return out;
  const inks = shapeInk(lib, id);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of inks) for (const poly of s.ink as Polygon[]) for (const [x, y] of poly[0]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  out = { box: [x0, y0, x1, y1], strokes: inks.map((s) => ({ id: s.id, recipe: s.recipe, iou: s.iou, d: polygonsPath(s.ink) })) };
  drawn.set(id, out);
  return out;
}

const viewBox = ({ box: [x0, y0, x1, y1] }: Drawn, pad: number) => {
  const w = x1 - x0, h = y1 - y0, half = Math.max(w, h) / 2 + pad;
  return `${(x0 + x1) / 2 - half} ${(y0 + y1) / 2 - half} ${half * 2} ${half * 2}`;
};

const RECIPE: Record<string, string> = { pen: "one nib angle", turning: "turning pen", fill: "nib tip", split: "in pieces" };

function Thumb({ lib, id, active, onPick }: { lib: StudioLibrary; id: string; active: boolean; onPick: () => void }) {
  const d = drawShape(lib, id);
  const s = lib.shapes[id];
  const name = `${s.group}, ${s.form} ${s.variant}${s.pairOf ? ` (pair ${s.pairOf})` : ""}`;
  return (
    <button type="button" className={"sidebarMarkKey" + (active ? " sidebarPresetKeyboardKeyActive" : "")} title={name} aria-label={name} onClick={onPick}>
      <svg viewBox={viewBox(d, 12)} aria-hidden="true">
        <path d={d.strokes.map((st) => st.d).join("")} fill="currentColor" fillRule="nonzero" />
      </svg>
    </button>
  );
}

function Letter({ lib, group, shapes, current, onPick }: { lib: StudioLibrary; group: string; shapes: string[]; current: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="sidebarMarkGroup" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{group} <span style={{ color: "var(--text-muted)" }}>· {shapes.length}</span></summary>
      {open && (
        <div className="sidebarMarkGrid">
          {shapes.map((id) => <Thumb key={id} lib={lib} id={id} active={id === current} onPick={() => onPick(id)} />)}
        </div>
      )}
    </details>
  );
}

// Two inks a little apart, so neighbouring strokes read as separate pen strokes.
const TINTS = ["var(--key-text)", "var(--accent)"];

function Large({ lib, id }: { lib: StudioLibrary; id: string }) {
  const d = drawShape(lib, id);
  const s = lib.shapes[id];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, border: "1px solid var(--border-soft)", borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {s.group} · {s.form} {s.variant}{s.pairOf ? ` · half of pair ${s.pairOf}` : ""} <span style={{ color: "var(--text-muted)" }}>({id})</span>
      </div>
      <svg viewBox={viewBox(d, 16)} style={{ width: "100%", aspectRatio: "1", background: "var(--key-bg)", borderRadius: 6 }} aria-label={`${s.group} ${s.form}`}>
        {d.strokes.map((st, i) => <path key={st.id} d={st.d} fill={TINTS[i % TINTS.length]} fillOpacity={0.88} />)}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "2px 8px", fontSize: 11, color: "var(--text-muted)" }}>
        {d.strokes.map((st, i) => (
          <div key={st.id} style={{ display: "contents" }}>
            <span style={{ color: TINTS[i % TINTS.length] }}>■ {st.id}</span>
            <span>{RECIPE[st.recipe] ?? st.recipe}</span>
            <span>{st.iou != null ? `${Math.round(st.iou * 1000) / 10}%` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudioLettersPanel() {
  const lib = useStudioLibrary();
  const groups = useMemo(() => (lib ? studioGroups(lib) : []), [lib]);
  const [current, setCurrent] = useState<string | null>(null);
  if (!lib) return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading letters…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {current && lib.shapes[current] && <Large lib={lib} id={current} />}
      {groups.map((g) => <Letter key={g.group} lib={lib} group={g.group} shapes={g.shapes} current={current} onPick={setCurrent} />)}
    </div>
  );
}
