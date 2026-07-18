const TARGET_SVG_SIZE = 500;

function svgElementToPathData(el: Element): string {
  const tag = el.tagName.toLowerCase().replace(/^.*:/, "");

  switch (tag) {
    case "path":
      return el.getAttribute("d") ?? "";

    case "rect": {
      const rx = parseFloat(el.getAttribute("rx") ?? "0");
      const ry = parseFloat(el.getAttribute("ry") ?? rx.toString());
      const ex = parseFloat(el.getAttribute("x") ?? "0");
      const ey = parseFloat(el.getAttribute("y") ?? "0");
      const w = parseFloat(el.getAttribute("width") ?? "0");
      const h = parseFloat(el.getAttribute("height") ?? "0");

      if (rx === 0 && ry === 0) {
        return `M ${ex} ${ey} H ${ex + w} V ${ey + h} H ${ex} Z`;
      }

      const r = Math.min(rx, w / 2, ry, h / 2);
      return (
        `M ${ex + r} ${ey} H ${ex + w - r} Q ${ex + w} ${ey} ${ex + w} ${ey + r} ` +
        `V ${ey + h - r} Q ${ex + w} ${ey + h} ${ex + w - r} ${ey + h} ` +
        `H ${ex + r} Q ${ex} ${ey + h} ${ex} ${ey + h - r} ` +
        `V ${ey + r} Q ${ex} ${ey} ${ex + r} ${ey} Z`
      );
    }

    case "circle": {
      const cx = parseFloat(el.getAttribute("cx") ?? "0");
      const cy = parseFloat(el.getAttribute("cy") ?? "0");
      const r = parseFloat(el.getAttribute("r") ?? "0");
      const k = 0.5522847498;

      return (
        `M ${cx} ${cy - r} C ${cx + r * k} ${cy - r} ${cx + r} ${cy - r * k} ${cx + r} ${cy} ` +
        `C ${cx + r} ${cy + r * k} ${cx + r * k} ${cy + r} ${cx} ${cy + r} ` +
        `C ${cx - r * k} ${cy + r} ${cx - r} ${cy + r * k} ${cx - r} ${cy} ` +
        `C ${cx - r} ${cy - r * k} ${cx - r * k} ${cy - r} ${cx} ${cy - r} Z`
      );
    }

    case "ellipse": {
      const cx = parseFloat(el.getAttribute("cx") ?? "0");
      const cy = parseFloat(el.getAttribute("cy") ?? "0");
      const rx = parseFloat(el.getAttribute("rx") ?? "0");
      const ry = parseFloat(el.getAttribute("ry") ?? "0");
      const k = 0.5522847498;

      return (
        `M ${cx} ${cy - ry} C ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} ` +
        `C ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} ` +
        `C ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} ` +
        `C ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} Z`
      );
    }

    case "polygon":
    case "polyline": {
      const pts = (el.getAttribute("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);

      if (pts.length < 2) return "";

      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length - 1; i += 2) {
        d += ` L ${pts[i]} ${pts[i + 1]}`;
      }
      if (tag === "polygon") d += " Z";
      return d;
    }

    default:
      return "";
  }
}

function scaleSvgPathNumbers(d: string, scaleX: number, scaleY: number): string {
  const tokens = d.match(
    /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  );
  if (!tokens) return d;

  const argCounts: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  };

  const xArgIdx: Record<string, number[]> = {
    M: [0],
    L: [0],
    H: [0],
    V: [],
    C: [0, 2, 4],
    S: [0, 2],
    Q: [0, 2],
    T: [0],
    A: [5],
  };

  const yArgIdx: Record<string, number[]> = {
    M: [1],
    L: [1],
    H: [],
    V: [0],
    C: [1, 3, 5],
    S: [1, 3],
    Q: [1, 3],
    T: [1],
    A: [6],
  };

  const out: string[] = [];
  let cmd = "";
  let argIdx = 0;

  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      cmd = tok.toUpperCase();
      argIdx = 0;
      out.push(tok);
    } else {
      const n = parseFloat(tok);
      const count = argCounts[cmd] ?? 2;
      const posInGroup = count > 0 ? argIdx % count : 0;
      const isX = (xArgIdx[cmd] ?? []).includes(posInGroup);
      const isY = (yArgIdx[cmd] ?? []).includes(posInGroup);

      let scaled = n;
      if (isX) scaled = n * scaleX;
      else if (isY) scaled = n * scaleY;

      if (cmd === "A" && posInGroup === 0) scaled = n * scaleX;
      if (cmd === "A" && posInGroup === 1) scaled = n * scaleY;

      out.push(String(parseFloat(scaled.toFixed(3))));
      argIdx++;
    }
  }

  return out.join(" ");
}

function parseTransform(
  t: string
): [number, number, number, number, number, number] {
  let a = 1,
    b = 0,
    c = 0,
    d = 1,
    e = 0,
    f = 0;

  const mat = t.match(/matrix\(([^)]+)\)/);
  if (mat) {
    [a, b, c, d, e, f] = mat[1].split(/[\s,]+/).map(Number);
    return [a, b, c, d, e, f];
  }

  const trans = t.match(/translate\(([^)]+)\)/);
  if (trans) {
    const [tx, ty = 0] = trans[1].split(/[\s,]+/).map(Number);
    e = tx;
    f = ty;
  }

  const scale = t.match(/scale\(([^)]+)\)/);
  if (scale) {
    const [sx, sy = sx] = scale[1].split(/[\s,]+/).map(Number);
    a *= sx;
    d *= sy;
  }

  return [a, b, c, d, e, f];
}

function getAccumulatedTransform(
  el: Element
): [number, number, number, number, number, number] {
  const mats: Array<[number, number, number, number, number, number]> = [];
  let node: Element | null = el;

  while (node && node.tagName.toLowerCase() !== "svg") {
    const t = node.getAttribute("transform");
    if (t) mats.unshift(parseTransform(t));
    node = node.parentElement;
  }

  let r: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

  for (const m of mats) {
    r = [
      r[0] * m[0] + r[2] * m[1],
      r[1] * m[0] + r[3] * m[1],
      r[0] * m[2] + r[2] * m[3],
      r[1] * m[2] + r[3] * m[3],
      r[0] * m[4] + r[2] * m[5] + r[4],
      r[1] * m[4] + r[3] * m[5] + r[5],
    ];
  }

  return r;
}

function applyTransformToPathString(
  d: string,
  m: [number, number, number, number, number, number]
): string {
  const [a, b, c, dd, e, f] = m;
  const tokens = d.match(
    /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  );
  if (!tokens) return d;

  const out: string[] = [];
  let cmd = "";
  let nums: number[] = [];

  const flush = () => {
    if (!cmd) return;

    switch (cmd.toUpperCase()) {
      case "M":
      case "L":
      case "T":
        for (let i = 0; i < nums.length; i += 2) {
          const nx = a * nums[i] + c * nums[i + 1] + e;
          const ny = b * nums[i] + dd * nums[i + 1] + f;
          out.push(cmd, String(parseFloat(nx.toFixed(3))), String(parseFloat(ny.toFixed(3))));
          cmd = "L";
        }
        break;

      case "C":
        for (let i = 0; i < nums.length; i += 6) {
          const pts = nums.slice(i, i + 6);
          const t: number[] = [];
          for (let j = 0; j < 6; j += 2) {
            t.push(
              a * pts[j] + c * pts[j + 1] + e,
              b * pts[j] + dd * pts[j + 1] + f
            );
          }
          out.push("C", ...t.map((v) => String(parseFloat(v.toFixed(3)))));
        }
        break;

      case "Q":
      case "S":
        for (let i = 0; i < nums.length; i += 4) {
          const pts = nums.slice(i, i + 4);
          const t: number[] = [];
          for (let j = 0; j < 4; j += 2) {
            t.push(
              a * pts[j] + c * pts[j + 1] + e,
              b * pts[j] + dd * pts[j + 1] + f
            );
          }
          out.push(cmd, ...t.map((v) => String(parseFloat(v.toFixed(3)))));
        }
        break;

      case "H":
        for (const x of nums) {
          out.push("L", String(parseFloat((a * x + e).toFixed(3))), String(parseFloat(f.toFixed(3))));
        }
        break;

      case "V":
        for (const y of nums) {
          out.push("L", String(parseFloat(e.toFixed(3))), String(parseFloat((dd * y + f).toFixed(3))));
        }
        break;

      case "Z":
        out.push("Z");
        break;

      default:
        out.push(cmd, ...nums.map(String));
    }

    nums = [];
  };

  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      flush();
      cmd = tok.toUpperCase();
    } else {
      nums.push(parseFloat(tok));
    }
  }
  flush();

  return out.join(" ");
}

/** Parse an uploaded SVG's shapes into a single flattened path scaled to a target size. */
export function extractSvgPaths(
  svgText: string,
  targetSize = TARGET_SVG_SIZE
): { pathData: string; w: number; h: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;

  const svgEl = doc.querySelector("svg");
  const vb = svgEl?.getAttribute("viewBox")?.split(/\s+/).map(Number);

  const parsedW = parseFloat(svgEl?.getAttribute("width") ?? "400");
  const parsedH = parseFloat(svgEl?.getAttribute("height") ?? "400");

  const srcW = vb?.[2] ?? (Number.isFinite(parsedW) ? parsedW : 400);
  const srcH = vb?.[3] ?? (Number.isFinite(parsedH) ? parsedH : 400);

  const sx = targetSize / srcW;
  const sy = targetSize / srcH;

  const shapeEls = doc.querySelectorAll(
    "path, rect, circle, ellipse, polygon, polyline"
  );

  const parts: string[] = [];

  shapeEls.forEach((el) => {
    const display = el.getAttribute("display");
    if (display === "none") return;

    const visibility = el.getAttribute("visibility");
    if (visibility === "hidden") return;

    let d = svgElementToPathData(el);
    if (!d) return;

    const mat = getAccumulatedTransform(el);
    const isIdentity =
      mat[0] === 1 &&
      mat[1] === 0 &&
      mat[2] === 0 &&
      mat[3] === 1 &&
      mat[4] === 0 &&
      mat[5] === 0;

    if (!isIdentity) d = applyTransformToPathString(d, mat);

    parts.push(scaleSvgPathNumbers(d, sx, sy));
  });

  if (parts.length === 0) return null;

  return {
    pathData: parts.join(" "),
    w: targetSize,
    h: targetSize,
  };
}
