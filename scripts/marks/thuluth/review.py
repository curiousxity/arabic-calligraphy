"""
Thuluth review tool: cleans a source sheet, cuts it into numbered pieces,
traces each one, and draws review sheets (the source crop beside the traced
outline). Nothing here writes the app's mark library: a piece moves there
only once the user approves it in REVIEW.md. See .claude/rules/marks.md.

    python3 -I scripts/marks/thuluth/review.py <sheet> <out_dir>

<sheet> is a key of SHEETS below. Writes <out_dir>/<sheet>-review-<n>.png
and <out_dir>/<sheet>-traced.json ({piece: {d, w, h}}).
"""
import json, os, sys
import numpy as np, cv2, potrace
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

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
    2: ("بص بط initial beh (two dots) with sad and with ta, touching", (1209,34,1560,275)),
    4: ("بغ initial beh with ghain", (1093,97,1240,305)), 5: ("بق initial beh with qaf", (892,105,1090,258)),
    9: ("بم initial beh with meem", (739,109,886,243)), 10: ("بر initial beh with ra", (522,99,727,273)),
    13: ("بو initial beh with waw", (451,106,581,251)), 15: ("بى initial beh with ya", (297,99,453,264)),
    19: ("initial beh with three dots, long joined run (to name)", (15,59,339,258)),
  }, "splits": {}, "erase": {k: ["main"] for k in (2, 4, 5, 9, 10, 13, 15, 19)}},
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
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3, 4, 6, 7, 8)}},
  "t8r2": {"file": "../thuluth-8-row2.png", "dot": 16, "units": {
    1: ("بلب initial, medial and final behs (to name)", (1219,114,1496,228)),
    2: ("a long run of joined behs, dotted circle (to name)", (613,111,1031,232)),
    3: ("بلسة تليمة beh runs with stroke numbers (to name)", (24,89,523,256)),
  }, "splits": {}, "erase": {k: ["main"] for k in (1, 2, 3)}},
  "t8r3": {"file": "../thuluth-8-row3.png", "dot": 16, "units": {
    1: ("one word: a run of joined behs ending in ة (to name)", (5,9,407,140)),
  }, "splits": {}, "erase": {1: ["main"]}},
  # Sheet 9, the jeem family, three rows (mapped 2026-10-17). Rows 2 and 3
  # are scanned larger (pen 17.2 and 17.6 px), so each has its own unit.
  "t9r1": {"file": "../thuluth-9-row1.png", "dot": 16, "units": {
    2: ("جـ initial jeem, head angle 1 (measuring nuqtas)", (928,160,1076,254)),
    3: ("جـ initial jeem, head angle 2", (751,143,902,257)), 4: ("جـ initial jeem, head angle 3", (588,144,734,247)),
    5: ("ـجـ medial jeem, form 1", (406,134,581,255)), 6: ("ـجـ medial jeem, form 2", (228,132,385,257)),
    7: ("جـ over ح stacked, with its measuring grid", (18,33,215,353)),
  }, "splits": {}, "erase": {k: ["main"] for k in (2, 3, 4, 5, 6, 7)}},
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
    2: ("initial, medial and final seen, stacked run (stroke numbers, measuring nuqtas)", (10,280,528,500)),
  }, "splits": {}, "erase": {1: ["main"]}},
}

def clean_sheet(path, dot):
    im = np.array(Image.open(path).convert("L"))
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
    for k, items in (erase or {}).items():
        if k not in sel: continue
        for it in items:
            if it == "main":   # keep only the piece's largest separate shape
                n, lab, st, _ = cv2.connectedComponentsWithStats(sel[k].astype(np.uint8), 8)
                if n > 2: sel[k] = lab == 1 + int(np.argmax(st[1:, 4]))
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
