# Font tooling

Offline scripts for adding and evaluating fonts. Python, not part of the
app build — nothing in `src/` imports them.

```bash
python3 -m venv .venv && ./.venv/bin/pip install fonttools
# only for renderFontSample.py:
./.venv/bin/pip install uharfbuzz matplotlib
```

## Adding a font — the whole checklist

A font must be registered in **five** places or it half-works in ways that
fail quietly. See CLAUDE.md's "Font files carry custom glyphs" section.

1. the file in `public/fonts/`
2. an `@font-face` rule at the top of `src/index.css`
3. `FONT_OPTIONS` in `src/components/Sidebar.tsx` — controls the picker
4. `FONT_URLS` in `src/hooks/useShapedGlyphs.ts` — what HarfBuzz shapes with
5. `NUQTA_EM_RATIO` in `src/lib/nuqta.ts` — the font's measured nuqta as a
   dot/em ratio, from `measureNuqta.py` below

Step 5 is unlike the others in two ways. The value must be **measured**, not
picked — there is no formula, and the obvious rule (the alif's stem is one
nuqta) fails across this library by a factor of 3. And leaving it out is a
*legitimate* choice: absence is how a font is declared out of scope for
per-stroke editing, which is why `Ruqaa` and `HarfCanvasDiwani` are absent.
Just do it deliberately — a font missing from the table looks completely
normal but silently has no nuqta snapping and no join pinning.

Then merge the honorific PUA glyphs:

```bash
./.venv/bin/python scripts/mergePuaGlyphs.py \
    public/fonts/NewFont.ttf public/fonts/NewFont.ttf
```

**If the font is OFL with a Reserved Font Name**, merging makes it a
Modified Version and it must be renamed:

```bash
./.venv/bin/python scripts/mergePuaGlyphs.py \
    incoming/TheirFont.ttf public/fonts/OurName.ttf --rename OurName
```

Keep the upstream licence beside it as `public/fonts/OurName-OFL.txt`,
including a note on what was modified. `HarfCanvasDiwani-OFL.txt` is the
worked example.

### Why the merge script parses `presets.ts`

The honorific codepoints are **ten** glyphs, not eight, and not a contiguous
range: `E833`–`E839`, `E840`, `E841`, `E842`, with `E83A`–`E83F` unused.
A hardcoded `range(0xE833, 0xE841)` has already shipped a bug by dropping
the last two, whose only symptom was the final two Presets buttons
rendering as empty boxes. `mergePuaGlyphs.py` therefore reads the list from
`src/lib/presets.ts` and follows it automatically.

## Checking a font before adopting it

```bash
./.venv/bin/python scripts/measureNuqta.py
./.venv/bin/python scripts/renderFontSample.py public/fonts/X.ttf out.png "بسم الله"
```

Worth checking on any candidate:

- **Arabic cmap coverage.** A font mapping zero codepoints in `U+0600`–`06FF`
  is a legacy 8-bit "Arabic on Latin byte positions" file and cannot be
  shaped by HarfBuzz at all. The deleted `Diwani.ttf` was one of these.
- **All four joining features** (`isol`/`init`/`medi`/`fina`) in GSUB, or
  letters will not connect.
- **A GPOS table.** Without one, mark positioning falls back to advances and
  the diacritic-detection fallback in `lib/diacritics.ts` — which keys on
  nonzero GPOS `dx`/`dy` — cannot fire.
- **PUA collisions** in the honorific range, common in FontForge-built fonts
  that auto-assign PUA codepoints to contextual variants. Overwriting those
  cmap entries is safe (GSUB references glyph names), but check deliberately.

## Scripts

| script | purpose |
|---|---|
| `mergePuaGlyphs.py` | copy the honorific PUA glyphs into a font; optional OFL rename |
| `measureNuqta.py` | measure each font's nuqta two independent ways |
| `renderFontSample.py` | shape real Arabic with HarfBuzz and rasterize, to eyeball a face |

`measureNuqta.py` exists because the nuqta must be measured per font — the
intuitive rule that the alif's stem is one nuqta wide does not hold here
(`alif/dot` ranges ~0.53 to ~1.68 across `public/fonts/`). See the
per-stroke-editing design doc under `docs/superpowers/specs/`.

`deriveStrokeSpines.py` additionally needs numpy, Pillow, scikit-image and
scipy:

    pip install fonttools numpy Pillow scikit-image scipy

These are offline tooling only — nothing here ships to the browser.
