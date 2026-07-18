export type SvgCmd =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

/** Parse an SVG path `d` string into an array of absolute commands. */
export function parseSvgPath(d: string): SvgCmd[] {
  const cmds: SvgCmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);

  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0; // current pos, subpath start
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case "M": { const x = num(), y = num(); cmds.push({ type: "M", x, y }); cx = sx = x; cy = sy = y; break; }
      case "m": { const x = cx + num(), y = cy + num(); cmds.push({ type: "M", x, y }); cx = sx = x; cy = sy = y; break; }
      case "L": { const x = num(), y = num(); cmds.push({ type: "L", x, y }); cx = x; cy = y; break; }
      case "l": { const x = cx + num(), y = cy + num(); cmds.push({ type: "L", x, y }); cx = x; cy = y; break; }
      case "H": { const x = num(); cmds.push({ type: "L", x, y: cy }); cx = x; break; }
      case "h": { const x = cx + num(); cmds.push({ type: "L", x, y: cy }); cx = x; break; }
      case "V": { const y = num(); cmds.push({ type: "L", x: cx, y }); cy = y; break; }
      case "v": { const y = cy + num(); cmds.push({ type: "L", x: cx, y }); cy = y; break; }
      case "C": { const x1=num(),y1=num(),x2=num(),y2=num(),x=num(),y=num(); cmds.push({type:"C",x1,y1,x2,y2,x,y}); cx=x; cy=y; break; }
      case "c": { const x1=cx+num(),y1=cy+num(),x2=cx+num(),y2=cy+num(),x=cx+num(),y=cy+num(); cmds.push({type:"C",x1,y1,x2,y2,x,y}); cx=x; cy=y; break; }
      case "Q": { const x1=num(),y1=num(),x=num(),y=num(); cmds.push({type:"Q",x1,y1,x,y}); cx=x; cy=y; break; }
      case "q": { const x1=cx+num(),y1=cy+num(),x=cx+num(),y=cy+num(); cmds.push({type:"Q",x1,y1,x,y}); cx=x; cy=y; break; }
      case "S": { const x2=num(),y2=num(),x=num(),y=num(); cmds.push({type:"C",x1:cx,y1:cy,x2,y2,x,y}); cx=x; cy=y; break; }
      case "s": { const x2=cx+num(),y2=cy+num(),x=cx+num(),y=cy+num(); cmds.push({type:"C",x1:cx,y1:cy,x2,y2,x,y}); cx=x; cy=y; break; }
      case "Z": case "z": { cmds.push({ type: "Z" }); cx = sx; cy = sy; break; }
      // A (arc) — approximate as a line to endpoint for simplicity
      case "A": { num();num();num();num();num(); const x=num(),y=num(); cmds.push({type:"L",x,y}); cx=x; cy=y; break; }
      case "a": { num();num();num();num();num(); const x=cx+num(),y=cy+num(); cmds.push({type:"L",x,y}); cx=x; cy=y; break; }
      default: break;
    }
  }
  return cmds;
}

/**
 * Build a flat polygon approximation from path commands (for hit testing).
 * Curves are subdivided at a fixed step count.
 */
export function pathToPolygon(cmds: SvgCmd[], steps = 8): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let cx = 0, cy = 0;
  for (const c of cmds) {
    switch (c.type) {
      case "M": cx = c.x; cy = c.y; pts.push([cx, cy]); break;
      case "L": cx = c.x; cy = c.y; pts.push([cx, cy]); break;
      case "Z": break;
      case "C": {
        const ox = cx, oy = cy;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const x = mt*mt*mt*ox + 3*mt*mt*t*c.x1 + 3*mt*t*t*c.x2 + t*t*t*c.x;
          const y = mt*mt*mt*oy + 3*mt*mt*t*c.y1 + 3*mt*t*t*c.y2 + t*t*t*c.y;
          pts.push([x, y]);
        }
        cx = c.x; cy = c.y; break;
      }
      case "Q": {
        const ox = cx, oy = cy;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const x = mt*mt*ox + 2*mt*t*c.x1 + t*t*c.x;
          const y = mt*mt*oy + 2*mt*t*c.y1 + t*t*c.y;
          pts.push([x, y]);
        }
        cx = c.x; cy = c.y; break;
      }
    }
  }
  return pts;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
