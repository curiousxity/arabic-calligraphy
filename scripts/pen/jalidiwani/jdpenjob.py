"""Jali Diwani strokes fitted with a pen held to the qalam: the Thuluth session's method (its pen-fitter note,
2026-10-25: one nib angle and size per stroke, the width falling only where the pen lifts, onto one corner), run on
the sheet's exact strokes (jdcatalog with JD_EXACT). Every choice is scored on the GPU (gpufit.gpu_score); the CPU's
pieces.score runs once a stroke, as a check. Runs on the Geekmini through the queue's "scan" mode (jdpensubmit.py).
For each stroke "shape.sN":
  starts   the outline's centre line (band or skeleton, the better one) and the stroke's free fit (jdx-), if any
  angles   for each start, the two nib angles (at least 30 degrees apart) whose straight sweep covers it best
  anchors  each end may lift onto either corner: the four pairs (a turning nib: the first pair for every angle, then
           the other three for the leading start and angle only, PEN_PRUNE)
each start's combinations refined side by side by gpufit.refine_pens with one schedule (fine first over SHORT nuqta, coarse first under),
the best by overlap less outline gap less the end windows' worst miss kept, then run again with the other schedule.
  python jdpenjob.py OUT stroke ...      writes OUT/pen.json {stroke: {...}} and OUT/pics.json {stroke: png base64}
env PEN_LIFT (nuqta at each end that may lift, default 1.0), PEN_SIZE ("1": the nib's size may move, default "1"),
PEN_FILL ("a.s0,b.s1": strokes filled with a small pen or the nib's tip, fitted freely, not held to the pen)."""
import base64, json, math, os, re, sys, time
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jdcatalog import strokes, origin, transform, PPN, PEN  # noqa: E402
from ribbon import bands, smooth_path  # noqa: E402
from pieces import ref_ring, score, skeleton_samples, _thin  # noqa: E402
import gpufit  # noqa: E402
from gpufit import gpu_score  # noqa: E402
import pieces  # noqa: E402
from ribbon import ring_samples as _ring_samples  # noqa: E402


def fine_samples(segs, fine=6):
    """ribbon.ring_samples about a screen px apart, not a sheet unit apart. The studio's sheet units are 5.6 screen px,
    so the outline every fit and picture was judged on drew its curves as chords: the one-nib flag heads lost overlap
    on it while gaining on the true curves (074 0.959 to 0.964, 108 0.919 to 0.931, 2026-11-02). Set here, not in the
    shared pieces.py, so only Jali Diwani's fits see it (jdcatalog.ring's own trick, for every ref_ring)."""
    pts, starts = _ring_samples([tuple((x * fine, y * fine) for x, y in sg) for sg in segs])
    return pts / fine, starts


pieces.ring_samples = fine_samples

Q = os.environ.get("HARF_Q", "")
LIFT = float(os.environ.get("PEN_LIFT", 1.0))
SIZE = os.environ.get("PEN_SIZE", "1") == "1"
FILL = {x for x in os.environ.get("PEN_FILL", "").split(",") if x}
# PEN_ROTATE ("1", the default): the nib turns as it goes. Diwani's teacher rotates the pen in the fingers to taper an
# end and to follow a curve ("You must rotate the pen while moving", "a fixed angle gives the wrong shape": the course
# notes), so the Thuluth rule of one angle a stroke drew the trial's alif at 0.75 against the free fit's 0.97. Every
# node is then a turn (gpufit's pen "turns"): its own angle, kept smooth by the refine's roughness term, while the size
# stays one and the width still falls only where the pen lifts, onto one corner.
ROTATE = os.environ.get("PEN_ROTATE", "1") == "1"
# The small pen (the user, 2026-10-26: the head curls and the crowns' heads; the course: "one third of that width ... used
# for decorations and small heads"): those strokes are fitted with a nib a third as wide, and hand back node widths as
# fractions of the main nib (a third, less where the pen lifts), so a renderer draws them with the one pen.
SMALL_PEN = 1 / 3
SMALL = {"T04.s0", "T05.s0", "T06.s0"} | {x for x in os.environ.get("PEN_SMALL", "").split(",") if x}
# A long stroke's ends may thin over PEN_LIFT_LONG nuqta (the user, 2026-10-26: Diwani's long tails thin over more
# than the 1 nuqta of a Thuluth flick); LONG: the start path's length, nuqta, from which a stroke counts as long.
LIFT_LONG = float(os.environ.get("PEN_LIFT_LONG", 2.0))
LONG = 4.0
SHORT = 1.5
ANCHORS = ((1, 1), (1, -1), (-1, 1), (-1, -1))
# PEN_PRUNE ("1", the default; turning-nib fits only): every angle with the first anchor pair, then the other three
# pairs for the leading start and angle alone. The Thuluth session's logs (2026-10-26) had one angle's four pairs within
# 0.005 of each other and the angles 0.05-0.15 apart; on four turning-nib strokes the pruned search found the same fits
# in 2,135 s against 4,524 s. A turning nib's 12-24 tries overflow GPUFIT_PEN_PIXELS into several loops on the card, so
# fewer tries drop whole loops; a one-angle fit's 8 share one loop, and pruning made them 15% slower, so they keep the full search.
PRUNE = os.environ.get("PEN_PRUNE", "1") == "1"
# PEN_SPLIT ("T18.s0,..."): strokes whose sheet outline carries hairlines drawn with the pen's tip, a move of their own
# pulled from the wet body (the course: "using the tip of the pen to add a nice decoration", "come back with the tip
# of the pen ... extrude slightly, like neatly from the main line"). The main pen cannot sweep them, so such a stroke is
# fitted as its body, all of it wider than HAIR_W nuqta, with the main pen, and each hairline "stroke~hN" filled with
# the small pen, its widths free. T18.s0 held whole: 0.62, the head and both loops missed.
SPLIT = {x for x in os.environ.get("PEN_SPLIT", "").split(",") if x}
# PEN_CUT ("297.s1,..."): tooth strokes written as two moves that meet at the peak, "~c0" up to it and "~c1" from it
# (cut_piece). Only an end may lift onto a corner, so one stroke's peak stays full width and rounds off; cut there, both
# halves may narrow into it. The course teaches both: sin shape 1 "stop and come back" and shape 2 "down, sudden up,
# down" (lesson 4); the Thuluth side cut Ba Medial 4 this way (decision 48) and tried it on its sin (decision 51).
# The user chose two strokes for Diwani's tooth (2026-10-28: 297.s1 0.949 against 0.924, 301.s1 0.934 against 0.851).
# Both halves are one pen: the bigger half is fitted with its size free, the other held to that size (fitted apart in
# k1, 297.s1's halves took 1.49 and 0.94 and the bigger one bulged past the sheet's end). Each half runs to or from the
# cut, the right half first, as the line is written right to left (k1's 301.s1~c1 ran out of the peak backwards).
CUT = {x for x in os.environ.get("PEN_CUT", "").split(",") if x}
CUT_AT = {}  # "stroke~cN": the cut's midpoint, screen px, set by job_of
# PEN_CUT_MARGIN (nuqta, default 1.0): how far from either end of the path the cut's peak may be. A head that turns
# back at the top (074.s0, 076.s0, 084.s0: up, then a sharp turn back down into a flag) has its peak under a nuqta
# from the end, and fitted whole the flag rounded off or went (2026-10-31).
CUT_MARGIN = float(os.environ.get("PEN_CUT_MARGIN", 1.0))
# PEN_THREE ("074.s0,..."): a head that turns back into a flag, written as three moves (the user, 2026-11-01: "The stroke
# starts with the pen moving towards the left. Then there is a second stroke that goes up to 11 o'clock, and the third
# stroke starts slightly higher where you get the notch and then rolls down"). three_piece cuts the outline: "~c0" the
# flag's block, the nib along its right edge moving left; "~c1" from the block's foot up to the peak; "~c2" from the
# notch down the tail. Cut in two at the peak (PEN_CUT), the notch filled in and 084's flag came out ragged.
THREE = {x for x in os.environ.get("PEN_THREE", "").split(",") if x}
# PEN_KEEP (JSON, {"074.s0~c0": its pen.json record}): moves already approved, taken as fitted and not fitted again.
KEEP = json.loads(os.environ.get("PEN_KEEP", "{}"))
# PEN_FOLLOW ("074.s0~c1,..."): a move that starts where the move before it ("~c(N-1)") ended: the same nib angle, the
# full nib, its bottom corner on the other's bottom corner. The user (2026-11-01, 074.s0): "The green strokes should
# start matching the bottom of the red stroke so we don't end up with that notch on the bottom"; started free, the
# climb's foot sat beside the block's and left a notch under the flag.
FOLLOW = {x for x in os.environ.get("PEN_FOLLOW", "").split(",") if x}
FOLLOW_W = 1.0  # a degree off the held angle costs (deg / 2) ** 2 of this: held
# PEN_FOLLOW_ANG (degrees, unset): the followed start's nib at this angle, its bottom corner still on the move before's;
# and the move only ever goes left. At the end's own angle (127.8) 074's climb went right first and swelled at the peak
# (the user, 2026-11-01: "The green stroke needs to have a steeper angle and move steeper to the left").
FOLLOW_ANG = os.environ.get("PEN_FOLLOW_ANG")
FOLLOW_ANG = float(FOLLOW_ANG) if FOLLOW_ANG else None
FOLLOW_LEFT = 0.05  # nuqta a segment may move right before it costs a whole overlap
# PEN_FOLLOW_HOLD (nuqta, 0): the held angle kept over this much of the move's start, so its start face draws a whole
# edge: 074's climb at 95-115 degrees turned off within a node and left the neck's underside at 45 degrees where the
# studio's runs at 62 (the user: "I'm trying to match the angle of the bottom of the neck", 118 here).
FOLLOW_HOLD = float(os.environ.get("PEN_FOLLOW_HOLD", 0))
# PEN_FOLLOW_AT ("x,y", nuqta, unset): the start's bottom corner here, not on the move before's.
FOLLOW_AT = os.environ.get("PEN_FOLLOW_AT")
# PEN_MEET ("095.s0~c2,..."): a PEN_FOLLOW move that starts as the move before ended: its first node that end's own
# node (place, angle, width), the rest settled round it with the start held (meet). Held full from the end's bottom
# corner, the nib stood over a narrowed end, its top corner a spike over 095.s0's peak; a fresh fit's start never
# narrowed enough to match (n095g, 0.86 of the nib to green's 0.73). The user, 2026-11-02: clear the red, the neck's
# irregularities, and the tail ("fix the = slightly on all 3": 731's tip trimmed 0.1 nuqta short, 095's a hair high)
MEET = {x for x in os.environ.get("PEN_MEET", "").split(",") if x}
MEET_STEP, MEET_SHORT = 0.01, 0.01  # nuqta: the meet's tail trim, finer than TRIM_STEP and TRIM_SHORT
# the settle's weight on the worst local miss, at the tail's window and one at the meeting point (the neck under 095's
# peak kept a thin wedge, and its tail stood a hair high, at CORNER's 2; n095p, 2026-11-02)
MEET_CORNER = float(os.environ.get("PEN_MEET_CORNER", 2.0))  # CORNER's default
# PEN_POLISH (JSON, {"731.s0~c2": its pen.json record}): a fitted move taken as it is and only met (meet), its coarse
# tail trim undone first, not fitted again: a fresh fit of 731's blue came out 0.94 with the bowl low, where the one the
# user saw was 0.977 (n731m, 2026-11-02)
POLISH = json.loads(os.environ.get("PEN_POLISH", "{}"))
POLISH_MEET = os.environ.get("PEN_POLISH_MEET", "1") == "1"  # 0: the tail alone, no meet (approved moves)
# A tooth's right half starts with the flick in reverse (the studio ledger, from the sin lesson 4:36-4:44: the nib comes
# down on its corner at the hairline's tip and opens to full width as it climbs, at one angle; Thuluth's 170.s0 narrows
# over its first 3.3 nuqta, which a turning nib could not draw). Its fit also tries one angle with the start free to
# narrow onto a corner over the whole half (the user, 2026-10-28: "Try the flick method", k2's right ends missing the
# spike); the judge chooses between those and the turning nib. One angle lost on both (k3: 297.s1~c0 0.80 against 0.90,
# the nib turns some 170 degrees through the dip; 301.s1~c0 0.905 against 0.933), so the turning nib also tries the
# whole half as its start's narrowing. That lost too (k5: 297.s1~c0 0.90 and 301.s1~c0 0.88 against the plain turning
# nib's 0.936 and 0.93), so both are off unless PEN_FLICK=1: the plain turning nib, held to the shared size, reaches
# the spike once the halves share one pen.
FLICK = os.environ.get("PEN_FLICK", "0") == "1"
END_BACK = 0.25  # nuqta: a cut half's free end starts this far short of the outline's farthest point
END_REACH = 1.0  # nuqta: that farthest point is looked for this near the path's free end, on the way it runs
TRIM = os.environ.get("PEN_TRIM", "1") == "1"  # every try's hairline ends pulled back to the outline before the pick
TRIM_STEP, TRIM_TOL, TRIM_NEAR, TRIM_SHORT, TRIM_MAX = 0.05, 0.02, 0.5, 0.03, 1.0  # nuqta, jdtip.py's but the cap
TRIM_HAIR = 0.35  # pens: an end whose ink is narrower than this is a hairline tip (jdtip.py's HAIR)
# PEN_WALK ("142.s1,..."): curls whose band path stops before the curl's tip (the r1 curl tails, 2026-10-28: the inner
# hook missed). The course's jim head is one small-pen move that sweeps, turns down, curls under and back, and ends in a
# short thick foot (lesson 2, 05:29-05:36), so these strokes also start from the walk round the skeleton, finely spaced.
WALK = {x for x in os.environ.get("PEN_WALK", "").split(",") if x}
GIVEN = json.loads(os.environ.get("PEN_START", "{}"))  # {stroke: nodes}: one more start for the fit
WALK_STRAIGHT = os.environ.get("PEN_WALK_STRAIGHT", "0") == "1"  # the walk goes straight on at a crossing
HAIR_W, HAIR_L = 0.2, 0.5  # nuqta: a hairline is thinner than HAIR_W and reaches HAIR_L; shorter bits are where the body thins
HAIR_SPACING = 0.12  # nuqta between a hairline's start nodes: a loop half a nuqta across needs a dozen to go round
TIP_ANGLE = 110  # degrees: an outline point sharper than this is a tooth's tip
TOOTH = 0.25  # nuqta the outline stands out of the stroke past its half width: a tooth the pen goes up into and back (tooth_start)
END_R, CORNER = 0.6, 2.0
ALT_GAP = 0.05
ROUGH, EDGE, SPACING = 0.05, 3.0, 0.3


def old_fit(stroke):
    """The stroke's free fit from the queue (jdx-, and its second pass), the better by overlap less outline gap."""
    rs = [json.load(open(f, encoding="utf-8")) for f in (os.path.join(Q, "done", f"jdx-{stroke}{x}.json") for x in ("", ".u"))
          if os.path.exists(f)]
    return max(rs, key=lambda r: r["score"]["iou"] - r["score"]["gap95"]) if rs else None


def split_piece(piece):
    """A PEN_SPLIT stroke's outline as its body (wider than HAIR_W) and its hairlines (reaching HAIR_L or more), longest first, each a piece in
    the stroke's own frame, plus the slivers where the body thins out (in nobody's target). A hairline's loop is a hole;
    a ring holds none, so the hole is joined to the outline by a slit of no width."""
    (a, d, e, f), _ = piece
    ring = ref_ring(piece); r = 8.0  # raster px a screen px
    x1, y1 = ring.min(0) - 4
    W, H = [int(v) + 1 for v in (ring.max(0) + 4 - [x1, y1]) * r]
    M = np.zeros((H, W), np.uint8)
    cv2.fillPoly(M, [np.round((ring - [x1, y1]) * r).astype(np.int32)], 1)
    k = int(HAIR_W / 2 * PPN * r) * 2 + 1
    body = cv2.morphologyEx(M, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))

    def rings_of(mask):
        cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        for i, c in enumerate(cs):
            if hier[0][i][3] != -1 or len(c) < 3:  # a pixel's contour is one point, a ring with no segments to parse
                continue
            pts, j = c[:, 0].astype(float), hier[0][i][2]
            while j != -1:
                h = cs[j][:, 0].astype(float)
                ia, ib = np.unravel_index((((pts[:, None] - h[None]) ** 2).sum(-1)).argmin(), (len(pts), len(h)))
                pts = np.vstack([pts[:ia + 1], np.roll(h, -ib, 0), h[ib:ib + 1], pts[ia:]])
                j = hier[0][j][0]
            P = pts / r + [x1, y1]
            q = np.c_[(P[:, 0] - e) / a, (P[:, 1] - f) / d]
            out.append((max(cv2.boundingRect(c)[2:]) / r / PPN, [(a, d, e, f), "M " + " L ".join("%.4f %.4f" % tuple(v) for v in q) + " Z"]))
        return sorted(out, key=lambda t: -t[0])
    bodies, hairs = rings_of(body), rings_of(M & (1 - body))
    return (bodies[0][1], [p for s, p in hairs if s >= HAIR_L],
            [p for s, p in bodies[1:]] + [p for s, p in hairs if s < HAIR_L])


def job_of(stroke):
    base, _, h = stroke.partition("~")
    k, sid = base.split(".", 1)
    d_of = dict(strokes(k)); T = transform(k)
    piece, ignore = [T, d_of[sid]], [[T, od] for osid, od in d_of.items() if osid != sid]
    if base in SPLIT:  # the body ("~" none) or hairline "~hN", the stroke's other parts beside the shape's strokes
        body, hairs, slivers = split_piece(piece)
        parts = [body] + hairs; i = int(h[1:]) if h else 0
        piece, ignore = parts[i], ignore + [p for j, p in enumerate(parts) if j != i] + slivers
    if base in THREE and h.startswith("c"):  # one of three moves "~cN", the other two beside the shape's strokes
        parts, ats = three_piece(piece)
        i = int(h[1:]); CUT_AT[stroke] = ats[i]
        piece, ignore = parts[i], ignore + [q for j, q in enumerate(parts) if j != i]
    elif base in CUT and h.startswith("c"):  # one half "~cN", the other beside the shape's strokes
        parts = cut_piece(piece, np.array(origin(k), float), ignore)
        if parts is None:
            raise RuntimeError(f"{stroke}: no tooth to cut at")
        (parts, CUT_AT[stroke]), i = parts, int(h[1:])
        piece, ignore = parts[i], ignore + [parts[1 - i]]
    return piece, ignore, np.array(origin(k), float)


def judge(s):
    return s["iou"] - s["gap95"] - CORNER * s.get("window_worst", 0.0)


# PEN_CUTWIN ("free"): a PEN_CUT half is judged on its free end's window only. The cut end's window asked the half to
# cover its own side of the cut alone, before the other half was drawn; 366.s0's right half held its nib down the dip
# at 0.944 overlap and lost to the spin (0.919) on that window, 0.27 nuqta to 0.13 (k9). The spin's corner is the
# spike the user marked over the peak. The joint is checked on the whole outline once both halves are in.
CUTWIN = os.environ.get("PEN_CUTWIN", "both")
# PEN_LEAD ("347.s0,..."): the left half "~c1" starts where the right half ended, its top level with the right half's
# top; the nib moves LEAD_STEP nuqta left, then the long move down. The user (2026-10-29, 347.s0): "start the second
# stroke so that the top is aligned with the top of the previous stroke and move the nib a very short distance to the
# right before major move down", then "it probably should have been to the left" (right left a square notch at the
# peak, k15). Left free, the left half's start rose into the right half's ink and its corner stood out as a step below
# the peak. Accepted as k19 (0.974). How it got there:
#   the right half's points come down until the nib's top is level with the peak (level_top; k13 held the left half
#     to an end 0.11 nuqta over it and drew a square cap);
#   the start is the full nib (left to narrow, its top sat 0.14 nuqta under the peak's shoulder, k16);
#   the start and the tail's end are held (left free, the end drew 0.16 nuqta up off the tail, k16), the short move's
#     end is not (held level at full width it stood over the top edge falling away left of the peak, a bulge, k17);
#   the nib starts at the path's own angle (at the right half's upright one it stayed upright down the whole half and
#     the tail lost its end, k13: 0.906 against 0.959);
#   an overlap at the joint was not needed (k20: 0.971).
LEAD = {x for x in os.environ.get("PEN_LEAD", "").split(",") if x}
LEAD_STEP = float(os.environ.get("PEN_LEAD_STEP", -0.15))  # the short move, nuqta: - left, + right
LEAD_SKIP, LEAD_NEAR = 0.3, 0.6
# PEN_LEAD_FULL ("1"): the held start is the full nib. "0" lets it narrow as it starts: on teeth with a broad flat
# peak (301.s1, 309.s1, 312.s1, k23) the full nib tilted to cover the flat top and its corner stood up as a second horn.
LEAD_FULL = os.environ.get("PEN_LEAD_FULL", "1") == "1"
# PEN_FULLSTART ("105.s0,..."): these strokes start at the full nib, unnarrowed: the squared face where a stroke joins
# the next letter (the user, 2026-10-29: "where the stroke connects to the next letter"); 105.s0's narrowed to 0.9 and
# left the face's top corner bare.
FULLSTART = {x for x in os.environ.get("PEN_FULLSTART", "").split(",") if x}
# PEN_FULLEND ("314.s0,..."): these strokes end at the full nib, the squared face at their end. 314.s0, the sin's
# first stroke, ends in a square whose top corner meets the next stroke's tooth; its fit took a 0.7 nib and left the
# corner bare, so the sin's second tooth in the Bismillah came out a sliver (the user, 2026-10-31: "the sin tooth").
FULLEND = {x for x in os.environ.get("PEN_FULLEND", "").split(",") if x}
# PEN_JOINT ("301.s1,..."): a PEN_CUT stroke's two halves finished together at the peak where they meet, from the fits
# in PEN_JOINT_FROM (a JSON {"stroke~cN": {"nodes", "pen_scale"}}): each half is refitted against the whole stroke's
# outline with the other half's ink counted as on the page (gpufit's `others`), the first half then the second, each
# judged at its free end only; a refit stands only if the whole stroke scores no worse. The user marked notches just
# under the peak (301.s1, 309.s1), a kink on the slope (301.s1) and a two-tipped peak (299.s1) where the halves,
# fitted apart, met (2026-10-29), and moving their points by hand traded one fault for another.
JOINT = {x for x in os.environ.get("PEN_JOINT", "").split(",") if x}

# PEN_FREEHOLD ("312.s1~c0,..."): a PEN_CUT half's nib held at one angle over its first PEN_FREEHOLD_L nuqta from its free
# end. Judged at its free end only (PEN_CUTWIN), 312.s1's and 356.s0's right halves spun the nib about 180 degrees
# there (k10: 275 down to 86 over 0.9 nuqta, 266 down to 88 over 2.3), where the earlier fits held it at 80-92. Named
# by half: 356.s0's left half turns about 90 degrees into its hook at its free end, as it should.
FREEHOLD = {x for x in os.environ.get("PEN_FREEHOLD", "").split(",") if x}
FREEHOLD_L = float(os.environ.get("PEN_FREEHOLD_L", 1.0))
# PEN_NEXT (a JSON {"105.s0": {"exit": "136.s0", "shift": [dx, dy], "nodes": [...]}}): a letter's entry stroke fitted
# at its join with the letter before it, the pen not lifting there (the user, 2026-10-29: "one continuous stroke ...
# follow the studio"). The exit stroke's outline joins the target, its letter-mates are ignored, and its fitted ink
# (nodes in main nibs, its own frame) counts as on the page; shift is screen px from the exit's frame to this
# stroke's, from the word's placements. Fitted apart, the Bismillah's ha->ya left a step under the join and its
# ha->mim a nub (2026-10-30); the tooth finish at those joins rounded counters into lobes.
NEXT = json.loads(os.environ.get("PEN_NEXT", "{}"))
_next = [None]  # (exit piece, its letter-mates, its nodes) in this stroke's frame while fit runs on a PEN_NEXT stroke


def next_of(stroke):
    if stroke not in NEXT:
        return None
    x = NEXT[stroke]; dx, dy = x["shift"]
    xpiece, xmates, xO = job_of(x["exit"])
    sh = lambda p: [(p[0][0], p[0][1], p[0][2] + dx, p[0][3] + dy), p[1]]  # noqa: E731
    O = np.array(origin(stroke.split(".")[0]), float)
    nodes = [{**q, "p": [round(float(v), 4) for v in (np.array(q["p"]) * PPN + xO + [dx, dy] - O) / PPN]} for q in x["nodes"]]
    return sh(xpiece), [sh(p) for p in xmates], nodes


def _with_next(refs, others, ignore, P):
    if not _next[0]:
        return list(refs), list(others), list(ignore)
    xp, xm, xn = _next[0]
    return list(refs) + [xp], list(others) + [[{**q, "width": q.get("width", 1) * PEN / P} for q in xn]], list(ignore) + xm


def nscore(mine, refs, O, ppn, P, ignore=()):  # gpu_score, with the exit stroke when fitting a PEN_NEXT stroke
    r, o, i = _with_next(refs, (), ignore, P)
    return gpu_score(list(mine) + o, r, O, ppn, P, i)


def nworst(nodes, pieces, O, ppn, P, others=(), windows=(), ignore=()):
    r, o, i = _with_next(pieces, others, ignore, P)
    return gpufit.window_worst(nodes, r, O, ppn, P, o, windows, i)


def nrefine_pens(nodes, pieces, O, ppn, P, pens, ignore=(), others=(), **kw):
    r, o, i = _with_next(pieces, others, ignore, P)
    return gpufit.refine_pens(nodes, r, O, ppn, P, pens, ignore=i, others=o, **kw)


def nrefine(nodes, pieces, O, ppn, P, ignore=(), others=(), **kw):
    r, o, i = _with_next(pieces, others, ignore, P)
    return gpufit.refine(nodes, r, O, ppn, P, ignore=i, others=o, **kw)


def end_windows(nodes, pen=PEN, stroke=None):
    """The two end windows, their radius in proportion to the nib: a small pen's tip is a third the size, and a window
    sized for the main nib's covers a whole head curl, so the curl's spiral scored as a missed tip and an unwound fit won
    (113.s2, trial three: 0.87 lost to 0.76)."""
    r = END_R * pen / PEN
    w = [(*nodes[0]["p"], r), (*nodes[-1]["p"], r)]
    if CUTWIN == "free" and stroke in CUT_AT:  # orient puts a "~c0" half's free end first, a "~c1" half's last
        return w[:1] if stroke.endswith("~c0") else w[1:]
    return w


def length(nodes):
    P = np.array([n["p"] for n in nodes])
    return float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())


def walk_samples(piece, pen, sub=8):
    """Centre samples [x, y, w, phi, off] of a tip-drawn hairline, walked through every branch of its skeleton once (an
    Euler path between its free ends), so a loop is gone round where the longest path cuts straight past it (T18.s0's
    hairlines, 2026-10-27: 0.57 and 0.42). Spurs shorter than a few line widths come off first. None when no such walk
    exists (more than two free ends left, or no branch at all)."""
    from collections import defaultdict
    ring = ref_ring(piece)
    x1, y1 = ring.min(0) - 4
    W, H = [int(v) + 1 for v in (ring.max(0) + 4 - [x1, y1]) * sub]
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round((ring - [x1, y1]) * sub * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    pts = {tuple(p) for p in np.argwhere(_thin(m))}
    N8 = ((-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1))
    nb = lambda p: [(p[0] + a, p[1] + b) for a, b in N8 if (p[0] + a, p[1] + b) in pts]  # noqa: E731

    def crossings(p):  # 0-to-1 steps round the 8 neighbours: the branches a pixel joins, blind to staircase corners
        r8 = [(p[0] + a, p[1] + b) in pts for a, b in N8]
        return sum((not r8[i]) and r8[(i + 1) % 8] for i in range(8))
    nodes = {p for p in pts if crossings(p) != 2}
    cl = {}  # each end or junction pixel's cluster: a junction is a few pixels thick
    for p in nodes:
        if p in cl:
            continue
        cl[p], q = len(set(cl.values())), [p]
        while q:
            for n in nb(q.pop()):
                if n in nodes and n not in cl:
                    cl[n] = cl[p]; q.append(n)
    segs, seen = [], set()
    for u in nodes:
        for v in nb(u):
            if v in nodes or v in seen:
                continue
            path, prev, cur = [u, v], u, v
            seen.add(v)
            while True:
                nx = [n for n in nb(cur) if n != prev and n not in path[-3:]]
                end = [n for n in nx if n in nodes and (len(path) > 3 or cl[n] != cl[u])]
                if end:
                    path.append(end[0]); break
                nx = sorted((n for n in nx if n not in seen and n not in nodes), key=lambda n: abs(n[0] - cur[0]) + abs(n[1] - cur[1]))
                if not nx:
                    path = None; break
                prev, cur = cur, nx[0]; seen.add(cur); path.append(cur)
            if path:
                segs.append([cl[u], cl[path[-1]], path])
    if not segs:
        return None
    width = 2 * float(np.median([dt[p] for p in pts])) / sub  # the line's own width, screen px
    parent = {}

    def root(c):
        while parent.get(c, c) != c:
            c = parent[c]
        return c
    short = lambda p: len(p) / sub < 3 * width  # noqa: E731
    while True:
        segs = [[root(a), root(b), p] for a, b, p in segs]
        deg = defaultdict(int)
        for a, b, _ in segs:
            deg[a] += 1; deg[b] += 1
        # a crossing thins to a few junctions a pixel or two apart, joined by short links: one junction
        link = [i for i, (a, b, p) in enumerate(segs) if a != b and deg[a] > 1 and deg[b] > 1 and short(p)]
        # a short branch to a free end is where thinning frays a blunt end
        spur = [i for i, (a, b, p) in enumerate(segs) if (a == b or deg[a] == 1 or deg[b] == 1) and short(p) and len(segs) > 1]
        if link:
            a, b, _ = segs.pop(link[0]); parent[b] = a
        elif spur:
            segs.pop(spur[0])
        else:
            break
    odd = [c for c, k in deg.items() if k % 2]
    if len(odd) not in (0, 2):
        return None
    adj = defaultdict(list)
    for i, (a, b, _) in enumerate(segs):
        adj[a].append(i); adj[b].append(i)
    def oriented(i, frm):
        return segs[i][2] if segs[i][0] == frm else segs[i][2][::-1]
    k_ = max(4, int(1.5 * width * sub))  # sub px: how far along a branch its direction is read

    def straightest(v, came, cand):
        """at a crossing the pen goes straight on (484's and 485's loops, 2026-11-03: an arbitrary branch turned the
        walk back on its own side, and the two sides kissed instead of crossing)"""
        p = np.array(oriented(*came), float); d0 = p[-1] - p[max(0, len(p) - k_)]
        def cos(j):
            q = np.array(oriented(j, v), float); d1 = q[min(len(q) - 1, k_)] - q[0]
            return float(d0 @ d1) / (np.linalg.norm(d0) * np.linalg.norm(d1) + 1e-9)
        return max((j for j in cand if j not in used), key=cos)
    used, stack, walk = set(), [(odd[0] if odd else segs[0][0], None)], []
    while stack:  # Hierholzer
        v, _ = stack[-1]
        while adj[v] and adj[v][-1] in used:
            adj[v].pop()
        if adj[v]:
            i = adj[v].pop() if not (WALK_STRAIGHT and stack[-1][1]) else straightest(v, stack[-1][1], adj[v])
            adj[v].remove(i) if i in adj[v] else None; used.add(i)
            a, b, _ = segs[i]
            stack.append((b if a == v else a, (i, v)))
        else:
            walk.append(stack.pop()[1])
    path = []
    for i, frm in [e for e in walk[::-1] if e]:
        p = segs[i][2] if segs[i][0] == frm else segs[i][2][::-1]
        path += p[1:] if path else p
    path = np.array(path, float)
    xy = np.c_[path[:, 1] / sub + x1, path[:, 0] / sub + y1]
    w = np.array([2 * dt[int(r), int(c)] / sub for r, c in path])
    step = max(1, len(xy) // 240)
    xy, w = xy[::step], w[::step]
    out = []
    for k in range(len(xy)):
        k0, k1 = max(0, k - 2), min(len(xy) - 1, k + 2)
        phi = math.degrees(math.atan2(-(xy[k1, 1] - xy[k0, 1]), xy[k1, 0] - xy[k0, 0]))
        out.append([float(xy[k, 0]), float(xy[k, 1]), float(w[k]), phi, math.degrees(math.asin(min(1.0, w[k] / pen)))])
    return out


def tooth_start(piece, O, nodes, pen=PEN):
    """The band's start with a node added at each tooth's tip, so the pen goes up into the tooth and back down: the
    centre line cuts under a tooth's peak, and the fit rounded over it (13 strokes, 2026-10-27: 290.s1 ... 366.s0,
    0.74-0.85). None without a tooth."""
    found = tooth_tips(piece, O, nodes)
    if not found:
        return None
    ring, tips, arc = found
    nodes = [dict(n) for n in nodes]
    for k, c, tk in sorted(tips, key=lambda q: -q[2]):  # from the far end, so earlier indices hold
        i = int(np.searchsorted(arc, tk))  # the tip goes in before node i
        i = min(max(i, 1), len(nodes) - 1)
        tip = ring[k] + (c - ring[k]) / max(np.linalg.norm(c - ring[k]), 1e-6) * pen * 0.1
        nodes.insert(i, {"p": [round(float(v), 3) for v in (tip - O) / PPN], "angle": nodes[i - 1]["angle"], "tip": True})
    return nodes


def cut_piece(piece, O, ignore):
    """A PEN_CUT stroke's outline cut in two at its peak: the chord from the tip through the centre line there on to the
    outline across the stroke, under the tooth. The peak is the outline's sharpest outward point a nuqta or more from
    either end of the path, not tooth_tips' (the centre line can run up close under a peak, which then does not stand
    out: 297.s1, 2026-10-28). ([the two halves as pieces in the stroke's own frame, the right one ("~c0") first], the
    cut's midpoint in screen px), or None without a point."""
    band = band_start(piece, O, ignore, PEN)
    ring = ref_ring(piece)
    P = np.array([q["p"] for q in band]) * PPN + O
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    t = np.linspace(0, arc[-1], max(2, int(arc[-1] * 2)))
    dense = np.c_[np.interp(t, arc, P[:, 0]), np.interp(t, arc, P[:, 1])]
    ra = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ring, axis=0, append=ring[:1]), axis=1))][:-1]
    L = ra[-1] + np.linalg.norm(ring[0] - ring[-1])
    poly = np.round(ring * 16).astype(np.int32)
    closed, rc = np.vstack([ring, ring[:1]]), np.r_[ra, L]
    # the outline's point a distance along it, between vertices: the nearest vertex is the point itself where the
    # vertices are sparse, a zero leg that read as a right angle and outbid a blunter real peak (356.s0, 357.s0 cut
    # down the shaft, 2026-10-29)
    at = lambda s: np.array([np.interp(s % L, rc, closed[:, 0]), np.interp(s % L, rc, closed[:, 1])])  # noqa: E731
    best_k, best_cos = None, math.cos(math.radians(TIP_ANGLE))
    for k in range(len(ring)):
        jn = np.linalg.norm(dense - ring[k], axis=1).argmin()
        if not CUT_MARGIN * PPN <= t[jn] <= arc[-1] - CUT_MARGIN * PPN:
            continue
        a_, b_ = at(ra[k] - 0.25 * PPN), at(ra[k] + 0.25 * PPN)
        u_, v_ = a_ - ring[k], b_ - ring[k]
        cosang = u_ @ v_ / max(np.linalg.norm(u_) * np.linalg.norm(v_), 1e-9)
        mid = (a_ + b_) / 2  # an outward point: the chord across it runs through the ink
        if cosang > best_cos and cv2.pointPolygonTest(poly, (float(mid[0] * 16), float(mid[1] * 16)), False) > 0:
            best_k, best_cos = k, cosang
    if best_k is None:
        return None
    k = best_k
    c = dense[np.linalg.norm(dense - ring[k], axis=1).argmin()]
    u = (c - ring[k]) / max(np.linalg.norm(c - ring[k]), 1e-6)
    reach, best = np.linalg.norm(c - ring[k]), None
    for i in range(len(ring)):  # the first crossing of the ring past the centre line
        A, Bp = ring[i], ring[(i + 1) % len(ring)]
        M = np.array([u, A - Bp]).T
        if abs(np.linalg.det(M)) < 1e-9:
            continue
        s, w = np.linalg.solve(M, A - ring[k])
        if s > reach and 0 <= w <= 1 and (best is None or s < best[0]):
            best = (s, i, A + w * (Bp - A))
    if best is None:
        return None
    _, h, X = best
    n = len(ring)
    walk = lambda a, b: [ring[q % n] for q in range(a, b + 1 if b >= a else b + n + 1)]  # noqa: E731
    halves = [np.array(walk(k, h) + [X]), np.array([X] + walk(h + 1, k))]
    (a, d, e, f), _ = piece
    out = [[(a, d, e, f), "M " + " L ".join("%.4f %.4f" % ((x - e) / a, (y - f) / d) for x, y in hv) + " Z"] for hv in halves]
    # the right half first: the line is written right to left (the band's own direction is arbitrary)
    return (out if halves[0][:, 0].mean() >= halves[1][:, 0].mean() else out[::-1]), (ring[k] + X) / 2


def sheet_marks(piece, ring):
    """The flag head's marks on the sheet, as indices of the nearest ring points (the flag's bottom corner, its top
    corner, the peak, the notch), or None when the path is not a flag head's. Every flag head's path (074, 075, 076,
    077, 084, 086, 087, 095, 108, 731) starts at the flag's bottom corner with the nib's own edge, 3.56 units at 79
    degrees, then the top edge to the peak, round the roll, and back from the notch along the underside one nib below
    the top edge. Red and green are that one nib swept along the top edge (the user, 2026-11-01: "flag heads are
    perfect now")."""
    (a, d, e, f), path = piece
    v = [float(x) for x in re.findall(r"-?\d+\.?\d*", path)]
    if not path.lstrip().startswith("M") or "C" not in path or (len(v) - 2) % 6 or len(v) < 26:
        return None
    pts = np.array([v[:2]] + [v[2 + 6 * i + 4:2 + 6 * i + 6] for i in range((len(v) - 2) // 6)])
    edge = pts[1] - pts[0]
    if not 3.3 < np.linalg.norm(edge) < 3.8 or not 75 < math.degrees(math.atan2(-edge[1], edge[0])) < 84:
        return None
    return [int(np.linalg.norm(ring - (q * [a, d] + [e, f]), axis=1).argmin()) for q in (pts[0], pts[1], pts[2], pts[-2])]


def three_piece(piece):
    """PEN_THREE's cut of a flag head: ([block, climb, roll] as pieces in the stroke's own frame, [each one's cut point,
    screen px]). The notch is the outline's sharpest inward corner, the flag's top corner the next; the block's right
    edge is its two sharpest outward corners between them, and the nib lies along it. The block is cut off by the nib's
    line through the top corner; the roll by the narrowest chord from the notch across the stem."""
    ring = ref_ring(piece)
    N = PPN

    def geom(ring):
        ra = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ring, axis=0, append=ring[:1]), axis=1))][:-1]
        L = ra[-1] + np.linalg.norm(ring[0] - ring[-1])
        closed, rc = np.vstack([ring, ring[:1]]), np.r_[ra, L]
        at = lambda s_: np.array([np.interp(s_ % L, rc, closed[:, 0]), np.interp(s_ % L, rc, closed[:, 1])])  # noqa: E731
        area = 0.5 * np.sum(ring[:, 0] * np.roll(ring[:, 1], -1) - np.roll(ring[:, 0], -1) * ring[:, 1])
        ang, inward = [], []
        for k in range(len(ring)):
            a, b = at(ra[k] - 0.12 * N), at(ra[k] + 0.12 * N)
            u, v = a - ring[k], b - ring[k]
            ang.append(math.degrees(math.acos(np.clip(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9), -1, 1))))
            inward.append(((ring[k] - a)[0] * (b - ring[k])[1] - (ring[k] - a)[1] * (b - ring[k])[0]) * area < 0)
        return ra, L, np.array(ang), np.array(inward)
    ra, L, ang, inward = geom(ring)
    (a_, d_, e, f), _ = piece
    as_piece = lambda hv: [(a_, d_, e, f), "M " + " L ".join("%.4f %.4f" % ((x - e) / a_, (y - f) / d_) for x, y in hv) + " Z"]  # noqa: E731
    # A flag head drawn as the one nib (sheet_marks): red and green are one sweep, kept as drawn (PEN_KEEP), so their
    # piece is all of the head from the notch round the flag to the peak, given as both; the roll is cut by the nib at
    # the peak, peak to notch. The search below found no flag corner on 095.s0's soft corners and no peak on 731.s0's,
    # a whole nuqta on from the corner; on 074, 084 and 108 the roll's piece is the one it cut.
    marks = sheet_marks(piece, ring)
    if marks:
        _, _, pk, n = marks
        m = len(ring)
        fwd = lambda a, b: [q % m for q in range(a, b + 1 if b >= a else b + m + 1)]  # noqa: E731
        if (ra[marks[1]] - ra[n]) % L > L / 2:  # forward from the notch round the flag
            fwd = lambda a, b: [q % m for q in range(a, b - 1 if b <= a else b - m - 1, -1)]  # noqa: E731
        rest, roll = as_piece([ring[q] for q in fwd(n, pk)]), as_piece([ring[q] for q in fwd(pk, n)])
        cut = (ring[n] + ring[pk]) / 2
        return [rest, rest, roll], [cut, cut, cut]
    conc = [k for k in np.argsort(ang) if inward[k] and ang[k] < 150]
    if len(conc) < 2:
        raise RuntimeError("no notch and flag corner to cut at")
    n, c = conc[0], next(k for k in conc[1:] if min(abs(ra[k] - ra[conc[0]]), L - abs(ra[k] - ra[conc[0]])) > 0.1 * N)
    if (ra[c] - ra[n]) % L > L / 2:  # the flag's way round, notch to top corner, forward
        ring = ring[::-1].copy(); n, c = len(ring) - 1 - n, len(ring) - 1 - c
        ra, L, ang, inward = geom(ring)
    m = len(ring)
    fwd = lambda a, b: [q % m for q in range(a, b + 1 if b >= a else b + m + 1)]  # noqa: E731
    flag = fwd(n, c)[1:-1]
    out_ = sorted([k for k in flag if not inward[k]], key=lambda k: ang[k])
    # the two corners a nib apart at least: 108.s0's bottom corner is three vertices within a hair
    f2, f1 = sorted([out_[0], next(k for k in out_[1:] if np.linalg.norm(ring[k] - ring[out_[0]]) > 0.4 * N)],
                    key=lambda k: (ra[k] - ra[n]) % L)
    d = ring[f2] - ring[f1]; d /= np.linalg.norm(d)  # the nib, down the block's right edge

    def hit(o, d, idx):  # the ray o + t d's first crossing of the segments after vertices idx
        best = None
        for i in idx:
            A, B = ring[i], ring[(i + 1) % m]
            M = np.array([d, A - B]).T
            if abs(np.linalg.det(M)) < 1e-9:
                continue
            t, w = np.linalg.solve(M, A - o)
            if t > 1e-6 and 0 <= w <= 1 and (best is None or t < best[0]):
                best = (t, i, A + w * (B - A))
        return best
    xb = hit(ring[c], d, fwd(n, f2)[:-1])
    if xb is None:
        raise RuntimeError("the block's cut meets no edge")
    _, b, XB = xb
    # the roll's cut: from the notch straight up to the peak, the sharpest outward corner within 0.6 nuqta on from
    # the flag's top corner. The roll starts there, "slightly higher, where you get the notch"; cut across the stem at
    # the notch instead, the climb's piece kept a strip of the neck left of the peak, and the climb ran on left past
    # the peak to cover it and flattened the point (fbm, 2026-11-01)
    pk = min((q for q in fwd(c, n)[1:-1] if not inward[q] and (ra[q] - ra[c]) % L < 0.6 * N), key=lambda q: ang[q])
    block = [XB] + [ring[q] for q in fwd(b + 1, c)]
    climb = [ring[q] for q in fwd(c, pk)] + [ring[n]] + ([ring[q] for q in fwd(n + 1, b)] if b != n else []) + [XB]
    roll = [ring[q] for q in fwd(pk, n)]
    XA = ring[pk]
    (a_, d_, e, f), _ = piece
    out = [[(a_, d_, e, f), "M " + " L ".join("%.4f %.4f" % ((x - e) / a_, (y - f) / d_) for x, y in hv) + " Z"]
           for hv in (block, climb, roll)]
    return out, [(ring[c] + XB) / 2, (ring[c] + XB) / 2, (ring[n] + XA) / 2]


def tooth_tips(piece, O, nodes, sub=4):
    """The outline's tooth tips along a start path: (ring, [(ring index, the centre-line point beside it, its distance
    along the path)] tallest first, the path's arc lengths), or None. A tooth is where the outline stands out from the
    start path TOOTH nuqta beyond the stroke's half width there, away from the path's ends; the farthest such point in
    each stretch of PPN along the path is the tip."""
    ring = ref_ring(piece)
    x1, y1 = ring.min(0) - 4
    W, H = [int(v) + 1 for v in (ring.max(0) + 4 - [x1, y1]) * sub]
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round((ring - [x1, y1]) * sub * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5) / sub  # screen px to the outline
    P = np.array([n["p"] for n in nodes]) * PPN + O
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    arc = np.r_[0, np.cumsum(seg)]
    t = np.linspace(0, arc[-1], max(2, int(arc[-1] * 2)))  # half a screen px apart
    dense = np.c_[np.interp(t, arc, P[:, 0]), np.interp(t, arc, P[:, 1])]
    half = np.array([dt[min(max(int(round((y - y1) * sub)), 0), H - 1), min(max(int(round((x - x1) * sub)), 0), W - 1)]
                     for x, y in dense])
    d = np.linalg.norm(ring[:, None] - dense[None], axis=2)
    j = d.argmin(1); out = d[np.arange(len(ring)), j] - half[j]
    # a tip is a point of the outline, sharper than TIP_ANGLE and turned outward (the chord across it runs through the
    # ink): where the centre line runs off the middle, the outline across a valley stands out too, but it is not a point
    ra = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ring, axis=0, append=ring[:1]), axis=1))][:-1]
    L = ra[-1] + np.linalg.norm(ring[0] - ring[-1])
    def sharp(k):
        a_ = ring[np.argmin(np.abs((ra - ra[k] + 0.25 * PPN) % L - 0))]
        b_ = ring[np.argmin(np.abs((ra - ra[k] - 0.25 * PPN) % L - 0))]
        u, v = a_ - ring[k], b_ - ring[k]
        cosang = u @ v / max(np.linalg.norm(u) * np.linalg.norm(v), 1e-9)
        mx, my = (a_ + b_) / 2
        inside = m[min(max(int(round((my - y1) * sub)), 0), H - 1), min(max(int(round((mx - x1) * sub)), 0), W - 1)]
        return inside and cosang > math.cos(math.radians(TIP_ANGLE))
    ok = (t[j] > 0.3 * PPN) & (t[j] < arc[-1] - 0.3 * PPN) & (out >= TOOTH * PPN)
    ok = ok & np.array([bool(o) and sharp(k) for k, o in enumerate(ok)])
    tips = []
    for k in np.argsort(-out):
        if ok[k] and all(abs(t[j[k]] - t[j[q]]) > PPN for q in tips):
            tips.append(k)
    if not tips:
        return None
    return ring, [(k, dense[j[k]], t[j[k]]) for k in tips], arc


# PEN_TIPS ("1"): a tooth's tip is pieces.shape_cost's "corner", where the pen goes up and comes straight back, excused
# its bend and its fold; the nib's turning still counts there. gpufit's costs have no corners (a path with them goes to
# the CPU), so the tip went in as an ordinary node and the fold's 10 a node held every peak about halfway up (t1,
# 2026-10-28: 297.s1, 301.s1, 347.s0). The queue's gpufit is the Thuluth side's, so its costs are wrapped here.
TIPS_ON = os.environ.get("PEN_TIPS", "0") == "1"
_tips = set()  # the tip nodes of the path being refined, set by with_tips
_shape_cost_b, _shape_cost = gpufit._shape_cost_b, gpufit.shape_cost
# PEN_TURN ("0", off): a PEN_CUT half's nib pays for how fast it turns, not only for changes in that speed. gpufit's term is
# the angle's second difference, so a steady spin is free: 366.s0's right half wound its nib about 165 degrees the long
# way through the dip to the peak (87 ... 68, 38, 1, -38, -77), the same nib line as a 15 degree tilt onto the other
# corner, and drew a ledge in the dip and a spike over the peak. The user (2026-10-29): there the pen goes down and
# slides left, it does not turn. 20 degrees a node costs ROUGH; the 15-25 degrees a good tooth turns in all is noise.
# Curls and S sweeps, which do turn (the user, 2026-10-25), are no cut half and keep the old cost.
# k9 (2026-10-29): the spin only spread out (-71 ... 88) and 297.s1 and 299.s1 took one up (0.943 to 0.927, 0.950 to 0.912),
# so the term is off: the spin was the cut end's window at work (PEN_CUTWIN).
TURN_ON = os.environ.get("PEN_TURN", "0") == "1"
# PEN_TURNS ("685.s1,..."): the turn-rate cost on these whole strokes too: 685.s1's nib turned 25-33 degrees a node
# through the bowl's climb and drew a ledge inside it; T02.s1's turned broadside to a thin straight stroke.
TURNS = {x for x in os.environ.get("PEN_TURNS", "").split(",") if x}
TURN_DEG = 20.0
_turn = [False]  # set by fit for a cut half's refines


def _turn_cost_b(a, rough):
    import torch
    out = a.new_zeros(a.shape[0])
    if _turn[0] and a.shape[1] >= 2:
        out = out + rough * ((torch.diff(a[..., 2], 1, dim=1) / TURN_DEG) ** 2).sum(1)
    if _hold[0] is not None:  # PEN_FOLLOW: the start's nib held at the move before's end
        out = out + FOLLOW_W * ((torch.remainder(a[:, 0, 2] - _hold[0] + 90, 180) - 90) / 2) ** 2
        if FOLLOW_HOLD > 0 and a.shape[1] > 1:  # every node within FOLLOW_HOLD of the start, by the chord from it
            near = ((a[:, 1:, :2] - a[:, :1, :2]).norm(dim=-1) < FOLLOW_HOLD).float()
            out = out + FOLLOW_W * (((torch.remainder(a[:, 1:, 2] - _hold[0] + 90, 180) - 90) / 2) ** 2 * near).sum(1)
        if FOLLOW_ANG is not None:
            out = out + ((torch.relu(torch.diff(a[..., 0], dim=1)) / FOLLOW_LEFT) ** 2).sum(1)
            # and never down the page: 074's climb hooked down-left past the peak and rounded it into a dome (fbl)
            out = out + ((torch.relu(torch.diff(a[..., 1], dim=1)) / FOLLOW_LEFT) ** 2).sum(1)
    return out


_hold = [None]  # PEN_FOLLOW's held start angle, set by fit


def _tip_cost_b(a, rough, bend="position"):
    """gpufit._shape_cost_b, with the bend and fold at each node in _tips left out, as pieces.shape_cost's corners; and
    a cut half's turn rate (PEN_TURN)."""
    if not _tips:
        return _shape_cost_b(a, rough, bend) + _turn_cost_b(a, rough)
    import torch
    n = a.shape[1]
    cost = a.new_zeros(a.shape[0])
    if n > 3:
        keep = torch.tensor([0.0 if {j + 1, j + 2} & _tips else 1.0 for j in range(n - 3)], device=a.device)
        if bend == "heading":
            ch = torch.diff(a[..., :2], dim=1)
            L = ch.norm(dim=-1) + 1e-9
            h = torch.atan2(ch[..., 1], ch[..., 0])
            dh = torch.remainder(torch.diff(h, dim=1) + math.pi, 2 * math.pi) - math.pi
            cost = cost + rough * (((torch.diff(dh / ((L[:, 1:] + L[:, :-1]) / 2), dim=1) * 0.8) ** 2) * keep).sum(1)
        else:
            cost = cost + rough * (((torch.diff(a[..., :2], 3, dim=1) / 0.1) ** 2).sum(2) * keep).sum(1)
    if n > 2:
        cost = cost + rough * ((torch.diff(a[..., 2], 2, dim=1) / 30) ** 2).sum(1)
    ch = torch.diff(a[..., :2], dim=1)
    cos = (ch[:, 1:] * ch[:, :-1]).sum(-1) / (ch[:, 1:].norm(dim=-1) * ch[:, :-1].norm(dim=-1) + 1e-9)
    fold = torch.tensor([0.0 if j + 1 in _tips else 1.0 for j in range(n - 2)], device=a.device)
    return cost + (torch.relu(-cos) * fold).sum(1) * 10 + _turn_cost_b(a, rough)


def _tip_cost(a, rough, bend="position"):
    return _tip_cost_b(a[None], rough, bend)[0] if _tips or _turn[0] or _hold[0] is not None else _shape_cost(a, rough, bend)


gpufit._shape_cost_b, gpufit.shape_cost = _tip_cost_b, _tip_cost


def with_tips(nodes):
    """The nodes, with _tips set to their tooth tips (PEN_TIPS) for the refine about to run."""
    _tips.clear()
    if TIPS_ON:
        _tips.update(i for i, q in enumerate(nodes) if q.get("tip"))
    return nodes


def band_start(piece, O, ignore, pen=PEN, hair=False):
    best = None
    walk = hair and walk_samples(piece, pen)  # a hairline goes round its loops; without a walk, the band's usual starts
    for samples in ((walk,) if walk else (bands([piece], pen)[0], skeleton_samples(piece, pen))):
        if not samples:
            continue
        for h in (0, 45, 90, 135):
            p = smooth_path(samples, pen, O, PPN, HAIR_SPACING if walk else SPACING, hint=h)
            s = gpu_score([p], [piece], O, PPN, pen, ignore)
            if best is None or s["iou"] > best[1]["iou"]:
                best = (p, s)
    if best is None or length(best[0]) < 0.05:
        # a round mark thins to one skeleton point, and smooth_path makes two nodes on it: a path of no length, which
        # the fit drove out of the raster (T21.s0, 2026-10-27). A chord along the ring's long axis instead, a nib short
        ring = ref_ring(piece); c = ring.mean(0)
        v = np.linalg.eigh(np.cov((ring - c).T))[1][:, -1]; t = (ring - c) @ v
        half = max(np.ptp(t) - pen, 0.2 * np.ptp(t)) / 2
        a = best[0][0]["angle"] if best else 45.0
        best = ([{"p": [round(float(x), 3) for x in (c + k * half * v - O) / PPN], "angle": a} for k in (-1, 1)], None)
    return best[0]


def angles(nodes, piece, O, ignore, pen=PEN):
    """The two best single nib angles for this path, at least 30 degrees apart."""
    sc = sorted(((gpu_score([[{**n, "angle": a, "width": 1} for n in nodes]], [piece], O, PPN, pen, ignore)["iou"], a)
                 for a in range(0, 180, 10)), reverse=True)
    out = [sc[0][1]]
    for _, a in sc[1:]:
        if min(abs(a - out[0]), 180 - abs(a - out[0])) >= 30:
            out.append(a); break
    return out


def lifts(nodes):
    """Where the width falls at each end: how far from the end it is below 0.95 of the stroke's widest, and how low."""
    w = np.array([n.get("width", 1) for n in nodes]); P = np.array([n["p"] for n in nodes])
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    top = w.max(); out = {}
    for end, idx in (("start", list(range(len(w)))), ("end", list(range(len(w) - 1, -1, -1)))):
        i = 0
        while i < len(idx) and w[idx[i]] < 0.95 * top:
            i += 1
        out[end] = {"nuqta": round(abs(arc[idx[i - 1]] - arc[idx[0]]), 2), "min": round(float(w[idx[0]] / top), 3)} if i else None
    return out


def ink(nodes_list, rings, O, x1, y1, r, H, W, pen=PEN):
    A = (gpufit.ink_masks(nodes_list, O, PPN, pen, (float(x1), float(y1), float(r), H, W)).cpu().numpy().astype(np.uint8)
         if nodes_list else np.zeros((H, W), np.uint8))
    to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * r * 16).astype(np.int32)  # noqa: E731
    B = np.zeros((H, W), np.uint8)
    for ring in rings:
        cv2.fillPoly(B, [to_px(ring)], 1, cv2.LINE_8, 4)
    return A, B


def picture(stroke, piece, ignore, O, old, new, pen=PEN, labels=("free fit", "pen", "sheet", "pen + sheet edge")):
    """free fit | pen | sheet | pen over the sheet's outline, the shape's other strokes pale behind, 60 px to the nuqta."""
    PX = 60; r = PX / PPN
    ring = ref_ring(piece); others = [ref_ring(p) for p in ignore]
    pts = np.concatenate([ring] + [gpufit._reach([n], O, PPN, PEN) for n in (old, new) if n])  # widths: of the main nib
    x1, y1 = pts.min(0) - PPN * 0.4; x2, y2 = pts.max(0) + PPN * 0.4
    W, H = int((x2 - x1) * r) + 1, int((y2 - y1) * r) + 1
    _, G = ink([], others, O, x1, y1, r, H, W)
    _, B = ink([], [ring], O, x1, y1, r, H, W)
    paper, inkc, pale = np.array((228, 240, 246)), np.array((40, 52, 66)), np.array((205, 210, 214))

    def panel(M):
        im = np.where(G[..., None] == 1, pale, paper).astype(np.uint8)
        im[M == 1] = inkc
        return im
    tiles = [panel(ink([n], [], O, x1, y1, r, H, W)[0] if n else np.zeros((H, W), np.uint8)) for n in (old, new)]
    tiles.append(panel(B))
    ov = panel(ink([new], [], O, x1, y1, r, H, W)[0])
    ov[cv2.morphologyEx(B, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0] = (40, 40, 220)
    tiles.append(ov)
    gap = np.full((H, 8, 3), 255, np.uint8)
    row = np.hstack(sum([[t, gap] for t in tiles], [])[:-1])
    if W < 200:
        row = cv2.resize(row, None, fx=200 / W, fy=200 / W, interpolation=cv2.INTER_NEAREST); W = 200
    head = np.full((52, row.shape[1], 3), 255, np.uint8)
    cv2.putText(head, stroke, (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 160), 1, cv2.LINE_AA)
    for i, lab in enumerate(labels):
        cv2.putText(head, lab, (i * (W + 8) + 4, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)
    ok, png = cv2.imencode(".png", np.vstack([head, row]))
    return base64.b64encode(png.tobytes()).decode()


def orient(stroke, nodes, O, piece):
    """A PEN_CUT half's path turned to run into the cut ("~c0") or out of it ("~c1"), its free end reaching on to the
    outline's farthest point from the cut, less END_BACK nuqta. The centre line stops short of a point thinner than the
    pen, so the pen began full width below the stroke's end spike and its corner stood out past the sheet (k2: 297.s1
    and 301.s1's right ends); from the spike, the end may narrow onto a corner up into it."""
    at = CUT_AT.get(stroke)
    if at is None:
        return nodes
    d0, d1 = (np.linalg.norm(np.array(nodes[i]["p"]) * PPN + O - at) for i in (0, -1))
    nodes = nodes[::-1] if (d0 < d1) == stroke.endswith("~c0") else nodes
    ring = ref_ring(piece)
    i = 0 if stroke.endswith("~c0") else -1  # the free end
    end = np.array(nodes[i]["p"]) * PPN + O
    # on from the free end only, the way the path runs there: on 731.s0's S the outline's farthest point from the head's
    # cut is the bowl's bottom, and the path ran from the tail's tip back down to it, which spun the nib at the tip (b731).
    # Every stroke fitted from 2026-11-02 on; fits approved before it keep the paths they were fitted with
    u = end - (np.array(nodes[1 if i == 0 else -2]["p"]) * PPN + O); u /= max(np.linalg.norm(u), 1e-9)
    near = ring[(np.linalg.norm(ring - end, axis=1) < END_REACH * PPN) & ((ring - end) @ u > 0)]
    if not len(near):
        return nodes
    far = near[np.linalg.norm(near - at, axis=1).argmax()]
    gap = np.linalg.norm(far - end)
    if gap <= END_BACK * PPN:
        return nodes
    q = far + (end - far) * (END_BACK * PPN / gap)
    new = {**nodes[i], "p": [round(float(v), 3) for v in (q - O) / PPN]}
    return [new] + nodes if i == 0 else nodes + [new]


def end_miss(nodes, piece, ignore, O, P, c, sub=4):
    """(out, short) within TRIM_NEAR nuqta of the point c (screen px): how far the stroke's ink lies outside the
    outline at most, and the outline's ink outside the stroke's (nuqta). Ink on a neighbour's ground is no miss, as in
    gpufit.window_worst."""
    from pieces import path_hulls
    m = TRIM_NEAR * PPN + 2 * P
    x1, y1 = c - m
    W = H = int(2 * m * sub) + 1
    to_px = lambda q: np.round((np.asarray(q) - [x1, y1]) * sub * 16).astype(np.int32)  # noqa: E731
    A, B, D = (np.zeros((H, W), np.uint8) for _ in range(3))
    for h in path_hulls(nodes, O, PPN, P, step=1.0):
        cv2.fillConvexPoly(A, cv2.convexHull(to_px(h)), 1, cv2.LINE_8, 4)
    cv2.fillPoly(B, [to_px(ref_ring(piece))], 1, cv2.LINE_8, 4)
    for p in ignore:
        cv2.fillPoly(D, [to_px(ref_ring(p))], 1, cv2.LINE_8, 4)
    yy, xx = np.mgrid[0:H, 0:W]
    near = np.hypot(xx - m * sub, yy - m * sub) <= TRIM_NEAR * PPN * sub
    o, u = near & (A == 1) & (B == 0) & (D == 0), near & (B == 1) & (A == 0)
    out = cv2.distanceTransform(1 - B, cv2.DIST_L2, 5)[o].max(initial=0) / sub / PPN
    short = cv2.distanceTransform(1 - A, cv2.DIST_L2, 5)[u].max(initial=0) / sub / PPN
    return float(out), float(short)


def trim_ends(stroke, nodes, piece, ignore, O, P, keep_start=False, step=TRIM_STEP, short=TRIM_SHORT):
    """The stroke's free hairline ends pulled back to where the outline's ink stops (the user, 2026-10-21, jdtip.py's
    rule; before the pick, 2026-10-29). An end drawn with the nib edge-on runs a hair past the outline's tip: the
    fitter's soft ink barely feels it, the judge's end window does, and a try that followed the whole stroke lost to
    one that missed its dip (290.s1 and 366.s0's right halves: 0.94 to 0.83, 0.947 to 0.902). The end node slides back
    along its segment TRIM_STEP nuqta at a time while that lessens the ink outside near the end; it stops where the
    outline's own ink would come uncovered by more than TRIM_SHORT, and after TRIM_MAX. A cut half's cut end stays.
    (nodes, nuqta pulled back at each end)."""
    ends = [0] if stroke.endswith("~c0") else [-1] if stroke.endswith("~c1") else [0, -1]
    if CUTWIN == "free" and stroke in CUT_AT:  # no window at the cut end, so its hair is trimmed here (347.s0, k10: the
        ends = [0, -1]                         # right half ran 0.4 nuqta on past the peak, the spike the user marked)
    if keep_start:  # PEN_LEAD's held start
        ends = [i for i in ends if i != 0]
    moved = {}
    for i in ends:
        j = 1 if i == 0 else -2
        if len(nodes) < 3:
            break
        d = np.array(nodes[i]["p"]) - np.array(nodes[j]["p"])
        travel = math.degrees(math.atan2(-d[1], d[0]))
        if abs(math.sin(math.radians(nodes[i]["angle"] - travel))) * nodes[i].get("width", 1) >= TRIM_HAIR:
            continue  # a broad end (a cap, a head) is the fit's: pulling it back cuts it short
        c = np.array(nodes[i]["p"]) * PPN + O
        o, s0 = end_miss(nodes, piece, ignore, O, P, c)
        back = 0.0
        while o > TRIM_TOL and back < TRIM_MAX - 1e-9 and len(nodes) > 2:
            t = [dict(q) for q in nodes]
            a, b = np.array(t[i]["p"]), np.array(t[j]["p"])
            L = np.linalg.norm(b - a)
            if L <= step:  # within a step of its neighbour: the end node goes, its angle and width kept
                keep = {x: t[i][x] for x in ("angle", "width") if x in t[i]}
                del t[i]; t[i].update(keep)
            else:
                t[i]["p"] = [round(float(v), 4) for v in a + (b - a) * step / L]
            to, ts = end_miss(t, piece, ignore, O, P, c)
            if ts > s0 + short or to > o - 0.002:  # past the outline's own end, or the ink outside is not this end's
                break
            nodes, o, back = t, to, back + step
        if back:
            moved["start" if i == 0 else "end"] = round(back, 2)
    return nodes, moved


def level_top(node, piece, O, pen_scale=1.0):
    """node moved straight down until its nib's top is level with the outline's highest point within LEAD_NEAR nuqta
    (never up). k13: the right half's trimmed end still stood 0.11 nuqta over 347.s0's peak, and the left half's top,
    held level with it, drew a square cap there. Widths in main nibs (pen_scale: the result's, to undo)."""
    ring = (ref_ring(piece) - O) / PPN
    p = np.array(node["p"], float)
    near = ring[np.linalg.norm(ring - p, axis=1) < LEAD_NEAR]
    if not len(near):
        return node
    half = node.get("width", 1) / pen_scale * PEN / 2 / PPN * abs(math.sin(math.radians(node["angle"])))
    y = max(p[1], near[:, 1].min() + half)
    return {**node, "p": [round(float(p[0]), 4), round(float(y), 4)]}


def led(nodes, lead):
    """A "~c1" start path for PEN_LEAD: the right half's last point (lead, its nodes, already levelled with the peak),
    then LEAD_STEP nuqta across; the path's own nodes within LEAD_SKIP of either go, and the path then only moves away.
    The nib starts at the path's own angle."""
    e = lead["nodes"][-1]
    a = np.array(e["p"], float); b = a + [LEAD_STEP, 0.0]
    rest = [q for q in nodes if min(np.linalg.norm(np.array(q["p"]) - a), np.linalg.norm(np.array(q["p"]) - b)) > LEAD_SKIP]
    ang = (rest or nodes)[0]["angle"]
    head = [{"p": [round(float(v), 4) for v in a], "angle": ang}, {"p": [round(float(v), 4) for v in b], "angle": ang}]
    d = lambda q: np.linalg.norm(np.array(q["p"]) - a)  # noqa: E731
    while len(rest) > 2 and d(rest[0]) >= d(rest[1]):  # the band wanders at the cut (347.s0: down, up, down): from
        rest = rest[1:]                                 # the held points the path only moves away
    while LEAD_STEP < 0 and len(rest) > 2 and rest[0]["p"][0] > b[0]:  # a move left: no path point back to its right
        rest = rest[1:]
    return head + rest


def followed(nodes, prev, P):
    """A PEN_FOLLOW start path: the full nib (P, screen px) at the move before's end angle, its bottom corner on that
    end's bottom corner, then the path's own nodes from LEAD_SKIP on, only moving away."""
    e = prev["nodes"][-1]
    down = lambda deg: (lambda v: v if v[1] >= 0 else -v)(np.array([math.cos(math.radians(deg)), -math.sin(math.radians(deg))]))  # noqa: E731
    bottom = np.array(e["p"]) + down(e["angle"]) * e.get("width", 1) * PEN / PPN / 2  # the end's corner lower on the page
    if FOLLOW_AT:
        bottom = np.array([float(v) for v in FOLLOW_AT.split(",")])
    ang = follow_angle(prev)
    a = bottom - down(ang) * P / PPN / 2
    rest = [q for q in nodes if np.linalg.norm(np.array(q["p"]) - a) > LEAD_SKIP]
    d = lambda q: np.linalg.norm(np.array(q["p"]) - a)  # noqa: E731
    while len(rest) > 2 and d(rest[0]) >= d(rest[1]):
        rest = rest[1:]
    while len(rest) > 1 and FOLLOW_ANG is not None and (rest[0]["p"][0] > a[0] or rest[0]["p"][1] > a[1]):  # up and left
        rest = rest[1:]
    head = [{"p": [round(float(v), 4) for v in a], "angle": ang}]
    if FOLLOW_HOLD > 0 and rest:  # a node FOLLOW_HOLD on towards the path, on the start's one angle (turns_of)
        u = np.array(rest[0]["p"]) - a; L = np.linalg.norm(u)
        if L > FOLLOW_HOLD * 1.2:
            head.append({"p": [round(float(v), 4) for v in a + u / L * FOLLOW_HOLD], "angle": ang, "held": True})
    return head + rest


def meet(stroke, nodes, prev, piece, ignore, O, P, windows):
    """PEN_MEET: nodes (widths in this move's nib P) with the first node the move before's end node, the others settled
    round it (positions and angles; widths as fitted, the start held), then the tail trimmed on the finer rule. The
    settle never hands back worse than it is given (gpufit.refine). (nodes, score, nuqta trimmed)."""
    e = prev["nodes"][-1]
    n = [{**nodes[0], "p": list(e["p"]), "angle": e["angle"], "width": e.get("width", 1) * PEN / P}] + nodes[1:]
    windows = [(*e["p"], END_R * P / PEN)] + list(windows)  # the neck too: where the two moves meet
    for i in reversed(range(min(MEET_SPLIT, len(n) - 1))):  # from the last split back, so indices hold
        q, r_ = n[i], n[i + 1]
        n.insert(i + 1, {"p": [round((q["p"][k] + r_["p"][k]) / 2, 4) for k in (0, 1)], "angle": (q["angle"] + r_["angle"]) / 2,
                         "width": (q.get("width", 1) + r_.get("width", 1)) / 2})
    n, s = nrefine(n, [piece], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ignore, fixed=(0,), corner=MEET_CORNER,
                   windows=windows, widths_free=MEET_WIDTHS, judge="gpu")
    if MEET_WIDTHS:  # no wider than the nib (095's tail went to 1.2 of it, n095w2), then settled again on those widths
        n = [{**q, "width": min(q.get("width", 1), 1.0)} for q in n]
        n, s = nrefine(n, [piece], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ignore, fixed=(0,), corner=MEET_CORNER,
                       windows=windows, judge="gpu")
    n, moved = trim_ends(stroke, n, piece, ignore, O, P, keep_start=True, step=MEET_STEP, short=MEET_SHORT)
    s = nscore([n], [piece], O, PPN, P, ignore)
    s["window_worst"] = round(nworst(n, [piece], O, PPN, P, (), windows, ignore), 4)
    return n, s, moved


# PEN_MEET_SPLIT (n): the meet's first n segments each split at their midpoint before the settle: from the meeting
# point blue's first node was 0.28 nuqta on, and the edge under 095's neck could only run straight there (n095t)
MEET_SPLIT = int(os.environ.get("PEN_MEET_SPLIT", 0))
# PEN_MEET_WIDTHS=1: the settle moves the nib's widths too (gpufit's widths_free), the start's held: from green's end
# at 0.73 of the nib, blue widened to 0.88 over its first segment, and its underside stood out under 095's neck (n095s2)
MEET_WIDTHS = os.environ.get("PEN_MEET_WIDTHS", "0") == "1"
NUDGE_R, NUDGE_STEP = 0.04, 0.01  # nuqta: the tail tip's search (tail_nudge)
# degrees it may turn too: on 731's upright tail a 6 degree turn put a sliver of nib out along the tail's side (n731t)
NUDGE_DEG = int(os.environ.get("PEN_NUDGE_DEG", 6))
# PEN_NUDGE_W=1: the tip's search turns, fills and shifts the tail's end, faded in (tail_ramp): the studio's tail stays
# fuller to its tip than our taper, 095's underside 0.04 nuqta short over its last 0.23 (n095c; the user, 2026-11-02)
NUDGE_W = os.environ.get("PEN_NUDGE_W", "0") == "1"
# with NUDGE_W the tip turns up to CAP_DEG across the stroke, faded in over one of RAMP_L (tail_ramp)
CAP_DEG = 20
RAMP_L = (0.15, 0.25, 0.4)  # nuqta the tip's change fades in over (ramped)


def tail_nudge(nodes, piece, ignore, O, P):
    """The tail's last node moved up to NUDGE_R nuqta and turned up to NUDGE_DEG degrees, whichever leaves the least
    miss either way at the tip, measured at end_miss's fine raster: under a screen pixel, a tip the fitter cannot see
    (095's stood 0.035 nuqta high, 731's 0.02 short, after every settle; n095q5, n731q5, 2026-11-02). Kept only when
    the worse of out and short falls. With NUDGE_W, tail_ramp instead. (nodes, (out, short) before, after)."""
    c = np.array(nodes[-1]["p"]) * PPN + O
    m = lambda ns: end_miss(ns, piece, ignore, O, P, c)  # noqa: E731
    if NUDGE_W:
        return tail_ramp(nodes, m)
    best = (max(m(nodes)), nodes); before = m(nodes)
    k = int(round(NUDGE_R / NUDGE_STEP))
    for dx in range(-k, k + 1):
        for dy in range(-k, k + 1):
            if math.hypot(dx, dy) > k + 1e-9:
                continue
            for da in range(-NUDGE_DEG, NUDGE_DEG + 1, 2):
                e = nodes[-1]
                t = nodes[:-1] + [{**e, "p": [round(e["p"][0] + dx * NUDGE_STEP, 4), round(e["p"][1] + dy * NUDGE_STEP, 4)],
                                   "angle": e["angle"] + da}]
                v = max(m(t))
                if v < best[0] - 1e-4:
                    best = (v, t)
    return best[1], before, m(best[1])


def ramped(nodes, da, dw, dp, L):
    """nodes with a turn da (degrees), a width change dw (nibs, never past the nib) and a shift dp (nuqta) at the tip,
    each fading to nothing over the tail's last L nuqta, (1 - d/L) ** 2 of it at d nuqta back along the path: no node
    changes alone, so the edge keeps no step (a one-node turn left a step under 095's tail, n095k)."""
    P_ = np.array([q["p"] for q in nodes], float)
    back = np.r_[np.cumsum(np.linalg.norm(np.diff(P_, axis=0), axis=1)[::-1])[::-1], 0.0]
    out = []
    for q, d in zip(nodes, back):
        w = max(0.0, 1 - d / L) ** 2
        if w == 0:
            out.append(q); continue
        out.append({**q, "p": [round(float(q["p"][0] + dp[0] * w), 4), round(float(q["p"][1] + dp[1] * w), 4)],
                    "angle": float(q["angle"] + da * w), "width": round(float(min(q.get("width", 1) + dw * w, 1.0)), 4)})
    return out


def tail_ramp(nodes, m):
    """PEN_NUDGE_W: the studio's tails end in a blunt cut 0.07 to 0.1 nuqta across where ours ran to a needle (the
    user, 2026-11-02, "=" on all of them): a turn, a fuller nib and a shift at the tip, faded in over the tail's last
    stretch (ramped), searched in turn twice; kept only when the worse of out and short falls."""
    before = m(nodes); best = (max(before), (0.0, 0.0, (0.0, 0.0), RAMP_L[0]))
    for _ in range(2):
        da0, dw0, dp0, L0 = best[1]
        for L in RAMP_L:
            for da in range(-CAP_DEG, CAP_DEG + 1, 2):
                v = max(m(ramped(nodes, da, dw0, dp0, L)))
                if v < best[0] - 1e-4:
                    best = (v, (float(da), dw0, dp0, L))
        da0, dw0, dp0, L0 = best[1]
        for dw in (-0.1, 0.0, 0.1, 0.2, 0.3):
            v = max(m(ramped(nodes, da0, dw, dp0, L0)))
            if v < best[0] - 1e-4:
                best = (v, (da0, dw, dp0, L0))
        da0, dw0, dp0, L0 = best[1]
        k = int(round(NUDGE_R / NUDGE_STEP))
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                if math.hypot(dx, dy) > k + 1e-9:
                    continue
                dp = (dx * NUDGE_STEP, dy * NUDGE_STEP)
                v = max(m(ramped(nodes, da0, dw0, dp, L0)))
                if v < best[0] - 1e-4:
                    best = (v, (da0, dw0, dp, L0))
    out = ramped(nodes, *best[1][:3], best[1][3])
    return out, before, m(out)


# PEN_TAIL_FIT=1: polish ends with tail_fit. The user, 2026-11-02 ("=" on all of them): the studio's tails end in a
# blunt knob 0.03 to 0.1 nuqta deep where ours ran to a needle, and neither the whole-stroke settle nor a search at the
# tip (tail_nudge, tail_ramp: under 0.01 nuqta gained, n095r..n086r) moved it: against the whole stroke the knob's
# area hardly counts. The fitter's grid sees it (200 px to the nuqta); it needed the score to be the tail's alone
TAIL_FIT = os.environ.get("PEN_TAIL_FIT", "0") == "1"
TAIL_R, TAIL_L = 0.6, 0.6  # nuqta: the studio's ink judged within TAIL_R of the tip; nodes within TAIL_L of it move
TAIL_SMOOTH = os.environ.get("PEN_TAIL_SMOOTH", "0") == "1"  # the moved widths evened, from the last held node's to
                                                             # the tip's, before the positions settle (086: a waist)
TAIL_SEED = os.environ.get("PEN_TAIL_SEED", "0") == "1"  # the tip started blunt and at the outline's far end (095)
TAIL_SEED_W = float(os.environ.get("PEN_TAIL_SEED_W", 0.9))
TAIL_WFREE = os.environ.get("PEN_TAIL_WFREE", "1") == "1"  # 0: widths held, the nib narrows its line by turning only
TAIL_SPLIT = os.environ.get("PEN_TAIL_SPLIT", "1") == "1"
TAIL_TRIED_NODES = None
TAIL_TRIED = None  # the refit's (out, short), kept or not


def tail_piece(piece, c, R):
    """piece's outline clipped to the disc of R screen px round c, as a piece in screen px (None if it misses)."""
    ring = ref_ring(piece); sub = 8
    x1, y1 = c - R - 2
    W = H = int((2 * R + 4) * sub) + 1
    M = np.zeros((H, W), np.uint8)
    cv2.fillPoly(M, [np.round((ring - [x1, y1]) * sub * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    D = np.zeros_like(M); cv2.circle(D, (int((c[0] - x1) * sub), int((c[1] - y1) * sub)), int(R * sub), 1, -1)
    cs, _ = cv2.findContours(M & D, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    hv = max(cs, key=cv2.contourArea)[:, 0] / sub + [x1, y1]
    return [(1.0, 1.0, 0.0, 0.0), "M " + " L ".join("%.4f %.4f" % (x, y) for x, y in hv) + " Z"]


def tail_fit(nodes, piece, ignore, O, P):
    """The tail refitted against its own ink: the studio's outline within TAIL_R of the tip is the reference, the rest
    of the stroke's outline neither right nor wrong (an ignore piece; ink out past the outline still costs), and only the
    nodes within TAIL_L of the tip move, their widths too, then no wider than the nib and settled again on those widths
    (meet's rule). The last two segments are split first, for the knob's bend. Kept only when the worse of out and short
    at the tip (end_miss) falls. (nodes, (out, short) before, after)."""
    c = np.array(nodes[-1]["p"]) * PPN + O
    m = lambda ns: end_miss(ns, piece, ignore, O, P, c)  # noqa: E731
    before = m(nodes)
    tp = tail_piece(piece, c, TAIL_R * PPN)
    if tp is None:
        return nodes, before, before
    n = [dict(q) for q in nodes]
    if TAIL_SEED:  # a needle has no slope toward a knob: the tip set wide, out to the outline's farthest ink that way
        a, b = np.array(n[-2]["p"]), np.array(n[-1]["p"]); u = (b - a) / np.linalg.norm(b - a)
        rg = (ref_ring(piece) - O) / PPN; rg = rg[np.linalg.norm(rg - b, axis=1) <= TAIL_R]  # the tail's own ink only
        far = max(float(((rg - b) @ u).max(initial=0.0)) - TAIL_SEED_W * P / PPN / 2, 0.0)
        n[-1] = {**n[-1], "p": [round(float(v), 4) for v in b + u * far], "width": max(n[-1].get("width", 1), TAIL_SEED_W)}
    for i in (len(n) - 2, len(n) - 3):
        if i >= 0 and TAIL_SPLIT:
            q, r_ = n[i], n[i + 1]
            n.insert(i + 1, {"p": [round((q["p"][k] + r_["p"][k]) / 2, 4) for k in (0, 1)],
                             "angle": (q["angle"] + r_["angle"]) / 2, "width": (q.get("width", 1) + r_.get("width", 1)) / 2})
    P_ = np.array([q["p"] for q in n], float)
    back = np.r_[np.cumsum(np.linalg.norm(np.diff(P_, axis=0), axis=1)[::-1])[::-1], 0.0]
    fixed = tuple(i for i in range(len(n)) if back[i] > TAIL_L)
    ign = list(ignore) + [piece]
    t = n
    if TAIL_WFREE:
        t, _ = nrefine(n, [tp], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ign, fixed=fixed, widths_free=True, judge="gpu")
    t = [{**q, "width": min(q.get("width", 1), 1.0)} for q in t]
    if TAIL_SMOOTH and fixed:
        k = fixed[-1]; w0, w1 = t[k].get("width", 1), t[-1]["width"]
        d = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff([q["p"] for q in t[k:]], axis=0), axis=1))]
        for j in range(k + 1, len(t)):
            t[j] = {**t[j], "width": w0 + (w1 - w0) * d[j - k] / d[-1]}
    t, _ = nrefine(t, [tp], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ign, fixed=fixed, judge="gpu")
    after = m(t)
    global TAIL_TRIED, TAIL_TRIED_NODES
    TAIL_TRIED, TAIL_TRIED_NODES = [round(x, 3) for x in after], t
    return (t, before, after) if max(after) < max(before) - 1e-4 else (nodes, before, before)


# PEN_SETTLE (JSON, {"162.s1": its pen.json record}): a whole fitted stroke taken as it is, its segments split
# SETTLE_SPLIT times, then settled with the widths free (no wider than the nib) and again on those widths: the
# catalogue's long S strokes and alif stems ran 0.02-0.05 nuqta past the studio's edge along one side, with the nib
# held near full width by the fit (the user, 2026-11-03: the spill group).
SETTLE = json.loads(os.environ.get("PEN_SETTLE", "{}"))
SETTLE_SPLIT = int(os.environ.get("PEN_SETTLE_SPLIT", 1))


def settle(stroke, rec, log):
    piece, ignore, O = job_of(stroke)
    ps = rec.get("pen_scale", 1.0); P = PEN * ps
    n = [{**q, "width": q.get("width", 1) / ps} for q in rec["nodes"]]
    for _ in range(SETTLE_SPLIT):
        m = [n[0]]
        for q, r_ in zip(n, n[1:]):
            m += [{"p": [round((q["p"][k] + r_["p"][k]) / 2, 4) for k in (0, 1)], "angle": (q["angle"] + r_["angle"]) / 2,
                   "width": (q.get("width", 1) + r_.get("width", 1)) / 2}, r_]
        n = m
    windows = end_windows(n, P, stroke)
    n, s = nrefine(n, [piece], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ignore, windows=windows, widths_free=True, judge="gpu")
    n = [{**q, "width": min(q.get("width", 1), 1.0)} for q in n]
    n, s = nrefine(n, [piece], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ignore, windows=windows, judge="gpu")
    n, moved = trim_ends(stroke, n, piece, ignore, O, P)
    s = nscore([n], [piece], O, PPN, P, ignore)
    s["window_worst"] = round(nworst(n, [piece], O, PPN, P, (), windows, ignore), 4)
    log(stroke, "settle", rec["score"]["iou"], rec["score"]["gap95"], "->", s["iou"], s["gap95"])
    p = [{**q, "width": round(q.get("width", 1) * ps, 4)} for q in n]
    return {**rec, "nodes": p, "score": s, "lifts": lifts(p), "trim": moved or None, "settle": {"before": rec["score"]}}


def polish(stroke, rec, prev, log):
    """PEN_POLISH: rec's nodes, their free end run back out by the nuqta its trim took, then met (meet)."""
    piece, ignore, O = job_of(stroke)
    ps = rec.get("pen_scale", 1.0); P = PEN * ps
    n = [{**q, "width": q.get("width", 1) / ps} for q in rec["nodes"]]
    back = (rec.get("trim") or {}).get("end", 0.0)
    if back:
        a, b = np.array(n[-2]["p"]), np.array(n[-1]["p"])
        n[-1] = {**n[-1], "p": [round(float(v), 4) for v in b + (b - a) / np.linalg.norm(b - a) * back]}
    if POLISH_MEET:
        p, s, moved = meet(stroke, n, prev, piece, ignore, O, P, end_windows(n, P, stroke))
    else:  # the tail alone: an approved move's start where it was approved (075, 086)
        p, moved = trim_ends(stroke, n, piece, ignore, O, P, keep_start=True, step=MEET_STEP, short=MEET_SHORT)
    p, b, a = (tail_fit if TAIL_FIT else tail_nudge)(p, piece, ignore, O, P)
    s = nscore([p], [piece], O, PPN, P, ignore)
    log(stroke, "tail nudge", b, "->", a)
    log(stroke, "polish", rec["score"]["iou"], rec["score"]["gap95"], "->", s["iou"], s["gap95"], "untrim", back, "trim", moved)
    p = [{**q, "width": round(q.get("width", 1) * ps, 4)} for q in p]  # main-nib widths, as fit's
    return {**rec, "nodes": p, "score": s, "lifts": lifts(p), "trim": moved or None,
            "polish": {"before": rec["score"], "untrim": back, "tip": [round(x, 3) for x in a], "tip_before": [round(x, 3) for x in b],
                       "tried": TAIL_TRIED, "tried_nodes": TAIL_TRIED_NODES and [{**q, "width": round(q.get("width", 1) * ps, 4)} for q in TAIL_TRIED_NODES]}}


def follow_angle(prev):
    return FOLLOW_ANG if FOLLOW_ANG is not None else prev["nodes"][-1]["angle"]


def joint_refit(base, res, log):
    """PEN_JOINT: res[base~c0], res[base~c1] refitted in turn against base's whole outline, each with the other's ink."""
    piece, ignore, O = job_of(base)
    whole = lambda a, b, P_: gpu_score([a, [{**q, "width": q.get("width", 1) * PEN / P_} for q in b]], [piece], O, PPN, P_, ignore)  # noqa: E731
    for h, o in (("~c0", "~c1"), ("~c1", "~c0")):
        me, other = res[base + h], res[base + o]
        P = PEN * me["pen_scale"]
        mine = [{**q, "width": q.get("width", 1) / me["pen_scale"]} for q in me["nodes"]]   # widths in this half's nib
        oth = [{**q, "width": q.get("width", 1) * PEN / P} for q in other["nodes"]]
        free = 0 if h == "~c0" else -1
        win = [(*mine[free]["p"], END_R * P / PEN)]
        lift = LIFT_LONG if length(mine) >= LONG else LIFT
        pens = [{"angle": [q["angle"] for q in mine], "lift_start": lift, "lift_end": lift, "anchor": list(anc), "size": False,
                 "turns": list(range(1, len(mine)))} for anc in ([me["anchor"]] if me.get("anchor") else ANCHORS)]
        before = gpu_score([mine, oth], [piece], O, PPN, P, ignore)
        res_ = gpufit.refine_pens(with_tips(mine), [piece], O, PPN, P, pens, rough=ROUGH, edge=EDGE, ignore=ignore,
                                  others=[oth], corner=CORNER, windows=win, judge="gpu",
                                  schedules=(0 if length(mine) >= SHORT else 1,))
        p, s = max(res_, key=lambda t: judge(t[1]))
        log(base + h, "joint: whole", before["iou"], before["gap95"], "->", s["iou"], s["gap95"])
        if s["iou"] >= before["iou"] - 1e-4:
            res[base + h] = {**me, "nodes": [{**q, "width": round(q.get("width", 1) * me["pen_scale"], 4)} for q in p],
                             "joint": {"before": before, "after": s}}
    return res


def fit(stroke, log, size=None, lead=None, follow=None):
    """size: a nib size, in main nibs, the stroke is held to (a PEN_CUT half after its other half); else it may move.
    lead: the right half's result, when PEN_LEAD starts this left half from its end (led)."""
    t0 = time.time()
    piece, ignore, O = job_of(stroke)
    _next[0] = next_of(stroke)  # PEN_NEXT: the letter before, its ink on the page
    _turn[0] = (TURN_ON and stroke in CUT_AT) or stroke in TURNS  # every refine of this stroke, set again by the next fit
    _hold[0] = follow_angle(follow) if follow else None
    hair = "~h" in stroke  # a tip-drawn hairline of a PEN_SPLIT stroke: the small pen, filled
    fill = stroke in FILL or hair
    # a mark narrower than the nib cannot be the main pen's: it is a small-pen mark (T21.s0, 0.56 nuqta to a 0.82 nib)
    narrow = float(np.ptp(ref_ring(piece), 0).max()) < PEN
    small = stroke in SMALL or hair or narrow
    P = PEN * SMALL_PEN if small else PEN * size if size else PEN   # this stroke's nib, screen px
    r_old = None if hair or stroke in SPLIT else old_fit(stroke)  # a free fit of the whole outline fits no part
    starts = [("walk" if hair else "band", orient(stroke, band_start(piece, O, ignore, P, hair), O, piece))]
    tooth = None if hair else tooth_start(piece, O, starts[0][1], P)
    if tooth:
        starts.append(("tooth", tooth))
    if stroke in WALK and not hair:  # a curl the band's path stops short of: the walk goes on round it
        starts.append(("walk", orient(stroke, band_start(piece, O, ignore, P, hair=True), O, piece)))
    if stroke in GIVEN:  # PEN_START: a path put together by hand (484: one walk's loop, another's curl)
        starts.append(("given", [{"p": n["p"], "angle": n["angle"]} for n in GIVEN[stroke]]))
    if r_old:
        starts.append(("free", [{"p": n["p"], "angle": n["angle"]} for n in r_old["nodes"]]))
    held = ()
    if lead:  # every start behind the held start; a free fit's path is the whole outline's, no half's
        starts = [(n_, led(ns, lead)) for n_, ns in starts if n_ != "free"]
        held = (0, -1)  # the start and the tail's end (PEN_LEAD)
        log(stroke, "lead: held start", starts[0][1][0]["p"], "then", starts[0][1][1]["p"])
    if follow:  # PEN_FOLLOW: every start from the move before's end
        starts = [(n_, followed(ns, follow, P)) for n_, ns in starts if n_ != "free"]
        held = (0,)
        log(stroke, "follow: held start", starts[0][1][0]["p"], "angle", round(_hold[0], 1))
    tried = []

    def kept(p, s, nodes):
        """A try as it will be kept: its hairline ends trimmed (trim_ends) and scored again, against the end windows of
        its start path (nodes), so a trim that uncovers the outline's own end shows as a miss. Then {"raw": score
        untrimmed, "trim": nuqta pulled back} when the trim moved anything."""
        if not TRIM:
            return p, s, {}
        # a PEN_NEXT join end runs under the letter before: ink on its outline is no overshoot to trim
        t, moved = trim_ends(stroke, p, piece, ignore + ([_next[0][0]] if _next[0] else []), O, P, keep_start=bool(held))
        if not moved:
            return p, s, {}
        ts = nscore([t], [piece], O, PPN, P, ignore)
        ts["window_worst"] = round(nworst(t, [piece], O, PPN, P, (), end_windows(nodes, P, stroke), ignore), 4)
        return t, ts, {"raw": s, "trim": moved}
    if fill:
        for sname, nodes in starts:
            p, s = nrefine(with_tips(nodes), [piece], O, PPN, P, rough=ROUGH, edge=EDGE, ignore=ignore, widths_free=True,
                                 corner=CORNER, windows=end_windows(nodes, P, stroke), judge="gpu")
            p, s, raw = kept(p, s, nodes)
            tried.append({"start": sname, "angle0": None, "anchor": None, "score": s, "nodes": p, "pen": None, **raw})
            log(stroke, "fill", sname, s["iou"], s["gap95"], "%.0fs" % (time.time() - t0))
    def pen_of(nodes, a, anc):
        lift = LIFT_LONG if length(nodes) >= LONG else LIFT
        # a held start is the full nib: let narrow, 347.s0's left half began 0.14 nuqta under the peak's shoulder (k16)
        le = 0.0 if stroke in FULLEND else lift
        if follow:  # PEN_FOLLOW: the start node begins at the held angle (the fit turns the nib a few degrees a step, and
            P0 = np.array(nodes[0]["p"])  # every node of the held stretch (PEN_FOLLOW_HOLD) starts there too
            a = [float(_hold[0]) if i == 0 or np.linalg.norm(np.array(q["p"]) - P0) < FOLLOW_HOLD else float(x)
                 for i, (q, x) in enumerate(zip(nodes, np.broadcast_to(a, len(nodes))))]  # from 50 it stayed at 99, f3g)
            le = min(le, length(nodes) / 2)  # a short move's end zone reached back over its start and narrowed it
        return {"angle": a, "lift_start": 0.0 if (held and LEAD_FULL) or stroke in FULLSTART else lift, "lift_end": le, "anchor": list(anc), "size": SIZE and not size,
                **({"turns": turns_of(nodes)} if ROTATE else {})}

    def turns_of(nodes):  # each node turns on its own, but none within FREEHOLD_L of a PEN_FREEHOLD half's free end
        ts = [i for i in range(1, len(nodes)) if not nodes[i].get("held")]  # PEN_FOLLOW_HOLD's node: the start's angle
        if stroke not in FREEHOLD or stroke not in CUT_AT:
            return ts
        P_ = np.array([q["p"] for q in nodes]); arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P_, axis=0), axis=1))]
        if stroke.endswith("~c0"):  # free end first: one angle up to the first node past FREEHOLD_L
            return [i for i in ts if arc[i] > FREEHOLD_L]
        return [i for i in ts if arc[i - 1] < arc[-1] - FREEHOLD_L]

    def flick_of(nodes, a, anc):  # one angle, the start narrowing onto a corner over as much of the stroke as it needs
        return {"angle": a, "lift_start": length(nodes), "lift_end": LIFT, "anchor": list(anc), "size": SIZE and not size}

    def run_pens(sname, nodes, pens, flick=False):
        """Every pen side by side in one loop on the card (gpufit.refine_pens; the user, 2026-10-26: "make that change
        for the diwani branch as well"), with this start's schedule; each try goes into tried."""
        sched = 0 if length(nodes) >= SHORT else 1
        res = nrefine_pens(with_tips(nodes), [piece], O, PPN, P, pens, rough=ROUGH, edge=EDGE, ignore=ignore, fixed=held,
                                 schedules=(sched,), corner=CORNER, windows=end_windows(nodes, P, stroke), judge="gpu")
        for pen, (p, s) in zip(pens, res):
            a, anc = pen["angle"], pen["anchor"]
            p, s, raw = kept(p, s, nodes)
            tried.append({"start": sname, "angle0": a, "anchor": anc, "score": s, "nodes": p, "pen": pen, "flick": flick, **raw})
            log(stroke, sname + (" flick" if flick else ""), a if np.isscalar(a) else "own" if len(set(a)) > 1 else a[0], anc, s["iou"], s["gap95"], raw.get("trim", ""), "%.0fs" % (time.time() - t0))

    # a cut half tries all four anchor pairs on every angle: the short way to the cut ends on the other corner, and a
    # pruned search would only find it on the leading angle
    prune = PRUNE and ROTATE and stroke not in CUT_AT
    for sname, nodes in ([] if fill else starts):
        starts_a = angles(nodes, piece, O, ignore, P)
        if ROTATE:  # the start path's own angles too, each node turning on its own
            starts_a = [[q["angle"] for q in nodes]] + [[a] * len(nodes) for a in starts_a]
        run_pens(sname, nodes, [pen_of(nodes, a, anc) for a in starts_a for anc in (ANCHORS[:1] if prune else ANCHORS)])
        if FLICK and stroke in CUT_AT and stroke.endswith("~c0"):
            run_pens(sname, nodes, [flick_of(nodes, a, anc) for a in angles(nodes, piece, O, ignore, P) for anc in ANCHORS],
                     flick=True)
            # a loop on the card holds only tries with the same turns and lift zones: the turning flick runs apart
            run_pens(sname, nodes, [{**pen_of(nodes, [q["angle"] for q in nodes], anc), "lift_start": length(nodes)}
                                    for anc in ANCHORS], flick=True)
    if prune and not fill and tried:  # the other three anchor pairs, for the leading start and angle only (a fill has none)
        lead = max((c for c in tried if not c.get("flick")), key=lambda c: judge(c["score"]))
        nodes = dict(starts)[lead["start"]]
        run_pens(lead["start"], nodes, [pen_of(nodes, lead["angle0"], anc) for anc in ANCHORS[1:]])
    best = max(tried, key=lambda c: judge(c["score"]))
    if best["score"]["iou"] == 0:  # every try left the sheet's ink: no fit, and nothing sane to draw a picture from
        raise RuntimeError(f"{stroke}: no try touched the sheet's ink")
    if best["pen"] is not None:  # the other schedule, from the same start (a restart: the lift does not carry over)
        nodes = dict(starts)[best["start"]]
        other = 1 - (0 if length(nodes) >= SHORT else 1)
        (p, s), = nrefine_pens(with_tips(nodes), [piece], O, PPN, P, [best["pen"]], rough=ROUGH, edge=EDGE, ignore=ignore, fixed=held,
                                     schedules=(other,), corner=CORNER, windows=end_windows(nodes, P, stroke), judge="gpu")
        p, s, raw = kept(p, s, nodes)
        log(stroke, "other schedule", s["iou"], s["gap95"], raw.get("trim", ""))
        if judge(s) > judge(best["score"]):
            best = {k: v for k, v in best.items() if k not in ("raw", "trim")}
            best = {**best, "nodes": p, "score": s, "schedule": other, **raw}
    if follow and stroke in MEET:  # PEN_MEET: the start is the move before's end, the rest settled round it
        p, s, moved = meet(stroke, best["nodes"], follow, piece, ignore, O, P, end_windows(dict(starts)[best["start"]], P, stroke))
        log(stroke, "meet", best["score"]["iou"], best["score"]["gap95"], "->", s["iou"], s["gap95"], moved)
        best = {**best, "nodes": p, "score": s, "meet": {"before": best["score"], "trim": moved}}
    if stroke.endswith("~c0") and stroke[:-3] in LEAD and best["pen"] is not None:  # its end level with the peak
        lv = [level_top(q, piece, O, PEN / P) for q in best["nodes"]]  # k16: the next to last stood over the peak too
        if lv != best["nodes"]:
            s = nscore([lv], [piece], O, PPN, P, ignore)
            s["window_worst"] = round(nworst(lv, [piece], O, PPN, P, (), end_windows(dict(starts)[best["start"]], P, stroke), ignore), 4)
            log(stroke, "lead: end levelled", best["nodes"][-1]["p"], "to", lv[-1]["p"], s["iou"], s["gap95"])
            best = {**best, "nodes": lv, "score": s}
    n = best["nodes"]
    # the best by overlap alone, when it beats the judge's choice by ALT_GAP: drawn too, for the user to choose between
    # (113.s2 in trial four: the spiral at 0.87 lost to a hook at 0.76 on its end's worst miss)
    alt = max(tried, key=lambda c: c["score"]["iou"])
    alt = alt if alt["score"]["iou"] > best["score"]["iou"] + ALT_GAP else None
    cpu = score([n], [piece], O, PPN, P, ignore)
    if P != PEN:  # widths as fractions of the main nib, so the stroke draws with the one pen
        n = [{**q, "width": round(q.get("width", 1) * P / PEN, 4)} for q in n]
    an = alt and [{**q, "width": round(q.get("width", 1) * P / PEN, 4)} for q in alt["nodes"]]
    out = {"recipe": ("small pen" if small else "pen") if best["pen"] else "fill", "nodes": n, "score": best["score"],
           "cpu_score": cpu, "pen_scale": round(P / PEN, 4), "start": best["start"], "anchor": best["anchor"], "prune": prune,
           "angle": round(n[len(n) // 2]["angle"] % 180, 1),
           "angles": [round(min(q["angle"] for q in n), 1), round(max(q["angle"] for q in n), 1)],
           "size": round(max(q.get("width", 1) for q in n), 3), "length": round(length(n), 2), "lifts": lifts(n), "trim": best.get("trim"), "meet": best.get("meet"),
           "free": {"score": r_old["score"]} if r_old else None,
           "alt": {"score": alt["score"], "anchor": alt["anchor"], "start": alt["start"], "nodes": an} if alt else None,
           "tried": [{k: (v if k != "pen" or not v else {**v, "angle": "own" if len(set(np.atleast_1d(v["angle"]))) > 1 else float(np.atleast_1d(v["angle"])[0])}) for k, v in c.items() if k != "nodes"} for c in tried], "seconds": round(time.time() - t0)}
    pics = {stroke: picture(stroke, piece, ignore, O, r_old["nodes"] if r_old else None, n)}  # n in main-nib widths
    if alt:
        pics[stroke + ".alt"] = picture(stroke, piece, ignore, O, n, an,
                                        labels=("judge's pick", "best overlap", "sheet", "best overlap + sheet edge"))
    return out, pics



# PEN_THROUGH ("1", with PEN_NEXT): the exit stroke and the entry stroke fitted as one pen movement through the join,
# then split back into the two strokes where they meet (the user, 2026-10-29: "The pen should not lift at the joint ...
# it should be one continuous stroke"). Split, each letter keeps its own strokes, so a raised, dropped or stretched
# letter still carries its half. Counting the exit's ink as on the page and fitting the entry alone (PEN_NEXT alone)
# left the entry's start loose under the exit: a notch and hook at the ha->ya, a spike at the ha->mim (2026-10-31).
THROUGH = os.environ.get("PEN_THROUGH", "0") == "1"


def through_fit(entry, log):
    """{exit: ..., entry: ...}, each in its own frame and main-nib widths, from one refine over exit + entry."""
    t0 = time.time()
    x = NEXT[entry]; dx, dy = x["shift"]
    piece, ignore, O = job_of(entry)
    xp, xm, xn = next_of(entry)
    _next[0] = None
    xO = np.array(origin(x["exit"].split(".")[0]), float)
    refs, ign = [piece, xp], ignore + xm
    ring = (ref_ring(piece) - O) / PPN  # the exit's end nearer the entry's outline is the join: its path runs into it
    near = lambda q: np.linalg.norm(ring - q["p"], axis=1).min()  # noqa: E731
    if near(xn[0]) < near(xn[-1]):
        xn = xn[::-1]
    junction = np.array(xn[-1]["p"])
    exit_path = [{"p": q["p"], "angle": q["angle"]} for q in xn]
    starts = [("band", band_start(piece, O, ignore, PEN))]
    if x.get("entry_nodes"):
        starts.append(("fit", [{"p": q["p"], "angle": q["angle"]} for q in x["entry_nodes"]]))
    tried = []
    for sname, ns in starts:
        if np.linalg.norm(np.array(ns[0]["p"]) - junction) > np.linalg.norm(np.array(ns[-1]["p"]) - junction):
            ns = ns[::-1]
        ns = [q for q in ns if np.linalg.norm(np.array(q["p"]) - junction) > LEAD_SKIP] or ns
        dj = lambda q: np.linalg.norm(np.array(q["p"]) - junction)  # noqa: E731
        while len(ns) > 2 and dj(ns[0]) >= dj(ns[1]):  # from the join the path only moves away: a dip back is a hook
            ns = ns[1:]
        path = exit_path + ns
        k = len(exit_path) - 1  # the exit's last node: the split
        lift = LIFT_LONG if length(path) >= LONG else LIFT
        pens = [{"angle": [q["angle"] for q in path], "lift_start": lift, "lift_end": lift, "anchor": list(anc), "size": SIZE,
                 "turns": list(range(1, len(path)))} for anc in ANCHORS]
        res = gpufit.refine_pens(with_tips(path), refs, O, PPN, PEN, pens, rough=ROUGH, edge=EDGE, ignore=ign, corner=CORNER,
                                 windows=end_windows(path), judge="gpu", schedules=(0,))
        for pen, (p, s) in zip(pens, res):
            tried.append({"start": sname, "anchor": pen["anchor"], "score": s, "nodes": p, "k": k})
            log(entry, "through", sname, pen["anchor"], s["iou"], s["gap95"], "%.0fs" % (time.time() - t0))
    best = max(tried, key=lambda c: judge(c["score"]))
    n, k = best["nodes"], best["k"]
    back = lambda q: {**q, "p": [round(float(v), 4) for v in (np.array(q["p"]) * PPN + O - [dx, dy] - xO) / PPN]}  # noqa: E731
    # the exit runs one node on into the entry, under the entry's own ink: meeting at a single node left a hairline seam
    # where the two were drawn separately (join 7, 136.s0+105.s0, 2026-10-31)
    halves = {x["exit"]: [back(q) for q in n[:k + 2]], entry: n[k:]}
    out = {}
    for st, hn in halves.items():
        hp, hi, hO = job_of(st)
        out[st] = {"recipe": "pen", "nodes": hn, "score": gpu_score([hn], [hp], hO, PPN, PEN, hi), "through": entry,
                   "whole": best["score"], "start": best["start"], "anchor": best["anchor"], "lifts": lifts(hn),
                   "length": round(length(hn), 2), "seconds": round(time.time() - t0),
                   "tried": [{k_: v for k_, v in c.items() if k_ != "nodes"} for c in tried]}
        log(st, "through: own outline", out[st]["score"]["iou"], out[st]["score"]["gap95"])
    pics = {entry + ".through": picture(entry, piece, ign + [xp], O, None, n)}
    return out, pics

if __name__ == "__main__":
    od, names = sys.argv[1], sys.argv[2:]
    res, pics = {}, {}
    log = lambda *a: print(*a, flush=True)  # noqa: E731
    log("gpu", gpufit.available(), "pen px", round(PEN, 3), "ppn", PPN)
    def hairs(s):  # counted on the whole outline: job_of hands back the body, already split
        k, sid = s.split(".", 1)
        return len(split_piece([transform(k), dict(strokes(k))[sid]])[1])
    def bigger_first(s):  # a PEN_CUT stroke's halves, the bigger first: its size then holds the other
        h = sorted([f"{s}~c0", f"{s}~c1"], key=lambda h: -cv2.contourArea(ref_ring(job_of(h)[0]).astype(np.float32)))
        # PEN_LEAD starts the left half from the right half's end, so the right half must come first; where the left is
        # the bigger (301.s1, 309.s1, 312.s1), it is fitted first only to set the shared size, then again behind the
        # right half at that size (the smaller half setting the size bulged 297.s1, k1)
        return h + [h[0]] if s in LEAD and h[0].endswith("~c1") else h
    def three(s):  # a PEN_THREE stroke's moves, the biggest first: its size holds the others
        return sorted([f"{s}~c{i}" for i in range(3)], key=lambda h: -cv2.contourArea(ref_ring(job_of(h)[0]).astype(np.float32)))
    if THROUGH:  # each named stroke is an entry, fitted through its join with the exit (PEN_NEXT)
        for s in names:
            r_, p_ = through_fit(s, log); res.update(r_); pics.update(p_)
        json.dump(res, open(os.path.join(od, "pen.json"), "w"))
        json.dump(pics, open(os.path.join(od, "pics.json"), "w"))
        names = []
    if JOINT:  # the halves come fitted (PEN_JOINT_FROM); only the joint is finished here
        src = json.loads(os.environ["PEN_JOINT_FROM"])
        for s in [s for s in names if s in JOINT]:
            res.update({k: v for k, v in src.items() if k.split("~")[0] == s})
            joint_refit(s, res, log)
        names = [s for s in names if s not in JOINT]
        json.dump(res, open(os.path.join(od, "pen.json"), "w"))
        json.dump(pics, open(os.path.join(od, "pics.json"), "w"))
    sized = {}  # a PEN_CUT stroke's shared nib size, from its first fit
    for k_, v_ in KEEP.items():  # PEN_KEEP: approved moves, as fitted
        res[k_] = v_; sized.setdefault(k_.split("~")[0], v_["size"])
    for st in [p for s in names for p in ([s] + [f"{s}~h{i}" for i in range(1, hairs(s) + 1)] if s in SPLIT
                                          else [s] if "~" in s else three(s) if s in THREE else bigger_first(s) if s in CUT else [s])]:
        if st in KEEP:
            continue
        if st in SETTLE:  # PEN_SETTLE: taken as fitted, its widths settled
            res[st] = settle(st, SETTLE[st], log)
            json.dump(res, open(os.path.join(od, "pen.json"), "w"))
            json.dump(pics, open(os.path.join(od, "pics.json"), "w"))
            continue
        if st in POLISH:  # PEN_POLISH: taken as fitted, its start met to the move before's end
            res[st] = polish(st, POLISH[st], res[st[:-1] + str(int(st[-1]) - 1)], log)
            json.dump(res, open(os.path.join(od, "pen.json"), "w"))
            json.dump(pics, open(os.path.join(od, "pics.json"), "w"))
            continue
        base = st.split("~")[0]
        size = sized.get(base) if st.endswith(("~c0", "~c1", "~c2")) else None
        lead = st.endswith("~c1") and st[:-3] in LEAD and res.get(st[:-1] + "0")
        if lead and size is None:  # the bigger left half's first pass: no right half yet to start from
            lead = None
        prev = st in FOLLOW and res.get(st[:-1] + str(int(st[-1]) - 1))
        res[st], p = fit(st, log, size=size, lead=lead or None, follow=prev or None)
        if st.endswith(("~c0", "~c1", "~c2")) and base not in sized:
            sized[base] = res[st]["size"]
        pics.update(p)
        json.dump(res, open(os.path.join(od, "pen.json"), "w"))
        json.dump(pics, open(os.path.join(od, "pics.json"), "w"))
