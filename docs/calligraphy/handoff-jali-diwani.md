# Handoff: starting the Jali Diwani branch

Written 2026-10-19 by the Claude session working on Thuluth (branch
`claude/curve-diacritics`), for a new Claude Code session that will do the same
work for **Jali Diwani**. Read all of it before doing anything.

## What you are building

HarfCanvas is a browser calligraphy design tool (see `CLAUDE.md`). For the
stacked compositions (tarkib), the user wants letters **drawn with a pen,
stroke by stroke**, not taken from a font, so that joins flow "like one
continuous pen movement". Plain text keeps using fonts.

On the Thuluth branch, that meant:

- research into how the script is written: the pen, the nib angle, the
  proportions, the stroke order;
- finding vector references from the masters' tradition;
- fitting each reference stroke with a simulated broad nib, then checking the
  fit by eye against the reference;
- recording every method and measurement in a ledger;
- scaling up to a catalogue of every letter, form and variant, fitted on the
  user's GPU computer.

Your job is the same for **Jali Diwani**: in the end, a ledger and a full set
of vectorized pen strokes for every letter and every variant, matched to
references the user accepts.

Thuluth is far along and the results are good. Reuse its tools and lessons.
Don't assume its measurements carry over: Jali Diwani is a different script,
with a different pen, proportions, joins and composition.

## Set up first: your own branch, in your own folder

Another Claude session is working in
`C:\Users\mezud\OneDrive\Desktop\arabic-calligraphy` on
`claude/curve-diacritics`, and it runs background jobs from that folder.

- **Never run `git checkout`, `git switch`, `git stash`, `git reset` or
  `git clean` in that folder.** It would pull the files out from under the
  other session.
- Make a separate worktree on a new branch, cut from the Thuluth branch. The
  pen tooling exists only there; `main` is about 240 commits behind and
  doesn't have it:

  ```
  git worktree add ../arabic-calligraphy-diwani -b claude/jali-diwani claude/curve-diacritics
  cd ../arabic-calligraphy-diwani && npm install
  ```

  Claude Code's `EnterWorktree` is fine too, as long as the branch starts
  from `claude/curve-diacritics`.
- **Never merge to `main`** unless the user tells you to. Don't merge or
  rebase the Thuluth branch either.
- Your memory folder follows your working folder, so a worktree starts with
  empty memory. Read the Thuluth project's memory directly:
  `C:\Users\mezud\.claude\projects\C--Users-mezud-OneDrive-Desktop-arabic-calligraphy\memory\`.
  Start with `MEMORY.md`. The ones that matter most:
  - `reference_compute_hardware.md`
  - `feedback_accuracy_over_time.md`
  - `feedback_calligraphy_ledger.md`
  - `feedback_check_renders_before_review.md`
  - `feedback_thuluth_tarkib_rules.md`
  - `project_drawn_letters_scope.md`
  - `reference_thuluth_shorthand.md`

## Read these, in this order

1. `CLAUDE.md`: architecture, commands, and the docs rules (which document
   holds what).
2. `docs/calligraphy/stroke-ledger.md`, the whole of it. The sections "How to
   draw a stroke" and "Traps found the hard way" took a day of the user's
   rejections to learn. Most of them hold for any broad-nib script.
3. `scripts/pen/REVIEW.md`: how approval is recorded. Only the user's word
   approves a form.
4. `docs/superpowers/specs/2026-10-19-stroke-tarkib-design.md` and
   `docs/superpowers/specs/2026-10-19-stroke-tarkib-research.md`: the design,
   and how the Thuluth research was done and labelled ([A] a source states
   it, [I] our inference). Do your research the same way.
5. `docs/calligraphy/studio-catalogue.md` and the "The studio catalogue"
   section of the ledger: how the catalogue was fitted at scale and judged.

## The user's standing rules (they apply to you too)

- **Plain language** in replies. The user is a calligraphy-literate designer
  and judges by eye; they are not a programmer.
- **The app never credits or attributes work to any calligrapher**, and never
  to the user's grandfather. Masters and books are research references only.
  No reference outline is copied into the library as its own ink. The one
  exception is a "fill" mark (below), and only stroke by stroke, as the user
  says.
- **Nothing enters the library without the user's approval.** For Thuluth,
  the user delegated this: when a form matches the reference "within reason",
  save a labelled side-by-side picture, record it in the ledger, and move on;
  the user checks from time to time. Ask before assuming the same holds for
  Jali Diwani.
- **No browser testing of the app by Claude.** The user tests it.
- **Ask before downloading** anything: name the file, where it is from and
  how big. Book scans and crops stay local and are never committed.
- **Scale to 0.1 nuqta**, not whole nuqtas. The real unit is the pen.
- **Accuracy over time.** Use tight fitting settings. Judge a fit by its worst
  local miss (`gap_max`) as well as its overlap, and never loosen settings to
  save time without asking.
- **Check your own renders before showing the user.** Look at starts, ends and
  joins at 3–4× size against the reference. Any notch, spike, step or kink is
  a defect.
- **Record methods in a ledger.** Use a new
  `docs/calligraphy/jali-diwani-ledger.md` modelled on the Thuluth one (that
  one is Thuluth's).
- **Shorthand the user uses** when reviewing:
  - forms: `!` standalone, `@` starting, `#` middle, `$` finishing;
  - `*1`–`*3` for alternates;
  - parts of a letter: `(` head, `)` body, `=` tail.
- **Commit trailer:** use the attribution lines your session's system
  reminder gives you.

## What Thuluth taught us (the short version)

The details are in the ledger.

1. **A letter is several overlapping pen pieces, not one stroke.** Each piece
   has its own nib angle, and the later piece hides the seam. Chaining pieces
   into one stroke pinches the ink to a hair wherever the angle swings.
   Split the reference into its pieces first; with a vector reference, each
   closed outline is usually one piece.
2. **The pen is the unit.** Measure each reference's own pen width; on Thuluth,
   assuming one width made letters 7–13% wrong. Library nuqta = 1.65 pens for
   Thuluth. **Find Jali Diwani's own ratio.**
3. **The nib angle comes from the band's width:** θ = φ ± asin(w / pen), with
   φ the direction of travel. Unwrap it by 180° so the nib never spins.
4. **Stamps and wedges are pulls, not bands.** Heads, hats and flags are the
   nib set down and pulled a short way. Read them from their corners.
5. **Overlap can't see a hairline.** Weigh the outline gap too: `edge` in the
   fitter, tight by default.
6. **Some marks are not nib strokes.** The calligrapher makes a mark, then
   fills in the shape with a fine pen. The user named the alif's hat and the
   jim's starting mark. Measuring width against the nib found neither, so
   **ask the user** which marks are fills. Jali Diwani's ornamental fillers
   may well be fills; find out early.
7. **Joins were our weakest point.**
   - Fitting each stroke alone against its own piece pulls every end back from
     the corner where it meets its neighbour, which leaves a notch.
   - The fix (2026-10-19, results still coming in): fit each stroke with its
     neighbours' ground counted neither for nor against it. That is the
     `ignore` option in `fitjob.py`, `gpufit.refine` and `pieces.refine`.
   - Check the ledger's "Joins" section and the Thuluth session's latest
     commits for how it turned out.
8. **Draw both sides of a comparison the same way.** Both at 4×, scaled down
   with area averaging. The user noticed when ours looked stepped and the
   reference's smooth.
9. **Never show blank cells.** A stroke not fitted yet is drawn pale grey and
   labelled.

## Jali Diwani: what to research

Write `docs/superpowers/specs/<date>-jali-diwani-research.md`, with every
claim labelled [A] (a source states it, with the source) or [I] (our
inference).

The Thuluth session's own picture of the script, **to verify, not to trust**:

- Diwani is the Ottoman chancery script.
- Jali Diwani is its large, dense, ornamental form:
  - words overlap and stack;
  - empty space is filled with small dots and marks;
  - lines often rise toward the left;
  - text is set in a tight block or boat-like shape.

Questions to answer, with sources:

- **The pen:** cut width, nib angle, how it is held and turned, whether
  corners are lifted (on Thuluth, lifting a corner was the attested way to
  end a stroke thin).
- **Proportions:** the nuqta measures of each letter and of the gaps.
- **Letter forms:** each letter's forms and variants, and how many there are.
- **Stroke order and moves** for each letter, and how letters join and pass
  under or over each other.
- **The filler marks:** which ones, where they go, and whether each is written
  with the nib or made and filled.
- **Composition rules:** baseline slope, stacking, how a block is built.
  These matter later, when compositions are laid out.

## Finding references from the masters

- **Ask the user first** what they own or use: books, practice sheets
  (meşk), a studio or app. For Thuluth they had the Turkish Ministry of
  Education "Hüsn-i Hat Atölyesi" books and an online studio
  (mqacademy.app), which gave clean vector outlines split into strokes.
- **Prefer vector references.** A PDF that stores letters as vector drawings,
  or a web studio's SVG paths, gives exact piece outlines. Raster plates are a
  fallback; `scripts/pen/fit.py` fits a path to one.
- **Search terms:**
  - Turkish: "Celî Dîvânî", "Dîvânî hat", "meşk", "hurufat";
  - Arabic: "الخط الديواني الجلي", "كراسة الخط الديواني";
  - English: "Jali Diwani", "Diwani Jali".
  - Check whether the same Ministry of Education book series has a Divani or
    Celi Divani volume.
  - Check whether mqacademy.app has a Diwani studio (the user's Chrome
    session can reach it).
- **Get the user's yes before downloading.** Keep downloads in their own
  folders and read them with `python -I`.

## The tools you inherit (`scripts/pen/`)

- `ribbon.py`: centre line, width and nib angle of a swept stroke from its
  vector outline.
- `pieces.py`: scores our ink against reference pieces (overlap and outline
  gap); `refine`, `fit_pull`, `trim_ends`, `skeleton_samples`.
- `gpufit.py`: the same refine on a CUDA GPU (used on Geekmini).
- `fitjob.py`: fits one stroke as a self-contained job. It tries a band, a
  skeleton read and a pull, and keeps the best. Defaults are spacing 0.3 and
  edge 3; option `ignore` is the join fix.
- `fitqueue.py`: the folder job queue on the NAS (see below).
- `build.py`, `spec.json`, `ink.mjs`, `sidebyside.py`, `overlay.py`,
  `preview.mjs`: the hand-authored library, its build into
  `src/lib/penData/`, and the comparison pictures.
- **App side:** `src/lib/penSweep.ts` (the sweep), `penLibrary.ts`,
  `penJoin.ts`, `penLayout.ts`, `penFit.ts`, `penPreview.ts`.
  - The library is keyed by forms like `alif.standalone.1` and has no notion
    of which script a form belongs to.
  - **Agree with the user how Jali Diwani forms sit beside Thuluth's before
    you change these files.** Don't change Thuluth's forms or data.

The catalogue scripts (turning the studio's library into jobs, sheets and
second passes) were never moved into the repo. They live in the Thuluth
session's scratchpad:

`C:\Users\mezud\AppData\Local\Temp\claude\C--Users-mezud-OneDrive-Desktop-arabic-calligraphy\1e0e7fb4-3a74-4cf5-ace4-79537f69b643\scratchpad\studio\`

The main ones:

- `catalog.py`: reference → jobs, with stroke dedupe by outline hash;
- `submit.py`;
- `sheet.py`: labelled side-by-side sheets, scores, fills, grey waiting
  strokes;
- `repass.py`: second passes;
- `fixes.py` and `fixes.json`: the user's fixes, refit or fill;
- `sheets_loop.py`;
- `widths.py`.

They are written for that studio's data format. Copy what you need into your
own branch (for example `scripts/pen/diwani/`) and adapt it. Don't edit them
in place: the other session runs them.

## Computers, and sharing them with the Thuluth run

Read `reference_compute_hardware.md` in the memory folder. In short:

- **Laptop** (where you run): reading, checking and committing only. The user
  asked that it not run fitting jobs.
- **Geekmini:**
  - RTX 4070, 32 GB of RAM;
  - the user runs one worker there by hand
    (`start-worker.bat` in the queue folder);
  - **six jobs at once is its limit; nine crashed it.**
- **NAS:**
  - queue: `\\monas\homes\monas\Mohammed\Calligraphy resources\tmpfle`;
  - pictures for the user:
    `\\monas\homes\monas\Mohammed\Calligraphy resources\HarfCanvas side-by-side\`.
    Make a `Jali Diwani` folder there. The NAS is the working copy for
    pictures; the repo keeps only the ones the ledger links to.

**The queue is shared, and so is its code. Be careful.**

- Submitting a job copies *your* `fitjob.py`, `gpufit.py`, `pieces.py`,
  `ribbon.py`, `build.py` and `fitqueue.py` into the queue's `code` folder.
  The worker restarts into whatever is there, and the Thuluth jobs then run
  on your code.
- **Don't submit from a branch whose copies of those files differ from the
  Thuluth branch's.**
- If you must change the fitter:
  - keep the change backward compatible;
  - tell the user;
  - preferably use your own queue folder (for example `tmpfle-diwani`) and
    ask the user to point the worker at it once the Thuluth queue is empty.
    Never run two workers on Geekmini at once.
- **Job order:** user fixes (`.f`) first, then names not starting with a
  digit (one-off jobs), then catalogue first fits, then second passes (`.r`,
  `.t`, `.u`). Prefix your job names (for example `jd-…`), and agree with the
  user whether Jali Diwani jobs should go ahead of Thuluth's.
- As of this writing, the Thuluth catalogue needs about another day of GPU
  time. Do the research, find references and run the first small fits on the
  laptop meanwhile. Small means a few strokes, not a catalogue.

## Suggested order of work

1. **Set up** the worktree and branch, and read everything above.
2. **Talk to the user before building.** What references they have, which
   style and master's tradition they want matched, which word to start with,
   and whether the "within reason" approval rule applies. Use the
   brainstorming skill; one question at a time.
3. **Research** (the research doc above). Show the user the findings that
   change how strokes are drawn: the pen, fills, joins.
4. **One pilot word** the user chooses, drawn piece by piece and fitted. Show
   a side-by-side at 3–4× and get the user's verdict before scaling up.
   Record what worked in the new ledger.
5. **The catalogue:** every letter, form and variant, fitted through the
   queue, with sheets on the NAS by letter group. Record each group as it
   completes, and take the user's fixes as they come.
6. Keep `PROGRESS.md` and the docs current, following `CLAUDE.md`'s rules on
   which document holds what.
