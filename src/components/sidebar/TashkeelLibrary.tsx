import { useEffect, useState } from "react";
import { loadFont } from "../../lib/harfbuzz";
import { resolveFontUrl } from "../../hooks/useShapedGlyphs";
import { tashkeelGroupsFor, type GlyphLookup, type TashkeelGroup } from "../../lib/tashkeelLibrary";

const ROW = 6;

const chunk = <T,>(items: T[]): T[][] => {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += ROW) rows.push(items.slice(i, i + ROW));
  return rows;
};

/**
 * Every tashkeel mark the block's font can draw, in groups. The basic marks
 * stay open; the rest fold away. Buttons preview in the block's own font, so
 * a font that redraws a mark (Thuluth's decorated shadda pairs) shows its own
 * shape here. See .claude/rules/tashkeel-library.md.
 */
export function TashkeelLibrary({
  fontKey,
  cssFamily,
  onPick,
}: {
  fontKey: string;
  cssFamily: string;
  onPick: (text: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; font: GlyphLookup | null } | null>(null);

  useEffect(() => {
    let live = true;
    loadFont(resolveFontUrl(fontKey))
      .then((font) => live && setLoaded({ key: fontKey, font }))
      .catch(() => live && setLoaded({ key: fontKey, font: null }));
    return () => {
      live = false;
    };
  }, [fontKey]);

  // Until this font's coverage is known, offer everything rather than flash
  // an empty library; `tashkeelGroupsFor(null)` returns the full set.
  const font = loaded?.key === fontKey ? loaded.font : null;
  const groups = tashkeelGroupsFor(font, fontKey);

  const keys = (g: TashkeelGroup, large: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {g.note && <div className="sidebarTashkeelNote">{g.note}</div>}
      {chunk(g.items).map((row, ri) => (
        <div key={ri} className="sidebarPresetKeyboardRow">
          {row.map((it) => (
            <button
              key={it.text}
              type="button"
              onClick={() => onPick(it.text)}
              title={it.name}
              aria-label={it.name}
              className={
                large
                  ? "sidebarPresetKeyboardKey sidebarPresetKeyboardKeyLarge"
                  : "sidebarPresetKeyboardKey sidebarTashkeelKey"
              }
              style={{ fontFamily: cssFamily }}
              dir="rtl"
              lang="ar"
            >
              {it.display ?? it.text}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  if (groups.length === 0) {
    return (
      <div className="sidebarPresetKeyboard" data-tashkeel-library>
        <div className="sidebarTashkeelNote">
          This font has no tashkeel marks.
        </div>
      </div>
    );
  }

  const [first, ...rest] = groups;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-tashkeel-library>
      <div className="sidebarPresetKeyboard" data-tashkeel-group={first.id}>
        <div className="sidebarPresetKeyboardTitle">{first.title}</div>
        {keys(first, first.id === "basic")}
      </div>
      {rest.map((g) => (
        <details key={g.id} className="sidebarPresetKeyboard" data-tashkeel-group={g.id}>
          <summary className="sidebarPresetKeyboardTitle sidebarPresetKeyboardSummary">{g.title}</summary>
          {keys(g, false)}
        </details>
      ))}
    </div>
  );
}
