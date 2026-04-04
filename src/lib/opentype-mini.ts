/**
 * opentype-mini.ts
 *
 * Zero-dependency minimal OpenType/TrueType font parser.
 * Replaces opentype.js — only implements what this app uses:
 *   - parse(ArrayBuffer) → MiniFont
 *   - font.unitsPerEm
 *   - font.glyphs.get(glyphId) → MiniGlyph | null
 *   - glyph.getPath(x, y, fontSize) → MiniPath
 *   - path.commands  (array of {type, x, y, x1, y1, x2, y2})
 *   - path.getBoundingBox() → {x1, y1, x2, y2}
 *
 * Supports TTF (glyf/loca tables) and CFF (PostScript outlines).
 * Does NOT support hinting, color, variable fonts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "Z" };

export interface MiniPath {
  commands: PathCommand[];
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
}

export interface MiniGlyph {
  getPath(x: number, y: number, fontSize: number): MiniPath;
}

export interface MiniFont {
  unitsPerEm: number;
  glyphs: { get(id: number): MiniGlyph | null };
}

// ─── Binary reader ────────────────────────────────────────────────────────────

class Reader {
  private v: DataView;
  pos = 0;
  constructor(buf: ArrayBuffer) { this.v = new DataView(buf); }
  u8()  { return this.v.getUint8(this.pos++); }
  i8()  { const v = this.v.getInt8(this.pos); this.pos++; return v; }
  u16() { const v = this.v.getUint16(this.pos); this.pos += 2; return v; }
  i16() { const v = this.v.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.v.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.v.getInt32(this.pos); this.pos += 4; return v; }
  tag() { return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8()); }
  seek(p: number) { this.pos = p; }
  skip(n: number) { this.pos += n; }
  slice(offset: number, len: number) { return this.v.buffer.slice(offset, offset + len); }
}

// ─── Path builder ─────────────────────────────────────────────────────────────

function buildPath(cmds: PathCommand[]): MiniPath {
  return {
    commands: cmds,
    getBoundingBox() {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      const expand = (x: number, y: number) => {
        if (x < x1) x1 = x; if (x > x2) x2 = x;
        if (y < y1) y1 = y; if (y > y2) y2 = y;
      };
      for (const c of cmds) {
        if (c.type === "M" || c.type === "L") expand(c.x, c.y);
        else if (c.type === "Q") { expand(c.x1, c.y1); expand(c.x, c.y); }
        else if (c.type === "C") { expand(c.x1, c.y1); expand(c.x2, c.y2); expand(c.x, c.y); }
      }
      if (!isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
      return { x1, y1, x2, y2 };
    },
  };
}

function emptyPath(): MiniPath { return buildPath([]); }

// ─── Scale path ───────────────────────────────────────────────────────────────

function scalePath(cmds: PathCommand[], ox: number, oy: number, scale: number, upm: number): MiniPath {
  // opentype.js convention: y is flipped (font units go up, canvas goes down)
  const s = scale / upm;
  const tx = (v: number) => ox + v * s;
  const ty = (v: number) => oy - v * s; // flip Y

  const out: PathCommand[] = cmds.map((c) => {
    switch (c.type) {
      case "M": return { type: "M", x: tx(c.x), y: ty(c.y) };
      case "L": return { type: "L", x: tx(c.x), y: ty(c.y) };
      case "Q": return { type: "Q", x1: tx(c.x1), y1: ty(c.y1), x: tx(c.x), y: ty(c.y) };
      case "C": return { type: "C", x1: tx(c.x1), y1: ty(c.y1), x2: tx(c.x2), y2: ty(c.y2), x: tx(c.x), y: ty(c.y) };
      case "Z": return { type: "Z" };
    }
  });
  return buildPath(out);
}

// ─── TTF glyf table parser ────────────────────────────────────────────────────

function parseTtfContours(r: Reader, offset: number, upm: number): PathCommand[] {
  r.seek(offset);
  const numContours = r.i16();
  if (numContours === 0) return [];
  r.skip(8); // xMin, yMin, xMax, yMax (i16 × 4)

  if (numContours < 0) {
    // Composite glyph — skip for now, return empty
    return [];
  }

  const endPts: number[] = [];
  for (let i = 0; i < numContours; i++) endPts.push(r.u16());
  const numPoints = endPts[endPts.length - 1] + 1;

  const instrLen = r.u16();
  r.skip(instrLen);

  // Flags
  const flags: number[] = [];
  while (flags.length < numPoints) {
    const f = r.u8();
    flags.push(f);
    if (f & 8) { // repeat
      let rep = r.u8();
      while (rep--) flags.push(f);
    }
  }

  // Coordinates
  const readCoords = (isX: boolean): number[] => {
    const coords: number[] = [];
    let val = 0;
    for (let i = 0; i < numPoints; i++) {
      const f = flags[i];
      const shortBit = isX ? 1 : 2;    // bit 1 = xShort, bit 2 = yShort
      const sameBit  = isX ? 16 : 32;  // bit 4 = xSame,  bit 5 = ySame
      if (f & shortBit) {
        const delta = r.u8();
        val += (f & sameBit) ? delta : -delta;
      } else if (!(f & sameBit)) {
        val += r.i16();
      }
      coords.push(val);
    }
    return coords;
  };

  const xs = readCoords(true);
  const ys = readCoords(false);

  // Convert to path commands (TrueType quadratic splines)
  const cmds: PathCommand[] = [];
  let ptIdx = 0;
  for (let c = 0; c < numContours; c++) {
    const end = endPts[c];
    const contourLen = end - ptIdx + 1;
    const cx: number[] = [], cy: number[] = [], cf: number[] = [];
    for (let i = 0; i < contourLen; i++) {
      cx.push(xs[ptIdx + i]); cy.push(ys[ptIdx + i]); cf.push(flags[ptIdx + i]);
    }

    // Find first on-curve point
    let start = 0;
    while (start < contourLen && !(cf[start] & 1)) start++;

    const px = (i: number) => cx[i % contourLen];
    const py = (i: number) => cy[i % contourLen];
    const pf = (i: number) => cf[i % contourLen];

    cmds.push({ type: "M", x: px(start), y: py(start) });

    let i = start + 1;
    while (i <= start + contourLen) {
      const idx = i % contourLen;
      if (pf(idx) & 1) {
        // On-curve → line
        cmds.push({ type: "L", x: px(idx), y: py(idx) });
        i++;
      } else {
        // Off-curve → quadratic spline
        let qx = px(idx), qy = py(idx);
        i++;
        while (i <= start + contourLen) {
          const nidx = i % contourLen;
          if (pf(nidx) & 1) {
            cmds.push({ type: "Q", x1: qx, y1: qy, x: px(nidx), y: py(nidx) });
            i++;
            break;
          } else {
            // Two consecutive off-curve: implied on-curve midpoint
            const mx = (qx + px(nidx)) / 2;
            const my = (qy + py(nidx)) / 2;
            cmds.push({ type: "Q", x1: qx, y1: qy, x: mx, y: my });
            qx = px(nidx); qy = py(nidx);
            i++;
          }
        }
      }
    }
    cmds.push({ type: "Z" });
    ptIdx = end + 1;
  }
  return cmds;
}

// ─── CFF charstring parser (Type 2) ──────────────────────────────────────────

function parseCffCharstring(data: Uint8Array): PathCommand[] {
  const cmds: PathCommand[] = [];
  let i = 0;
  const stack: number[] = [];
  let cx = 0, cy = 0;
  const push = (v: number) => stack.push(v);
  const pop = () => stack.pop() ?? 0;
  const clear = () => { stack.length = 0; };
  const moveto = (x: number, y: number) => { cx += x; cy += y; cmds.push({ type: "M", x: cx, y: cy }); };
  const lineto = (x: number, y: number) => { cx += x; cy += y; cmds.push({ type: "L", x: cx, y: cy }); };
  const curveto = (dx1:number,dy1:number,dx2:number,dy2:number,dx:number,dy:number) => {
    const x1=cx+dx1,y1=cy+dy1,x2=x1+dx2,y2=y1+dy2; cx=x2+dx; cy=y2+dy;
    cmds.push({type:"C",x1,y1,x2,y2,x:cx,y:cy});
  };

  while (i < data.length) {
    const b = data[i++];
    if (b === 14) break; // endchar
    if (b === 21) { const dy=pop(),dx=pop(); moveto(dx,dy); clear(); } // rmoveto
    if (b === 22) { const dx=pop(); moveto(dx,0); clear(); }           // hmoveto
    if (b === 4)  { const dy=pop(); moveto(0,dy); clear(); }           // vmoveto
    if (b === 5)  { while(stack.length>=2){const dy=pop(),dx=pop(); lineto(dx,dy);} } // rlineto
    if (b === 6)  { let h=true; while(stack.length){const v=pop(); h?lineto(v,0):lineto(0,v); h=!h;} } // hlineto
    if (b === 7)  { let h=false; while(stack.length){const v=pop(); h?lineto(v,0):lineto(0,v); h=!h;} } // vlineto
    if (b === 8)  { while(stack.length>=6){const dy=pop(),dx=pop(),dy2=pop(),dx2=pop(),dy1=pop(),dx1=pop(); curveto(dx1,dy1,dx2,dy2,dx,dy);} } // rrcurveto
    if (b === 30) { // vhcurveto
      let vert=true;
      while(stack.length>=4){
        if(vert){const dy1=pop(),dx2=pop(),dy2=pop(),dx3=pop(); const tail=stack.length===1?pop():0; curveto(0,dy1,dx2,dy2,dx3,tail); vert=false;}
        else{const dx1=pop(),dx2=pop(),dy2=pop(),dy3=pop(); const tail=stack.length===1?pop():0; curveto(dx1,0,dx2,dy2,tail,dy3); vert=true;}
      }
    }
    if (b === 31) { // hvcurveto
      let horiz=true;
      while(stack.length>=4){
        if(horiz){const dx1=pop(),dx2=pop(),dy2=pop(),dy3=pop(); const tail=stack.length===1?pop():0; curveto(dx1,0,dx2,dy2,tail,dy3); horiz=false;}
        else{const dy1=pop(),dx2=pop(),dy2=pop(),dx3=pop(); const tail=stack.length===1?pop():0; curveto(0,dy1,dx2,dy2,dx3,tail); horiz=true;}
      }
    }
    if (b >= 32 && b <= 246)  push(b - 139);
    else if (b >= 247 && b <= 250) push((b-247)*256 + data[i++] + 108);
    else if (b >= 251 && b <= 254) push(-(b-251)*256 - data[i++] - 108);
    else if (b === 28) { push((data[i]<<8|data[i+1])<<16>>16); i+=2; }
    else if (b === 29) { push((data[i]<<24|data[i+1]<<16|data[i+2]<<8|data[i+3])|0); i+=4; }
  }
  if (cmds.length > 0) cmds.push({ type: "Z" });
  return cmds;
}

// ─── Table reader helpers ─────────────────────────────────────────────────────

function readU16(buf: ArrayBuffer, off: number) { return new DataView(buf).getUint16(off); }
function readU32(buf: ArrayBuffer, off: number) { return new DataView(buf).getUint32(off); }
function readI16(buf: ArrayBuffer, off: number) { return new DataView(buf).getInt16(off); }

function findTable(buf: ArrayBuffer, name: string): { offset: number; length: number } | null {
  const r = new Reader(buf);
  r.seek(4); // skip sfVersion
  const numTables = r.u16();
  r.skip(6);
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag();
    r.skip(4); // checksum
    const offset = r.u32();
    const length = r.u32();
    if (tag === name) return { offset, length };
  }
  return null;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parse(buf: ArrayBuffer): MiniFont {
  const head = findTable(buf, "head");
  const upm = head ? readU16(buf, head.offset + 18) : 1000;

  // ── Try TTF (glyf + loca) ──
  const glyf = findTable(buf, "glyf");
  const loca = findTable(buf, "loca");
  const maxpT = findTable(buf, "maxp");
  const locaFmt = head ? readI16(buf, head.offset + 50) : 0; // indexToLocFormat

  if (glyf && loca) {
    const numGlyphs = maxpT ? readU16(buf, maxpT.offset + 4) : 0;

    const getGlyphOffset = (id: number): number => {
      if (locaFmt === 0) {
        return readU16(buf, loca!.offset + id * 2) * 2;
      } else {
        return readU32(buf, loca!.offset + id * 4);
      }
    };

    const glyphMap = new Map<number, MiniGlyph>();
    const getGlyph = (id: number): MiniGlyph | null => {
      if (id < 0 || id >= numGlyphs) return null;
      if (glyphMap.has(id)) return glyphMap.get(id)!;
      const off = getGlyphOffset(id);
      const nextOff = getGlyphOffset(id + 1);
      if (off === nextOff) {
        // Empty glyph (space etc.)
        const g: MiniGlyph = { getPath: () => emptyPath() };
        glyphMap.set(id, g);
        return g;
      }
      const r = new Reader(buf);
      const rawCmds = parseTtfContours(r, glyf!.offset + off, upm);
      const g: MiniGlyph = {
        getPath(x: number, y: number, fontSize: number) {
          return scalePath(rawCmds, x, y, fontSize, upm);
        },
      };
      glyphMap.set(id, g);
      return g;
    };

    return { unitsPerEm: upm, glyphs: { get: getGlyph } };
  }

  // ── Try CFF ──
  const cffTable = findTable(buf, "CFF ");
  if (cffTable) {
    const cffData = new Uint8Array(buf, cffTable.offset, cffTable.length);
    // Parse CFF header to find charstrings
    let off = 0;
    off += 4; // header: major, minor, hdrSize, offSize
    // Skip Name INDEX
    const skipIndex = (o: number): number => {
      const count = (cffData[o] << 8) | cffData[o + 1]; o += 2;
      if (count === 0) return o;
      const offSize = cffData[o++];
      const lastOff = readIndexOffset(cffData, o + count * offSize, offSize);
      return o + (count + 1) * offSize + lastOff - 1;
    };
    const readIndexOffset = (d: Uint8Array, pos: number, offSize: number): number => {
      let v = 0;
      for (let i = 0; i < offSize; i++) v = (v << 8) | d[pos + i];
      return v;
    };
    off = skipIndex(off); // Name
    off = skipIndex(off); // Top DICT

    // Find charstrings by scanning Top DICT for key 17
    // (simplified: find charstrings INDEX directly after String INDEX)
    off = skipIndex(off); // String INDEX
    // Charstrings INDEX
    const csStart = off;
    const csCount = (cffData[csStart] << 8) | cffData[csStart + 1];
    const csOffSize = cffData[csStart + 2];
    const csDataStart = csStart + 2 + 1 + (csCount + 1) * csOffSize;

    const getCharstring = (id: number): Uint8Array | null => {
      if (id < 0 || id >= csCount) return null;
      const offBase = csStart + 2 + 1;
      const o1 = readIndexOffset(cffData, offBase + id * csOffSize, csOffSize);
      const o2 = readIndexOffset(cffData, offBase + (id + 1) * csOffSize, csOffSize);
      return cffData.slice(csDataStart + o1 - 1, csDataStart + o2 - 1);
    };

    const glyphMap = new Map<number, MiniGlyph>();
    const getGlyph = (id: number): MiniGlyph | null => {
      if (glyphMap.has(id)) return glyphMap.get(id)!;
      const cs = getCharstring(id);
      if (!cs) return null;
      const rawCmds = parseCffCharstring(cs);
      const g: MiniGlyph = {
        getPath(x: number, y: number, fontSize: number) {
          return scalePath(rawCmds, x, y, fontSize, upm);
        },
      };
      glyphMap.set(id, g);
      return g;
    };

    return { unitsPerEm: upm, glyphs: { get: getGlyph } };
  }

  // Fallback: empty font
  return { unitsPerEm: upm, glyphs: { get: () => null } };
}
