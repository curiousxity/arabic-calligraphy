import type * as opentype from "opentype.js";
import { sameChoice, type AlternateChoice, type AlternateOption } from "../../lib/glyphAlternates";

type Props = {
  font: opentype.Font;
  unitsPerEm: number;
  options: AlternateOption[];
  current: AlternateChoice | null;
  onPick: (choice: AlternateChoice | null) => void;
};

/** One thumbnail per shape the selected letter can take, default first. */
export function AlternateStrip({ font, unitsPerEm, options, current, onPick }: Props) {
  return (
    <div
      data-alternate-strip
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, marginTop: 8 }}
    >
      {options.map((o) => {
        const path = font.glyphs.get(o.glyphId)?.getPath(0, 0, unitsPerEm);
        const bb = path?.getBoundingBox();
        const pad = unitsPerEm * 0.08;
        const viewBox =
          bb && isFinite(bb.x1)
            ? `${bb.x1 - pad} ${bb.y1 - pad} ${bb.x2 - bb.x1 + pad * 2} ${bb.y2 - bb.y1 + pad * 2}`
            : `0 0 ${unitsPerEm} ${unitsPerEm}`;
        const pressed = sameChoice(o.choice, current);
        return (
          <button
            key={o.choice ? `${o.choice.feature}=${o.choice.value}` : "default"}
            type="button"
            aria-label={o.label}
            aria-pressed={pressed}
            title={o.label}
            onClick={() => onPick(o.choice)}
            className="sidebarSmallAction"
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: 4,
              background: pressed ? "var(--accent-soft, var(--bg-input))" : "var(--bg-input)",
              outline: pressed ? "2px solid var(--accent)" : undefined,
            }}
          >
            <svg viewBox={viewBox} width="100%" height={36} aria-hidden="true">
              <path d={path?.toPathData(2) ?? ""} fill="currentColor" />
            </svg>
            <span style={{ fontSize: 10, lineHeight: 1.1, textAlign: "center", overflowWrap: "break-word" }}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
