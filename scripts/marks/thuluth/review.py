"""
Thuluth review tool: cleans a source sheet, cuts it into numbered pieces,
traces each one, and draws review sheets (the source crop beside the traced
outline). Nothing here writes the app's mark library: a piece moves there
only once the user approves it in REVIEW.md. See .claude/rules/marks.md.

    python3 -I scripts/marks/thuluth/review.py <sheet> <out_dir>

<sheet> is a key of SHEETS below. Writes <out_dir>/<sheet>-review-<n>.png
and <out_dir>/<sheet>-traced.json ({piece: {d, w, h}}).
"""
import json, os, re, sys
import numpy as np, cv2, potrace
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))


def nearer_to(px, py, r=3):
    """A split rule for two shapes joined only by guide lines: with those thin
    lines opened away (a disc r px across), each pixel goes to whichever
    remaining shape is nearer; True for the shape holding (px, py)."""
    def rule(xs, ys):
        x0, y0 = xs.min(), ys.min()
        m = np.zeros((ys.max() - y0 + 1, xs.max() - x0 + 1), np.uint8); m[ys - y0, xs - x0] = 1
        core = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))
        _, lab = cv2.connectedComponents(core, connectivity=8)
        mine = lab == lab[py - y0, px - x0]
        assert mine.any() and lab[py - y0, px - x0] > 0, ("point is not on a shape", px, py)
        dm = cv2.distanceTransform((~mine).astype(np.uint8), cv2.DIST_L2, 3)
        do = cv2.distanceTransform(((core > 0) & ~mine == 0).astype(np.uint8), cv2.DIST_L2, 3)
        return (dm <= do)[ys - y0, xs - x0]
    return rule

# One entry per sheet. `units`: piece number -> (name, box in source px),
# right to left, top to bottom. `splits`: a component touching two pieces,
# found by its bounding box's top-left, split by a pixel rule.
SHEETS = {
  "t1": {"file": "../thuluth-1.webp", "dot": 16, "units": {
    1: ("ا alif (measuring nuqtas)", (1540,190,1580,362)), 2: ("ا alif, smaller", (1490,190,1535,362)), 3: ("ك", (1330,165,1462,380)),
    4: ("ل lam (measuring nuqtas)", (1172,130,1330,382)), 5: ("لا", (1025,155,1160,384)), 6: ("ن nun, construction of 30 (measuring nuqtas)", (903,258,1072,384)),
    7: ("ر ra (overlaps 8)", (738,255,892,386)), 8: ("ب body of ba (overlaps 7)", (640,280,795,384)), 9: ("لا, large (same form as 14)", (476,170,672,384)),
    10: ("لا, small (same form as 15)", (452,265,512,368)), 11: ("د dal, construction (measuring nuqtas; 26 is the clean shape)", (320,222,418,366)), 12: ("ه ha, construction drawing of 23 (stroke numbers, measuring nuqtas, half nuqta)", (150,245,302,377)),
    13: ("ى", (46,232,150,378)), 14: ("لا, large (same form as 9)", (1412,468,1588,640)), 15: ("لا, small (same form as 10; told by the alif's hat stroke)", (1366,553,1420,645)),
    16: ("صـ", (1176,578,1326,656)), 17: ("ط / ظ ta/za, construction of 19 (measuring nuqtas)", (1034,482,1176,654)), 18: ("ض", (897,560,1014,658)),
    19: ("ط ta, the clean shape (17 is its construction)", (742,475,858,652)), 20: ("ب/ت/ث body, two forms superimposed", (497,530,720,650)), 21: ("ج/ح/خ alternate body", (322,495,470,672)),
    22: ("ق", (163,513,284,642)), 23: ("ه ha, the clean shape (trace this one; 12 is its construction)", (20,527,126,620)), 24: ("ك (small written note to remove)", (1440,755,1566,938)),
    25: ("ل", (1294,750,1420,944)), 26: ("د dal, the clean shape (11 and 27 are its construction)", (1146,808,1244,932)), 27: ("د dal, construction (measuring nuqtas; 26 is the clean shape)", (980,806,1110,932)),
    28: ("و waw tail (body without the head), measuring nuqtas", (866,818,990,930)), 29: ("ر ra body, a different form from 7 (measuring nuqtas)", (694,828,830,936)), 30: ("ن nun, the clean shape (6 is its construction)", (516,818,654,930)),
    31: ("ى/ي ya, three forms", (38,762,482,938)),
  }, "splits": {},
  # Per piece, what to erase from that piece only (leftovers the cleaner
  # can't tell from ink): a source-px box (x0, y0, x1, y1), a point (x, y)
  # that removes the whole separate bit it lands on, or "main", which keeps
  # only the piece's largest separate shape. 3: the end of a guide line
  # touching the right side of the kaf's barb (the user, 2026-10-17).
  "erase": {3: [(1444, 205, 1450, 221)]}},
  "t2": {"file": "../thuluth-2.webp", "dot": 15, "units": {
    1: ("ح standalone", (1305,95,1458,258)), 2: ("ح ج خ shared stroke", (1168,100,1300,258)),
    3: ("ك zinadi, standalone", (855,95,1122,245)), 4: ("ب long, standalone and final", (533,175,842,252)),
    5: ("ح almond (with dots?)", (390,123,522,225)), 6: ("ح almond, small", (256,150,366,223)),
    7: ("ح almond, large", (50,75,190,252)), 8: ("مـ start, small", (1505,430,1562,482)),
    9: ("م joined", (1296,402,1470,537)), 10: ("مـ start, joined", (1205,432,1275,492)),
    11: ("م standalone", (1042,405,1195,550)), 12: ("ه", (953,407,1040,502)), 13: ("ه", (852,410,935,490)),
    14: ("هـ tall, start", (738,408,828,515)), 15: ("ـهـ long, middle", (485,413,702,515)),
    16: ("لا", (392,415,442,507)), 17: ("لا", (224,337,400,508)), 18: ("ى", (73,405,202,545)),
    19: ("ح wrapped", (1452,627,1574,800)), 20: ("عـ head, start/join", (1322,700,1430,790)),
    21: ("ع", (1167,598,1314,820)), 22: ("ع wrapped", (1010,620,1145,830)), 23: ("صـ start", (869,693,968,766)),
    24: ("ص standalone", (690,640,840,820)), 25: ("ط", (543,587,690,800)), 26: ("ف fa without dots", (350,675,508,792)),
    27: ("ق without dots", (180,695,325,808)), 28: ("و", (48,694,148,798)),
  },
  # 3: the two blobs above the kaf's start are not part of the letter (the
  # user, 2026-10-17); a point picks out that separate bit. The box is a
  # stray tick rising from the top edge of the lower stroke (the user).
  "erase": {3: [(918, 130), (963, 178, 971, 185)]},
  "splits": {
    # ص's tail runs into ط's base: the loop and the low tail are the ص.
    (542, 586): (24, 25, lambda xs, ys: (xs >= 700) | ((ys >= 768) & (xs >= 595))),
  }},
  # Sheet 3 (mapped 2026-10-17): same pen as sheets 1 and 2 (about 16 px), so
  # the same scale. Names are provisional readings, for the user to confirm
  # in the end-of-tracing sweep. Numbers follow the cluster map
  # (sheet3-numbered.png); 1 is part of a written heading and 4 is the kaf's
  # small sign, traced with 3. 20 is two separate ha forms: 20 the right one,
  # 25 the left one.
  "t3": {"file": "../thuluth-3.webp", "dot": 16, "units": {
    2: ("ا alif", (1630,68,1678,252)), 3: ("ك kaf, upright, with its small kaf sign", (1495,70,1631,276)),
    5: ("ل lam", (1345,68,1484,290)), 6: ("لا two lam-alif forms, overlapping", (1104,46,1333,287)),
    7: ("ط ta", (935,75,1089,276)), 8: ("س seen, extended (stroke numbers 1-4)", (429,86,932,290)),
    9: ("و + ك waw and long kaf, joined (stroke numbers 1-3)", (47,101,432,297)),
    10: ("ر و د ra, waw, dal, joined (wrapped forms)", (1389,406,1671,558)),
    11: ("ر ra, extended", (1202,421,1350,570)), 12: ("و/م (to confirm), extended", (1128,419,1281,570)),
    13: ("م (to confirm), extended", (1021,434,1212,569)), 14: ("ر م ra and meem, raised, joined", (807,430,1048,570)),
    15: ("ص + ش sad with seen/shin teeth and measuring nuqtas", (405,411,819,575)),
    16: ("و ه ة waw, ha, ta marbuta, with measuring marks", (91,398,402,569)),
    17: ("و هـ ه waw, connected and standalone ha", (1307,661,1673,841)),
    18: ("ى ya", (1153,683,1304,842)), 19: ("ح ha, extended", (1001,702,1168,886)),
    20: ("ح ha (right of the pair)", (857,704,996,901)), 25: ("ح ha (left of the pair)", (705,704,857,901)),
    21: ("ع ain", (538,680,705,907)), 22: ("ـح final ha (stroke numbers, dotted guide)", (378,673,536,899)),
    23: ("ـح final ha (stroke numbers, dotted guide)", (226,664,378,896)),
    24: ("ـد ending dal (the user, 2026-10-17; stroke numbers 1-4)", (74,693,219,860)),
  }, "splits": {}},
  # Sheet 4, the alif (mapped 2026-10-17; sheet4-numbered.png). Numbers follow
  # the cluster map; written notes (6, 9, 12, 20-25) are skipped. The map
  # merged الله with the height-3 alif (now 10 and 26) and the worked line
  # with the second tah-alif (now 18 and 27). Names are provisional.
  "t4": {"file": "../thuluth-4.webp", "dot": 16, "units": {
    1: ("ا alif, standalone, length 1", (1566,99,1612,292)), 2: ("ا alif, standalone, length 2", (1480,97,1529,295)),
    3: ("ا alif, standalone, length 3", (1379,102,1434,314)), 4: ("ا arched alif, from Diwani", (1235,108,1336,308)),
    5: ("ا arched alif, full Diwani form", (1075,110,1190,309)), 7: ("ال the two alifs usable for the lam (الر)", (440,38,679,337)),
    8: ("الحر final alif joined to the first lam", (72,72,355,328)), 10: ("الله the alif in lafz al-jalala (dotted guide)", (767,112,990,335)),
    11: ("ا alif height 4 (heavy composed line)", (765,287,830,548)), 26: ("ا alif height 3 (light composed line)", (880,336,965,548)),
    15: ("ا alif height 2 (medium composed line)", (1009,337,1063,554)), 14: ("ا alif height 1 (single line)", (1111,351,1162,557)),
    13: ("ط tah alif (ألف الطاء)", (1459,387,1620,557)), 27: ("ط tah alif, Diwani-like variant", (1268,413,1410,562)),
    16: ("اعلما ain joined to a final alif (notes written inside)", (161,335,649,570)),
    18: ("يا غالباً غير مغلوب, the worked example line", (286,560,1500,872)),
  }, "splits": {},
  # Bits of the written notes left beside the letters, and on 18 the paired
  # dots under both ya letters and a small mark above the line (letters are
  # traced dotless). Each point removes the separate bit it lands on.
  "erase": {7: [(487,114), (465,150)], 8: [(131,184)], 10: [(856,121), (850,156)],
            16: [(357,406), (345,366), (369,361), (482,472), (493,439)],
            18: [(940,836), (1471,847), (1502,587)]}},
  # Sheet 5, dal and ra (mapped 2026-10-17; sheet5-numbered.png). Row 1 is
  # standalone letters with final forms; row 2 the dal; row 3 the ra, each
  # labelled on the sheet. Cluster 24 is a word in the notes, skipped.
  "t5": {"file": "../thuluth-5.webp", "dot": 16, "units": {
    1: ("ا alif (measuring marks)", (1602,27,1648,214)), 2: ("ا alif (guide lines)", (1525,35,1587,217)),
    3: ("د dal", (1406,85,1522,229)), 4: ("ى/ن final (guide lines)", (1243,69,1396,232)),
    5: ("ں nun body, dotless", (1115,106,1232,237)), 6: ("ن nun", (965,109,1096,232)),
    7: ("ز za", (878,98,953,244)), 8: ("ر ra, joined form with a flag head (arrow)", (714,101,881,243)),
    9: ("ر with a start, stroke numbers and a guide (to name)", (494,126,779,239)),
    10: ("و waw", (350,109,473,238)), 11: ("و waw, second form", (217,105,355,229)),
    12: ("ق qaf (measuring nuqtas)", (58,80,215,246)),
    13: ("د dal, form 1", (1472,450,1601,608)), 14: ("د dal, form 2", (1287,427,1451,605)),
    15: ("د dal, form 3", (1056,415,1217,587)), 16: ("د dal, form 4", (833,430,983,598)),
    17: ("د dal, extended end (مرسل): only in lines not composed", (646,418,820,603)),
    18: ("ن + د dal inside a nun: the nun is six nuqtas long", (434,396,613,589)),
    23: ("ر ra, rihaniya (الرهانية)", (1426,807,1592,914)), 19: ("ر ra, multawiya (الملتوية)", (1251,767,1379,902)),
    20: ("ر ra, mursala (المرسلة)", (1034,754,1197,908)), 21: ("ن + ر ra made small inside a nun", (825,689,1004,891)),
    22: ("ل + ر ra made small after a lam", (577,641,754,897)),
  }, "splits": {},
  # a word of the label beside each of 21 and 22
  "erase": {21: [(833,741)], 22: [(589,771)]}},
  # Sheet 6, lam and lam-alif (mapped 2026-10-17; sheet6-numbered.png). Pen
  # 14 px, so 48/14 units per px. Clusters 4-6, 9-12 and 22-25 are notes.
  "t6": {"file": "../thuluth-6.webp", "dot": 14, "unit": 48 / 14, "units": {
    1: ("ل lam: the alif plus the bowl of nun, qaf, sad, seen or ya", (1344,54,1487,283)),
    2: ("لا lam-alif: alif, the end of the final mursala ha, and the crooked alif", (1012,52,1151,277)),
    3: ("لا lam-alif starting with the crooked alif (with the zulf)", (633,52,850,248)),
    7: ("لا lam-alif cut short for a panel composition, zulf lengthened", (295,89,480,265)),
    8: ("لا the cut-short lam-alif, small example", (125,156,240,268)),
    13: ("فلا forced cases, mid-line or at the end; panels of limited size", (236,290,558,514)),
    14: ("لا braided lam-alif (ذات الظفيرة), Baghdadi", (1375,319,1514,549)),
    15: ("لا lam-alif for forced cases and line ends", (1084,314,1197,540)),
    16: ("لا lam-alif, second form", (744,314,868,544)),
    17: ("سلا lam-alif used only at the end", (1349,560,1578,795)),
    18: ("حلا lam-alif used only at the end", (1061,551,1251,791)),
    19: ("هول standalone mursala lam at the end of lines not composed", (608,568,969,799)),
    20: ("حل standalone mursala lam, second example", (526,546,755,773)),
    21: ("صلى the old rule's lam, for Muhaqqaq and Thuluth not composed", (98,538,520,791)),
  }, "splits": {},
  # note words beside these pieces: keep only each one's main shape
  "erase": {1: ["main"], 3: ["main"], 7: ["main"], 13: ["main"]}},
  # Sheet 7, the beh, three row images (mapped 2026-10-17;
  # sheet7-rowN-numbered.png). Pen 16 px on all three: the shared scale.
  # Row 1: the initial beh joined to ص ط غ ق م ر و ي, with measuring nuqtas
  # beside each pair ("main" drops them); its piece numbers are shapes after
  # cleaning, right to left.
  "t7r1": {"file": "../thuluth-7-row1.webp", "dot": 16, "units": {
    2: ("بص initial beh (two dots) joined to sad", (1209,34,1560,275)),
    3: ("بط initial beh (two dots) joined to ta", (1209,34,1400,275)),
    4: ("بغ initial beh with ghain", (1093,97,1240,305)), 5: ("ـق joined qaf body", (892,105,1090,258)),
    9: ("ـر joined ra", (739,109,886,243)), 10: ("بر initial beh with ra", (522,99,727,273)),
    13: ("ـو joined waw (like 5, with a waw for the qaf's body)", (451,106,581,251)), 15: ("بى initial beh with ya", (297,99,453,264)),
    19: ("ـى joined ya, the right one, with its bowl", (180,59,339,258)),
    20: ("ـى joined ya, the left one, long", (15,59,280,200)),
  },
  # The user's review (2026-10-17). 2 was two joins touching: the sad's tail
  # runs up into the ta's base stroke, so below that stroke it is the sad's
  # (2), above it the ta's (3). 19 was two joined ya forms touching the same
  # way: the right one (19) owns the bowl below the long stroke, the left
  # one (20) the long stroke.
  "splits": {
    (1213, 38): (2, 3, lambda xs, ys: (xs >= 1400) | (ys >= 202)),
    (19, 63): (19, 20, lambda xs, ys: (xs >= 275) | ((ys >= 186) & (xs >= 150))),
  },
  # Boxes and thin-line passes first, then "main" drops what they cut loose.
  "erase": {
    # nuqta stubs on the sad's tooth
    2: [(1404, 183, 1422, 230), (1415, 186, 1422, 208), "main"],
    3: [(1306, 199, 1318, 206), "main"],
    # beh with ghain: the guide lines down the left side and across and down
    # the right; the stray ticks beside the head
    4: [(1094, 172, 1100, 275), (1150, 183, 1256, 195), (1196, 179, 1256, 186), (1199, 186, 1213, 242),
        ("thin", 1110, 180, 1150, 200, 4), (1100, 120, 1111, 129), (1178, 118, 1192, 132), "main"],
    # qaf body: the line and nuqta to its right, the tick above the head, the
    # spur at the tail's tip
    5: [(1050, 145, 1090, 185), (1000, 137, 1032, 144), (1017, 142, 1030, 149), (1050, 128, 1058, 150), (893, 184, 900, 192), "main"],
    # joined ra: the line over the tooth, the guide tick on the join, the tail's spur
    9: [(853, 109, 864, 118), (840, 109, 846, 118), (861, 147, 868, 160), (767, 159, 778, 168), "main"],
    10: ["main"], 13: [(549, 112, 555, 118), "main"], 15: ["main"],
    19: [("thin", 182, 176, 208, 210, 4), "main"],
    20: [("thin", 20, 110, 85, 150, 3), (196, 177, 206, 196), "main"],
  }},
  "t7r2": {"file": "../thuluth-7-row2.png", "dot": 16, "units": {
    1: ("بى beh with ya (الباء مع الياء)", (1411,58,1579,238)),
    2: ("initial teeth for ب ت ث ن, form 1 (dotted alternate beside it)", (1214,120,1366,245)),
    3: ("initial teeth for ب ت ث ن, form 2", (1023,131,1190,235)), 4: ("initial teeth for ب ت ث ن, form 3", (844,134,1019,240)),
    5: ("initial teeth for ب ت ث ن, form 4", (673,132,842,236)), 6: ("ب beh body, long (to name)", (389,112,640,237)),
    7: ("بو beh with waw (to name)", (178,99,385,259)), 8: ("بو beh with waw, second (to name)", (30,60,222,246)),
  }, "splits": {}},
  "t7r3": {"file": "../thuluth-7-row3.png", "dot": 16, "units": {
    1: ("بص beh joined like sad (to name)", (1210,98,1515,269)), 2: ("بط beh with ta", (999,0,1232,224)),
    3: ("بم beh with meem (الباء مع الميم)", (729,55,972,241)),
    4: ("a seen-like run with a final ya and an upright (to name; dotted alternate head)", (11,0,688,226)),
  }, "splits": {}},
  # Sheet 8, initial beh of the ya type, three rows (mapped 2026-10-17;
  # sheet8-rowN-numbered.png). Pen 16 px. "main" drops the measuring nuqtas.
  "t8r1": {"file": "../thuluth-8-row1.png", "dot": 16, "units": {
    1: ("يـ initial beh of the ya type, alone (measuring marks)", (1450,92,1564,195)),
    2: ("بح beh of the ya type with ha (measuring marks)", (1290,44,1466,292)),
    3: ("بح beh of the ya type with ha, second", (1128,37,1286,288)),
    4: ("بمى beh of the ya type in a run ending in a long ya (to name)", (745,49,1113,229)),
    6: ("بر بن small-ya beh with ra and with nun, joined (map 5 and 6; to name)", (431,78,744,240)),
    7: ("بنه small-ya beh run (to name)", (267,114,440,222)), 8: ("بيم small-ya beh run with meem (to name)", (27,71,269,224)),
  }, "splits": {},
  # The user's review (2026-10-17): 1's spur; 7's top line, nuqtas and the
  # thin guide lines inside its ha; 8's guide lines at the tail's tip, at the
  # ha's join and under the bowl.
  "erase": {1: [(1497, 137, 1505, 143), "main"], 2: ["main"], 3: ["main"], 4: ["main"], 6: ["main"],
            7: [(280, 128, 345, 134), (294, 131, 326, 150), ("thin", 297, 150, 318, 198, 4), (290, 133, 296, 145), (283, 133, 286, 145), ("poly", [(292, 175), (301, 175), (301, 186), (298, 187)]), "main"],
            8: [(50, 136, 64, 141), (128, 132, 150, 139), ("thin", 50, 199, 125, 212, 4), (55, 203, 80, 210), "main"]}},
  "t8r2": {"file": "../thuluth-8-row2.png", "dot": 16, "units": {
    1: ("بلب initial, medial and final behs (to name)", (1219,114,1496,228)),
    2: ("a long run of joined behs, dotted circle (to name)", (613,111,1031,232)),
    3: ("بلسة beh run with stroke numbers (to name)", (262,89,523,256)),
    4: ("تليمة beh run with stroke numbers (to name)", (24,89,290,256)),
  },
  # 3 was two words joined only by the baseline: بلسة on the right (3),
  # تليمة on the left (4)
  "splits": {(39, 104): (3, 4, nearer_to(449, 192))},
  # The user's review (2026-10-17): stray lines and spurs. A thin pass over
  # the whole piece takes the hairline guide lines first.
  "erase": {
    # the lam's spur, the ticks over each bowl
    1: [("thin", 0, 0, 1600, 300, 3), (1428, 165, 1432, 174), (1411, 182, 1416, 187), (1437, 183, 1442, 188), "main"],
    2: [("thin", 0, 0, 1600, 300, 3), (678, 212, 683, 216), "main"],
    # the baseline fused under the seen's bowl, a knob under the first tooth
    3: [("thin", 0, 0, 1600, 300, 3), (346, 207, 382, 212), (408, 202, 416, 207), "main"],
    # the tail tip's spur, a bump on the meem, a tick under the lam's bowl
    4: [("thin", 0, 0, 1600, 300, 3), (43, 179, 48, 184), (200, 182, 205, 186), (264, 181, 268, 185), "main"],
  }},
  "t8r3": {"file": "../thuluth-8-row3.png", "dot": 16, "units": {
    1: ("one word: a run of joined behs ending in ة (to name)", (5,9,407,140)),
  }, "splits": {},
  # The user's review (2026-10-17): the guide-line stub at the ta marbuta's
  # crossing, the baseline fused under the strokes, small ticks and knobs
  "erase": {1: [("thin", 0, 0, 420, 160, 3), (50, 44, 56, 49), (78, 119, 125, 123), (150, 119, 170, 123),
                (226, 120, 234, 124), (338, 38, 342, 42), (389, 87, 393, 93), (366, 111, 374, 115), "main"]}},
  # Sheet 9, the jeem family, three rows (mapped 2026-10-17). Rows 2 and 3
  # are scanned larger (pen 17.2 and 17.6 px), so each has its own unit.
  "t9r1": {"file": "../thuluth-9-row1.png", "dot": 16, "units": {
    2: ("جـ initial jeem, head angle 1 (measuring nuqtas)", (928,160,1076,254)),
    3: ("جـ initial jeem, head angle 2", (751,143,902,257)), 4: ("جـ initial jeem, head angle 3", (588,144,734,247)),
    5: ("ـجـ medial jeem, form 1", (406,134,581,255)), 6: ("ـجـ medial jeem, form 2", (228,132,385,257)),
    7: ("حـ starting ha (top of three stacked)", (18,33,215,126)),
    8: ("ـحـ middle ha, joined both sides (middle of three)", (18,126,215,177)),
    9: ("ـح joined terminal ha (bottom of three)", (18,177,215,353)),
  },
  # The user's review (2026-10-17): 7 was three ha's stacked in one shape,
  # cut where each one's body reaches the next one's head on the left.
  "splits": {(33, 48): ([7, 8, 9], lambda xs, ys: np.where(ys < 126, 7, np.where(ys < 177, 8, 9)))},
  # stray lines and nuqtas (the user): a thin pass, then the nuqtas inside
  # the heads and the spurs by box
  "erase": {2: ["main"],
            3: [("thin", 0, 0, 1600, 400, 3), (784, 186, 805, 215), (801, 164, 807, 168), (779, 238, 785, 243), "main"],
            4: [("thin", 0, 0, 1600, 400, 3), (636, 178, 657, 199), (637, 218, 646, 226), "main"],
            5: [("thin", 0, 0, 1600, 400, 3), "main"],
            6: [("thin", 0, 0, 1600, 400, 3), ("thin", 270, 195, 360, 240, 5), ("thin", 265, 160, 325, 185, 5),
                ("poly", [(288, 172), (306, 161), (306, 176), (288, 176)]), ("poly", [(271, 180), (289, 173), (293, 185), (275, 185)]), ("poly", [(270, 234), (296, 219), (296, 237), (270, 237)]), "main"],
            7: [("thin", 0, 0, 1600, 400, 5), (114, 111, 121, 116), "main"],
            8: [("thin", 0, 0, 1600, 400, 5), "main"],
            9: [("thin", 0, 0, 1600, 400, 5), (47, 262, 51, 275), "main"]}},
  "t9r2": {"file": "../thuluth-9-row2.png", "dot": 17, "unit": 48 / 17.2, "units": {
    5: ("حم ha followed by an extension: six nuqtas", (1043,135,1506,311)),
    2: ("حسا ha followed by a low letter: still six nuqtas", (688,18,1147,248)),
    6: ("حمل the rule for الرحمن in Muhaqqaq: ha and nun six nuqtas", (308,12,698,328)),
    7: ("حم ha with meem, second", (4,124,308,315)),
  }, "splits": {}, "erase": {k: ["main"] for k in (5, 2, 6, 7)}},
  "t9r3": {"file": "../thuluth-9-row3.webp", "dot": 18, "unit": 48 / 17.6, "units": {
    1: ("لحم لحم ha joined after and before, two words", (1067,66,1563,425)),
    2: ("حم ha with meem", (736,209,1039,397)), 3: ("حكم ha before kaf and meem", (504,75,849,388)),
    4: ("حمر حر the open ha (حاء مفتوح), two words", (29,187,570,373)),
  }, "splits": {}},
  # Sheet 10, the seen, four rows (mapped 2026-10-17 with mapSheet.py's
  # `parts` mode: numbers are separate shapes, right to left).
  "t10r1": {"file": "../thuluth-10-row1.png", "dot": 14, "unit": 48 / 14, "units": {
    4: ("س standalone seen (الفردي)", (1322,186,1521,310)),
    1: ("س لسه سط standalone extended seen, لسه, medial seen in سط (joined in the scan)", (459,55,1494,298)),
    2: ("سمد سملا seen with meem (السين مع الميم)", (13,58,471,302)),
  }, "splits": {}, "erase": {4: ["main"], 1: ["main"]}},
  "t10r2": {"file": "../thuluth-10-row2.png", "dot": 14, "unit": 48 / 14, "units": {
    1: ("سمر seen with meem and ra", (1191,130,1493,299)),
    2: ("سرسرس run: seen joined to ra (the extension after the basmala's ba is an extended seen)", (507,106,1270,265)),
    3: ("سمر seen with meem and ra, second", (369,93,611,224)),
    4: ("سمرس seen, meem, ra, seen", (12,86,463,247)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4)}},
  "t10r3": {"file": "../thuluth-10-row3.png", "dot": 16, "units": {
    1: ("سرا with a long flat seen", (560,80,1035,313)),
    2: ("long seen over ح with ط, stacked (the seen's extension is close to the extended ba's)", (0,46,532,407)),
  }, "splits": {}, "erase": {2: ["main"]}},
  # Sheet 11, sad and tah, complex strokes and alternate forms (mapped
  # 2026-10-17, parts mode). Row 2 is two rows in one image.
  "t11r1": {"file": "../thuluth-11-row1.png", "dot": 16, "unit": 48 / 15.98, "units": {
    1: ("ص standalone sad", (1363,146,1591,286)),
    2: ("صر and a stacked صصى run with a returned ya tail", (817,114,1359,280)),
    3: ("صو sad with waw", (505,129,772,265)), 4: ("a stacked مصحم-like word (to name)", (65,77,516,262)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4)}},
  "t11r2": {"file": "../thuluth-11-row2.webp", "dot": 16, "unit": 48 / 15.6, "units": {
    1: ("a stacked مصحى-like word with ح (to name)", (999,71,1535,336)), 2: ("ط tah", (794,82,955,273)),
    3: ("طط two tahs", (539,73,791,282)), 4: ("a مطـ opening run stacked with ط (to name)", (45,41,527,374)),
    5: ("مصى stacked (to name)", (1311,330,1539,603)), 6: ("ط tah, second", (1051,340,1264,581)),
    7: ("a long طـ run (to name)", (756,316,1170,562)), 8: ("ط over ع, stacked", (559,297,725,588)),
    9: ("سط seen with tah", (27,326,467,525)),
  }, "splits": {}, "erase": {k: ["main"] for k in range(1, 10)}},
  "t11r3": {"file": "../thuluth-11-row3.png", "dot": 16, "units": {
    1: ("initial, medial and final sad, then initial, medial and final tah (two runs, touching)", (6,21,770,268)),
  }, "splits": {}, "erase": {1: ["main"]}},
  # Sheet 12, the ain, five rows (mapped 2026-10-17, parts mode). Rows 4 and
  # 5 are the composition وجعلنا written large (pen 24 and 22.8 px).
  "t12r1": {"file": "../thuluth-12-row1.png", "dot": 16, "unit": 48 / 15.98, "units": {
    1: ("ع cup ain (عين فنجاني), construction lines", (1329,77,1431,192)),
    2: ("ع sad-like ain (عين صادي), construction lines", (1179,73,1294,202)),
    3: ("بلغب cup ain and snake-sad ain in one run", (593,13,985,219)),
    4: ("عغع initial, medial and final ain (measuring nuqtas, stroke numbers)", (363,54,677,284)),
    5: ("نابتغا snake ain (عين ثعباني), stroke numbers", (42,16,218,208)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4, 5)}},
  "t12r2": {"file": "../thuluth-12-row2.png", "dot": 14, "unit": 48 / 14, "units": {
    1: ("بالعمر ain words, start of the practice line", (978,61,1389,302)),
    2: ("على عسلى ain over a long seen with a returned ya", (387,51,1000,352)),
    3: ("عحمع ending in an open final ain", (-5,87,449,346)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3)}},
  "t12r3": {"file": "../thuluth-12-row3.png", "dot": 14, "unit": 48 / 14.4, "units": {
    1: ("يسر عسر بعد, one practice line", (19,19,928,248)),
  }, "splits": {}, "erase": {1: ["main"]}},
  "t12r4": {"file": "../thuluth-12-row4.png", "dot": 24, "unit": 48 / 24, "units": {
    1: ("وجعلنا composition, first arrangement", (389,60,819,449)),
  }, "splits": {}, "erase": {1: ["main"]}},
  "t12r5": {"file": "../thuluth-12-row5.png", "dot": 23, "unit": 48 / 22.8, "units": {
    1: ("وجعلنا composition, second arrangement", (23,7,487,411)),
  }, "splits": {}, "erase": {1: ["main"]}},
  # Sheet 13, fa, qaf and waw (mapped 2026-10-17, parts mode). Pieces keep
  # the sheet's own numbers 1-12 (the ledger lists them).
  "t13r1": {"file": "../thuluth-13-row1.webp", "dot": 18, "unit": 48 / 18.4, "units": {
    1: ("ف gathered fa, from ba", (1726,164,1915,286)), 2: ("ق gathered qaf", (1461,154,1629,293)),
    3: ("و extended waw, from extended ra", (1174,141,1346,298)), 4: ("ف extended fa", (681,143,1097,275)),
    5: ("ق extended qaf, from extended nun", (164,133,644,282)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4, 5)}},
  "t13r2": {"file": "../thuluth-13-row2.webp", "dot": 20, "unit": 48 / 20, "units": {
    6: ("و gathered waw, from gathered ra and dal", (1783,159,1962,323)),
    13: ("و gathered waw, second (beside the ٦)", (1601,157,1739,294)),
    7: ("و waw (dotted alternate: the extended 4-nuqta waw, inside a nun or seen cup)", (1311,143,1461,290)),
    8: ("و waw of 7 nuqtas: Muhaqqaq, not for Thuluth", (948,150,1145,322)),
    9: ("و waw, head open on the left", (821,149,907,267)),
    10: ("و waw, head open on the right", (482,157,644,301)),
    11: ("مو the letter before joins the waw's head from the left", (117,145,386,307)),
  }, "splits": {}, "erase": {k: ["main"] for k in (6, 13, 7, 8, 9, 10, 11)}},
  "t13r3": {"file": "../thuluth-13-row3.png", "dot": 20, "unit": 48 / 20, "units": {
    12: ("the fa head between letters, one long run", (0,0,99999,99999)),
  }, "splits": {}, "erase": {12: ["main"]}},
  "t13r4": {"file": "../thuluth-13-row4.png", "dot": 22, "unit": 48 / 21.6, "units": {
    1: ("وففـ fa start, middle, end: before tall letters (measuring marks)", (813,113,1204,286)),
    2: ("فح fa head stacked on ha", (714,41,912,346)),
    3: ("و فبو extended joined fa with final waw: before low letters", (83,90,673,321)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3)}},
  # Sheet 14, kaf and its kinds (mapped 2026-10-17, parts mode). Rows 1-3
  # keep the sheet's own numbers.
  "t14r1": {"file": "../thuluth-14-row1.webp", "dot": 18, "unit": 48 / 18, "units": {
    1: ("ك single kaf (المفرد)", (1703,65,1867,304)), 2: ("ك final kaf (النهائي)", (1322,58,1527,301)),
    3: ("ك extended kaf (المرسل)", (832,54,1178,295)), 4: ("ك zinadi kaf (الزنادي)", (399,118,752,281)),
    5: ("كد zinadi kaf joined into a following letter", (20,115,379,274)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4, 5)}},
  "t14r2": {"file": "../thuluth-14-row2.webp", "dot": 18, "unit": 48 / 18.4, "units": {
    6: ("ك saifi kaf, initial joined", (1727,46,1978,317)), 7: ("ك saifi kaf, single and joined", (1145,49,1409,321)),
    8: ("كرا model of the medial saifi kaf", (533,31,832,380)), 9: ("مكا saifi kaf, medial and final, joined", (28,34,311,323)),
  }, "splits": {}, "erase": {k: ["main"] for k in (6, 7, 8, 9)}},
  "t14r3": {"file": "../thuluth-14-row3.png", "dot": 17, "unit": 48 / 17.2, "units": {
    1: ("saifi kaf finished with a small zinadi kaf, (1)", (776,26,937,269)),
    2: ("saifi kaf finished with a small zinadi kaf, (2)", (381,40,626,263)),
    3: ("saifi kaf finished with a small zinadi kaf, (3)", (64,18,207,264)),
  }, "splits": {}},
  "t14r4": {"file": "../thuluth-14-row4.png", "dot": 14, "unit": 48 / 14, "units": {
    1: ("حكما (to confirm)", (4,10,282,171)),
  }, "splits": {}, "erase": {1: ["main"]}},
  "t14r5": {"file": "../thuluth-14-row5.webp", "dot": 18, "unit": 48 / 18, "units": {
    1: ("zinadi kaf construction, part 1 (to name)", (1468,153,1949,389)),
    2: ("بكلك zinadi kaf with final and medial (to name)", (820,102,1541,399)),
    3: ("كا initial saifi kaf (to name)", (702,138,869,370)),
    4: ("بكر saifi kaf, single and medial (to name)", (374,109,679,395)),
    5: ("بكلا saifi kaf, single and medial (to name)", (65,118,389,375)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4, 5)}},
  "t10r4": {"file": "../thuluth-10-row4.png", "dot": 14, "unit": 48 / 14.4, "units": {
    1: ("medial seen in an النسيم-like word (measuring grid)", (178,26,438,218)),
    2: ("سـ medial and final seen, the lower word (measuring nuqtas)", (10,280,528,500)),
    3: ("سـ initial seen with its long sweep, the upper shape (stroke numbers 1-4)", (10,280,528,500)),
  }, "splits": {},
  # 1: the baseline fused under the teeth, a tick on the first tooth, and a
  # pale line drawn across the meem's solid lower part (filled back)
  "erase": {1: [("thin", 296, 126, 375, 134, 4), (315, 86, 321, 90),
                ("fill", [(301, 131), (333, 131), (330, 150), (326, 157), (316, 157)]), "main"],
            # 2: the measuring nuqtas over the lower word's teeth and the line
            # they sit on, the nuqta between two teeth, the column of nuqtas
            # and its tick beside the bowl
            # The piece is two shapes once the nuqtas and lines go: 2 keeps the
            # lower word (medial and final seen), 3 the initial seen above it
            # with its long sweep (the user's lesson: separate shapes, separate pieces)
            2: [(376, 358, 447, 386), (397, 386, 418, 402), ("thin", 328, 383, 380, 394, 4),
                ("thin", 445, 372, 520, 381, 4), (458, 372, 506, 396), (309, 428, 345, 495), (306, 448, 346, 452), ("keep", 306, 416)],
            3: [("from", 2), (376, 358, 447, 386), (397, 386, 418, 402), ("thin", 328, 383, 380, 394, 4),
                ("thin", 445, 372, 520, 381, 4), (458, 372, 506, 396), (309, 428, 345, 495), (306, 448, 346, 452), ("keep", 91, 392)]}},
}


# Draft sheets written by mapSheet.py (drafts/<key>.json): every piece is
# "part N" and keeps only its main shape. A SHEETS entry of the same key wins.
import json as _json, glob as _glob
for _f in sorted(_glob.glob(os.path.join(HERE, "drafts", "*.json"))):
    _k = os.path.splitext(os.path.basename(_f))[0]
    if _k in SHEETS: continue
    with open(_f, encoding="utf-8") as _fh: _d = _json.load(_fh)
    SHEETS[_k] = {"file": _d["file"], "dot": _d["dot"], "unit": _d["unit"], "splits": {},
                  "units": {int(n): (v[0], tuple(v[1])) for n, v in _d["units"].items()},
                  "erase": {int(n): ["main"] for n in _d["units"]}}

LAST_GRAY = None   # the scan clean_sheet last read, for the "auto" erase

# The cleanup sweep (2026-10-17): every piece of the lesson sheets 7-19 starts
# with the "auto" erase, its disc a quarter of the pen; a piece with no "main"
# loses separate bits under three nuqtas' area instead, so a piece of two
# words keeps both. Pieces already in the library are never traced again, so
# this changes nothing for them.
for _k, _cfg in SHEETS.items():
    _m = re.fullmatch(r"t(\d+)r\d+", _k)
    if not _m or not 7 <= int(_m.group(1)) <= 19: continue
    _pen = _cfg["dot"] if "unit" not in _cfg else 48 / _cfg["unit"]
    _r = max(3, round(_pen / 4))
    _er = _cfg.setdefault("erase", {})
    for _n in _cfg["units"]:
        _items = _er.get(_n, [])
        if any(isinstance(i, tuple) and i[0] == "auto" for i in _items): continue
        if "main" not in _items: _items = _items + [("small", round(3 * _pen * _pen))]
        _er[_n] = [("auto", _r)] + _items

def clean_sheet(path, dot):
    global LAST_GRAY
    im = np.array(Image.open(path).convert("L"))
    LAST_GRAY = im
    mask = (im < 140).astype(np.uint8)
    # Guide lines: long straight runs of the very thinnest ink. A pen hairline
    # is thicker (3-5 px) and survives; so do the letters' curves.
    thin = (mask & ~cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))).astype(np.uint8)
    lines = cv2.HoughLinesP(thin * 255, 1, np.pi / 360, threshold=30, minLineLength=40, maxLineGap=3)
    erase = np.zeros_like(mask)
    for l in (lines.reshape(-1, 4) if lines is not None else []):
        cv2.line(erase, (int(l[0]), int(l[1])), (int(l[2]), int(l[3])), 1, 3)
    clean = (mask & ~(erase & thin)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(clean, 8)
    dt = cv2.distanceTransform(clean, cv2.DIST_L2, 5)
    for i in range(1, n):
        comp = lab == i
        x, y, w, h, a = st[i]
        if a < 60 or dt[comp].max() < 3.0: clean[comp] = 0                     # numbers, arrows, line ends
        elif max(w, h) < 2.2 * dot and a < 2.2 * dot * dot: clean[comp] = 0      # every loose dot
    return im, clean

def assign(clean, units, splits, erase=None):
    sel = _assign(clean, units, splits)
    base = {k: v.copy() for k, v in sel.items()}
    for k, items in (erase or {}).items():
        if k not in sel: continue
        for it in items:
            if isinstance(it, tuple) and it[0] == "from":   # ("from", j): start from
                # piece j's pixels, for two pieces cut from one shape
                sel[k] = base[it[1]].copy(); continue
            if isinstance(it, tuple) and it[0] == "keep":   # ("keep", x, y): only the
                # separate shape holding that point
                n, lab = cv2.connectedComponents(sel[k].astype(np.uint8), connectivity=8)
                i = lab[it[2], it[1]]
                assert i > 0, (k, it, "point is not on the piece")
                sel[k] = lab == i; continue
            if it == "main":   # keep only the piece's largest separate shape
                n, lab, st, _ = cv2.connectedComponentsWithStats(sel[k].astype(np.uint8), 8)
                if n > 2: sel[k] = lab == 1 + int(np.argmax(st[1:, 4]))
            elif it[0] == "auto":   # ("auto", r): guide lines and pencil marks fused
                # to the piece. Whatever a disc r px across can't fit in is a
                # candidate; a candidate is dropped only when it is clearly lighter
                # than the piece's own ink (pencil and printed rules are grey, a
                # pen hairline is as dark as the stroke), so the zulf and other
                # hairlines stay.
                r = it[1]
                kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r))
                core = cv2.morphologyEx(sel[k].astype(np.uint8), cv2.MORPH_OPEN, kern) > 0
                if not core.any(): continue
                ink = float(np.median(LAST_GRAY[core]))
                # A candidate whose removal would cut a large part of the letter
                # loose stays (a tail joined through a patch a guide line greyed).
                big = 3 * (4 * r) ** 2
                def n_big(m):
                    n_, _, st_, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
                    return int((st_[1:, 4] >= big).sum())
                ys_, xs_ = np.nonzero(sel[k]); bx = (slice(max(0, ys_.min() - 2), ys_.max() + 3), slice(max(0, xs_.min() - 2), xs_.max() + 3))
                piece = sel[k][bx].copy(); gray = LAST_GRAY[bx]; kept = n_big(piece)
                n, lab, st, _ = cv2.connectedComponentsWithStats((piece & ~core[bx]).astype(np.uint8), 8)
                for i in sorted(range(1, n), key=lambda i: -st[i][4]):
                    part = lab == i
                    # the darker quarter decides: a thin tip still holds some
                    # ink-dark pixels, a pencil line none (t8 row 1 piece 8:
                    # its tail tip 46, lines 73-114, against ink 32)
                    if np.percentile(gray[part], 25) <= ink + 35: continue
                    piece[part] = False
                    if n_big(piece) > kept: piece[part] = True
                sel[k][bx] = piece
            elif it[0] == "small":   # ("small", area): drop separate bits smaller than
                # area px (measuring nuqtas, note words), keeping every larger shape
                n, lab, st, _ = cv2.connectedComponentsWithStats(sel[k].astype(np.uint8), 8)
                for i in range(1, n):
                    if st[i][4] < it[1]: sel[k][lab == i] = False
            elif it[0] == "fill":   # ("fill", [(x, y), ...]): ink inside a polygon, for
                # a pale guide line drawn across solid ink, which cleaning reads as a gap
                m = np.zeros(sel[k].shape, np.uint8)
                cv2.fillPoly(m, [np.array(it[1], np.int32)], 1)
                sel[k][m > 0] = True
            elif it[0] == "poly":   # ("poly", [(x, y), ...]): clear inside a polygon,
                # for an edge that runs on a slant where a box would notch it
                m = np.zeros(sel[k].shape, np.uint8)
                cv2.fillPoly(m, [np.array(it[1], np.int32)], 1)
                sel[k][m > 0] = False
            elif it[0] == "thin":   # ("thin", x0, y0, x1, y1, r): inside the box, clear
                # whatever a disc r px across can't fit in (guide lines, spurs),
                # keeping the pen strokes they run along or cross
                # (the disc is tried on the whole piece, so a stroke only
                # grazing the box is judged by its full width)
                _, x0, y0, x1, y1, r = it
                kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r))
                opened = cv2.morphologyEx(sel[k].astype(np.uint8), cv2.MORPH_OPEN, kern) > 0
                sel[k][y0:y1, x0:x1] = opened[y0:y1, x0:x1]
            elif len(it) == 2:   # a point: drop the separate bit of this piece that holds it
                n, lab = cv2.connectedComponents(sel[k].astype(np.uint8), connectivity=8)
                i = lab[it[1], it[0]]
                assert i > 0, (k, it, "point is not on the piece")
                sel[k][lab == i] = False
            else:              # a box: clear every pixel of this piece inside it
                x0, y0, x1, y1 = it; sel[k][y0:y1, x0:x1] = False
    return sel

def _assign(clean, units, splits):
    n, lab, st, _ = cv2.connectedComponentsWithStats(clean, 8)
    sel = {k: np.zeros_like(clean, bool) for k in units}
    for i in range(1, n):
        comp = lab == i
        ys, xs = np.nonzero(comp)
        key = (int(st[i][0]), int(st[i][1]))
        if key in splits and len(splits[key]) == 2:   # (pieces, rule -> piece per pixel)
            ks, rule = splits[key]; r = rule(xs, ys)
            for kk in ks:
                if kk in sel: sel[kk][ys[r == kk], xs[r == kk]] = True
            continue
        if key in splits:
            a, b, rule = splits[key]; r = rule(xs, ys)
            if a in sel: sel[a][ys[r], xs[r]] = True       # either piece may not be chosen
            if b in sel: sel[b][ys[~r], xs[~r]] = True
            continue
        best, bestc = None, 0
        for k, (_, (x0, y0, x1, y1)) in units.items():
            c = int(((xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)).sum())
            if c > bestc: best, bestc = k, c
        if best is not None and bestc > 0.5 * len(xs): sel[best] |= comp
    return sel

def trace(sel, unit=3.0, S=8, blur=0.35, alphamax=1.1, opttolerance=0.4, gray=None):
    """Potrace one piece; returns {d, w, h} in library units centred on the ink,
    plus the sampled contours (for the review drawing). `blur` is the smoothing
    before tracing, in source px; more of it irons out the scan's ragged edge.
    With `gray` (the scan, 0-255) the piece's own grey edge shading is traced
    instead of its black-and-white mask, which places each edge to a fraction
    of a pixel: inside one pixel of the piece the scan is used, white elsewhere."""
    # a piece touching the image edge is padded with white, so the crop below
    # always has its 3 px margin
    sel = np.pad(sel, 8)
    if gray is not None: gray = np.pad(gray, 8, constant_values=255)
    ys, xs = np.nonzero(sel)
    x0, x1, y0, y1 = xs.min() - 3, xs.max() + 4, ys.min() - 3, ys.max() + 4
    if gray is None:
        g = np.where(sel[y0:y1, x0:x1], 0, 255).astype(np.float32)
    else:
        near = cv2.dilate(sel[y0:y1, x0:x1].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        g = np.where(near, gray[y0:y1, x0:x1], 255).astype(np.float32)
        # the scan's ink is dark grey, not black: stretch so its threshold sits at 128
        g = np.clip((g - 0) * (128 / 140), 0, 255)
    big = cv2.GaussianBlur(cv2.resize(g, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC), (0, 0), S * blur)
    bw = cv2.morphologyEx((big < 128).astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (S + 1, S + 1))) > 0
    pl = potrace.Bitmap(~bw).trace(turdsize=S * S * 4, alphamax=alphamax, opticurve=True, opttolerance=opttolerance)
    contours = []
    for curve in pl:
        a = curve.start_point; pts = [(a.x, a.y)]
        for sg in curve.segments:
            if sg.is_corner: pts += [(sg.c.x, sg.c.y), (sg.end_point.x, sg.end_point.y)]
            else:
                for i in range(1, 17):
                    t = i / 16; u = 1 - t
                    pts.append((u**3*a.x + 3*u*u*t*sg.c1.x + 3*u*t*t*sg.c2.x + t**3*sg.end_point.x,
                                u**3*a.y + 3*u*u*t*sg.c1.y + 3*u*t*t*sg.c2.y + t**3*sg.end_point.y))
            a = sg.end_point
        contours.append(pts)
    allp = [q for c in contours for q in c]
    mx = (min(q[0] for q in allp) + max(q[0] for q in allp)) / 2; my = (min(q[1] for q in allp) + max(q[1] for q in allp)) / 2
    f = unit / S
    P = lambda pt: f"{(pt.x - mx) * f:.0f} {(pt.y - my) * f:.0f}"
    d = []
    for curve in pl:
        d.append("M" + P(curve.start_point))
        for sg in curve.segments:
            d.append(("L" + P(sg.c) + "L" + P(sg.end_point)) if sg.is_corner else ("C" + P(sg.c1) + " " + P(sg.c2) + " " + P(sg.end_point)))
        d.append("Z")
    w = (max(q[0] for q in allp) - min(q[0] for q in allp)) * f; h = (max(q[1] for q in allp) - min(q[1] for q in allp)) * f
    return {"d": "".join(d), "w": round(w), "h": round(h)}, contours, (x0 - 8, y0 - 8, S)

def draw_traced(contours, size, S, scale=1):
    """The traced outline, filled even-odd, at `scale` times source size.
    Drawn 4x larger and shrunk, so its edges are smooth like the app's."""
    k = 4 * scale
    acc = np.zeros((size[1] * k, size[0] * k), np.uint8)
    for c in contours:
        m = np.zeros_like(acc)
        cv2.fillPoly(m, [np.array([(x * k / S * 16, y * k / S * 16) for x, y in c], np.int32)], 1, lineType=cv2.LINE_8, shift=4)
        acc ^= m
    return Image.fromarray(np.where(acc > 0, 0, 255).astype(np.uint8)).resize((size[0] * scale, size[1] * scale), Image.LANCZOS)

def main(sheet, out_dir):
    cfg = SHEETS[sheet]
    src = os.path.join(HERE, cfg["file"])
    im, clean = clean_sheet(src, cfg["dot"])
    sel = assign(clean, cfg["units"], cfg["splits"], cfg.get("erase"))
    color = Image.open(src).convert("RGB")
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    traced, tiles = {}, []
    for k, (name, box) in cfg["units"].items():
        if not sel[k].any(): continue
        data, contours, (x0, y0, S) = trace(sel[k])
        traced[k] = {"name": name, **data}
        ys, xs = np.nonzero(sel[k])
        bx0, by0, bx1, by1 = xs.min() - 3, ys.min() - 3, xs.max() + 4, ys.max() + 4
        left = color.crop((bx0, by0, bx1, by1))
        right = draw_traced(contours, (bx1 - bx0, by1 - by0), S)
        tiles.append((k, left, right))
    cell = 260
    per = 12
    for page in range(0, len(tiles), per):
        chunk = tiles[page:page + per]
        cols = 3
        rows = (len(chunk) + cols - 1) // cols
        sheet_img = Image.new("RGB", (cols * (2 * cell + 30), rows * (cell + 34)), "white")
        d = ImageDraw.Draw(sheet_img)
        for j, (k, left, right) in enumerate(chunk):
            cx, cy = (j % cols) * (2 * cell + 30), (j // cols) * (cell + 34)
            for t, ox in ((left, 0), (right, cell)):
                t = t.copy(); t.thumbnail((cell - 12, cell - 12))
                sheet_img.paste(t, (cx + ox + 6, cy + 30))
            d.rectangle([cx + 2, cy + 26, cx + 2 * cell + 2, cy + cell + 30], outline=(210, 210, 210))
            d.line([cx + cell + 2, cy + 26, cx + cell + 2, cy + cell + 30], fill=(210, 210, 210))
            d.text((cx + 6, cy + 4), f"#{k}", fill=(40, 120, 255), font=font)
        sheet_img.save(os.path.join(out_dir, f"{sheet}-review-{page // per + 1}.png"))
    json.dump(traced, open(os.path.join(out_dir, f"{sheet}-traced.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{sheet}: traced {len(traced)} pieces")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
