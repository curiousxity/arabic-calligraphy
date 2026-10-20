# Jali Diwani fitting tools

Fit the My Qalam studio's Jali Diwani shapes with the pen, through the shared NAS queue. Method and measurements:
`docs/calligraphy/jali-diwani-ledger.md`; verdicts: `scripts/pen/REVIEW-jali-diwani.md`.

Environment:
- `JD_STUDIO_DATA`: the folder holding the studio's Jali Diwani files (`db.json`, `stamps.pack.json`, `inkbox.json`,
  ...), saved locally with the user's OK and never committed.
- `JD_WORK`: where `registry.json` (stroke key -> job) is kept; a working folder outside the repository.
- `JD_HASHIM65` (jdplate.py only): Hashim's p. 65 rows rendered grey at full resolution from the user's copy of his
  book on the NAS.
- `JD_PREFER`, `JD_NODES` (the sheets): a pass to prefer (`.e`), or a folder of trimmed strokes to draw.

Order: `jdsubmit.py QUEUE ids` (first fits) -> `jdrepass.py QUEUE` (second passes) -> `jdtrim.py QUEUE OUT ids` ->
`jdsheet.py` / `jdplate.py` / `jdpoke.py` to look. Job files go straight into the queue's `todo/`, and code is never
synced: the queue runs the Thuluth session's fitting code. Never run fits on the laptop.
