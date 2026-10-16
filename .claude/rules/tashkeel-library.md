---
paths:
  - "src/lib/tashkeelLibrary*.ts"
  - "src/components/sidebar/TashkeelLibrary.tsx"
---

# Tashkeel library (`lib/tashkeelLibrary.ts`, `sidebar/TashkeelLibrary.tsx`)

The Content panel's mark picker. It replaced the nine-key إعراب
`PresetKeyboard` row on 2026-10-16.

**Groups.** `BASIC_GROUP` (the nine everyday marks, always first and open),
then the font's extras if it has any, then `MORE_GROUPS`: shadda
combinations, hamza & madda, Quranic marks, stop signs (waqf), honorific
signs. Every standard item is a plain Unicode string inserted at the caret
through the Sidebar's `handleKeyboardKey`, the same path as every other
keyboard row. There is no new block field and nothing to save.

**Filtering is by cmap.** `tashkeelGroupsFor(font, fontKey)` keeps an item
only if `font.charToGlyphIndex` is nonzero for every character, and drops a
group left empty (Qahiri and Rana Kufi lose the basic row entirely). The
component loads the font through `harfbuzz.ts`'s `loadFont`, which shares
shaping's parsed-font cache, so asking costs one fetch at most. Until it
resolves, `font` is `null` and everything is offered: hiding the whole
library for a frame reads as a bug, and a missing mark is dropped before
shaping anyway (`stripUnsupportedDiacritics`). The module is pure, with no
harfbuzz import, so its tests load real fonts with opentype.js alone.

**Every standard mark must match `ARABIC_DIACRITIC_RE`** (a test enforces
it). One outside it would escape both `stripUnsupportedDiacritics` and the
per-instance diacritic handles. That is why the open tanween (U+08F0–08F2)
and the spacing small waw/yeh (U+06E5/06E6) are not offered.

**Buttons preview in the block's own font** (`cssFamily` from
`fontChoices`), each mark on a tatweel. That is the "font-specific" half
most fonts actually have: Thuluth and Thuluth Deco draw every haraka and
shadda pair with their own decorated Private Use Area glyphs, but they reach
them through GSUB from the ordinary characters. Typing فتحة already gets
the decorated shape, and the button shows it.

## Font extras: why there are so few

`FONT_EXTRAS` maps a font key to a group of **typed** PUA characters. On
2026-10-16 every bundled font's PUA glyphs were checked (beyond the ten
honorifics, which are the Presets row), and almost none qualify:

- **A PUA character is non-joining to HarfBuzz.** Typed between two letters,
  it breaks the join on both sides: `ب\uE008ب` in Thuluth shapes as two
  isolated behs. It also gets no mark positioning (Thuluth's E008 even
  carries a 500-unit advance). So a mid-word mark can never be a typed PUA
  character.
- **Thuluth / Thuluth Deco** E008–E016: all reachable from ordinary marks
  and shadda pairs through the font's GSUB (see above), so they need no
  extras entry.
- **Layla Diwani** (retired) "low" marks E820–E82D: not reachable, and
  typing them breaks joins. Not offered.
- **Rabat / Layla Diwani** E818 (shadda with fathatan): reached by typing
  shadda + fathatan.
- **Taha Naskh** F00A–F026 (checkboxes, fractions), **Al Fatemi**, **Yekan**
  (277 unencoded letter forms), the honorific *words* in Jameel Noori and
  Lateef's corner marks: not tashkeel.
- **Jameel Noori** E000 (رضی) and E002 (رح) are the exception. They are
  honorifics that follow a name, so at the end of a word there is no join
  left to break, and the font's GPOS attaches them. These two are the only
  entries, and the group's note says "end of a word". A test shapes علی with
  each and checks the letters are unchanged.

Adding an entry: check with real HarfBuzz that it keeps its neighbours'
forms where it will be typed, then add a test. The catalogue test already
checks that each key is a real `FONT_OPTIONS` value and that the file maps
every codepoint.
