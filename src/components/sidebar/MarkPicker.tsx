import type { MarkItem } from "../../lib/markLibrary";
import { useMarkGroups } from "../../hooks/useMarkGroups";

/**
 * The mark library as a grid of preview buttons, one fold per group. Used by
 * the Marks panel (click adds a mark) and the Mark panel (click swaps the
 * selected mark's shape). See .claude/rules/marks.md.
 */
export function MarkPicker({
  onPick,
  currentId,
}: {
  onPick: (item: MarkItem) => void;
  /** Highlights the selected mark's own shape. */
  currentId?: string;
}) {
  // Mounting the picker (opening the Marks panel, or selecting a mark) is what loads the library.
  const groups = useMarkGroups();
  if (!groups) return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading marks…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {groups.map((g) => (
        <details key={g.id} className="sidebarMarkGroup" open={g.items.some((it) => it.id === currentId)}>
          <summary>{g.title}</summary>
          <div className="sidebarMarkGrid">
            {g.items.map((it) => {
              // Square viewBox around the centred outline, padded a little.
              const half = Math.max(it.w, it.h) / 2 + 20;
              return (
                <button
                  key={it.id}
                  type="button"
                  className={
                    "sidebarMarkKey" + (it.id === currentId ? " sidebarPresetKeyboardKeyActive" : "")
                  }
                  title={it.name}
                  aria-label={it.name}
                  onClick={() => onPick(it)}
                >
                  <svg viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`} aria-hidden="true">
                    <path d={it.d} fill="currentColor" />
                  </svg>
                </button>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
