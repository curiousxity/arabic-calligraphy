"""Does this computer's GPU fit a stroke as its CPU does? fitqueue.py runs it once as a worker starts on a GPU other
than an NVIDIA card (a Mac's, through MPS: the user's MacBook Pro joined the queue on 2026-10-27), and holds the
worker to the CPU when it fails, so a card that computes something else never hands back a wrong fit.

    python devcheck.py        exit 0: the GPU agrees with the CPU (or there is no GPU to check); 1: it does not

The check is a short pen-held refine (gpufit.refine_pens, one small stage) of a made-up stroke, a curved band one nib
wide, from a start that is off it, once on each device: the GPU's fit must score within 0.01 of the CPU's, its nodes lie
within 0.03 nuqta of them and its angle within a degree. (Moving the start by 0.00001 nuqta moves the CPU's own
fit by 0.007 nuqta and 0.1 degree, so the check allows rounding and catches a card that computes something else.)
The fit carries a window and the corner term, as penjob's do, and its result is then scored by gpu_score on the GPU and
by pieces.score on the CPU, which must agree to 0.005 in overlap and 0.01 nuqta in the outline gap: penjob chooses
among its tries by gpu_score, so a card that scored wrongly without failing would choose wrongly on every stroke.
Every operation a real fit uses runs in it, the backward pass among them."""
import math, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gpufit  # noqa: E402
from pieces import score  # noqa: E402

PPN, PEN = 40.0, 40.0  # px to the nuqta, the nib's width in px
ORIGIN = (100.0, 100.0)
STAGES = (((30, 1.0, 60, 0.02), (90, 0.4, 40, 0.004)),)  # a real schedule's shape, cut short
WINDOWS = [(2.0, 0.4, 0.8)]  # one window over the arc's top, in the nodes' nuqta


def _band():
    """The reference: the ring a 90-degree nib sweeps along a shallow arc, as one studio-style piece."""
    top, bot = [], []
    for i in range(41):
        x = 4.0 * i / 40
        y = 0.4 * math.sin(math.pi * x / 4)
        cx, cy = ORIGIN[0] + x * PPN, ORIGIN[1] + y * PPN
        top.append((cx, cy - PEN / 2))
        bot.append((cx, cy + PEN / 2))
    ring = top + bot[::-1]
    d = "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in ring) + " Z"
    return ((1.0, 1.0, 0.0, 0.0), d)


def fit(device):
    gpufit.DEVICE = device
    gpufit.SCHEDULES = STAGES
    start = [{"p": [0.1, 0.15], "angle": 80.0}, {"p": [2.0, 0.6], "angle": 80.0}, {"p": [3.9, 0.15], "angle": 80.0}]
    t = time.time()
    (nodes, s), = gpufit.refine_pens(start, [_band()], ORIGIN, PPN, PEN, [{"angle": 80.0}], corner=0.1, windows=WINDOWS,
                                     judge="cpu")
    return nodes, s, time.time() - t


def main():
    if gpufit.torch is None or gpufit.DEVICE == "cpu":
        print("devcheck: no GPU here; the fits run on the CPU")
        return 0
    dev = gpufit.DEVICE
    try:
        g, gs, gt = fit(dev)
    except Exception as e:  # an operation the card cannot do
        print(f"devcheck: the {dev} GPU failed the test fit: {type(e).__name__}: {e}")
        return 1
    gpufit.DEVICE = dev
    gpu, cpu = gpufit.gpu_score([g], [_band()], ORIGIN, PPN, PEN), score([g], [_band()], ORIGIN, PPN, PEN)
    c, cs, ct = fit("cpu")
    gpufit.DEVICE = dev
    off = max(math.dist(a["p"], b["p"]) for a, b in zip(g, c))
    turn = max(abs(a["angle"] - b["angle"]) for a, b in zip(g, c))
    judged = abs(gpu["iou"] - cpu["iou"]) <= 0.005 and abs(gpu["gap95"] - cpu["gap95"]) <= 0.01
    ok = judged and abs(gs["iou"] - cs["iou"]) <= 0.01 and off <= 0.03 and turn <= 1.0
    print(f"devcheck: {dev} iou {gs['iou']:.3f} in {gt:.1f}s, cpu iou {cs['iou']:.3f} in {ct:.1f}s; "
          f"nodes apart by {off:.4f} nuqta, angles by {turn:.2f} deg; scored on the {dev} GPU {gpu['iou']:.3f} / gap "
          f"{gpu['gap95']:.3f}, on the CPU {cpu['iou']:.3f} / {cpu['gap95']:.3f}: {'agree' if ok else 'DISAGREE'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
