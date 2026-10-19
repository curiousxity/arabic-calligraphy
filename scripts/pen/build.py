"""Build the stroke library (src/lib/penData/*.json) from scripts/pen/spec.json.

    python -I -X utf8 scripts/pen/build.py

The spec is what Claude authors over the reference plates: each part's pen
paths as lists of nodes in nuqta (y down), drawn parts as SVG "d" strings,
the forms as penLibrary.ts `Form`s, and the join defaults. A node is
[x, y], [x, y, width], [x, y, width, keep] or an object
{ "p": [x, y], "width": w, "keep": "a"|"b", "angle": deg, "corner": true,
"dir": [dx, dy] }.
Between nodes the path is a cubic whose handles follow Catmull-Rom tangents
(a third of the neighbouring chord), so a path through smooth nodes is smooth;
a "corner" node takes one-sided tangents, and a node's "dir" sets its tangent
outright (a path split between two forms keeps the tangent it had whole). Never edit penData by hand: edit the
spec and rebuild. See .claude/rules/tarkib.md."""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "src", "lib", "penData")


def node(n):
    if isinstance(n, dict):
        return n
    out = {"p": [n[0], n[1]]}
    if len(n) > 2 and n[2] is not None and n[2] != 1:
        out["width"] = n[2]
    if len(n) > 3:
        out["keep"] = n[3]
    return out


def unit(v):
    l = math.hypot(v[0], v[1]) or 1
    return [v[0] / l, v[1] / l]


def path(nodes):
    ns = [node(n) for n in nodes]
    P = [n["p"] for n in ns]
    k = len(P)
    if k < 2:
        raise SystemExit("a path needs two nodes")
    # tangent directions: central differences, one-sided at the ends and at corners
    def tan(i, side):
        if "dir" in ns[i] and not ns[i].get("corner"):
            return unit(ns[i]["dir"])
        if i == 0 or (ns[i].get("corner") and side == "out"):
            return unit([P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]])
        if i == k - 1 or (ns[i].get("corner") and side == "in"):
            return unit([P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]])
        return unit([P[i + 1][0] - P[i - 1][0], P[i + 1][1] - P[i - 1][1]])
    segs = []
    for i in range(k - 1):
        chord = math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1])
        t0, t1 = tan(i, "out"), tan(i + 1, "in")
        h0 = chord / 3 * ns[i].get("tout", 1)
        h1 = chord / 3 * ns[i + 1].get("tin", 1)
        to = {key: v for key, v in ns[i + 1].items() if key in ("p", "width", "keep", "angle")}
        segs.append({
            "c1": [round(P[i][0] + t0[0] * h0, 4), round(P[i][1] + t0[1] * h0, 4)],
            "c2": [round(P[i + 1][0] - t1[0] * h1, 4), round(P[i + 1][1] - t1[1] * h1, 4)],
            "to": to,
        })
    start = {key: v for key, v in ns[0].items() if key in ("p", "width", "keep", "angle")}
    return {"start": start, "segs": segs}


def main():
    spec = json.load(open(os.path.join(HERE, "spec.json"), encoding="utf-8"))
    parts = []
    for pid, p in spec["parts"].items():
        part = {"id": pid, "name": p["name"]}
        if p.get("paths"):
            part["paths"] = [path(ns) for ns in p["paths"]]
        if p.get("drawn"):
            part["drawn"] = p["drawn"]
        parts.append(part)
    dump = lambda name, v: open(os.path.join(DATA, name), "w", encoding="utf-8", newline="\n").write(json.dumps(v, ensure_ascii=False, indent=1) + "\n")
    dump("parts.json", parts)
    dump("forms.json", spec["forms"])
    dump("joins.json", spec["joins"])
    print(f"{len(parts)} parts, {len(spec['forms'])} forms, {len(spec['joins'])} joins")


if __name__ == "__main__":
    main()
