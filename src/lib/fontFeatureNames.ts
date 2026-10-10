/**
 * The names a font gives its stylistic sets and character variants
 * ("Looped Haa"), read straight from the binary. opentype.js exposes
 * `featureParams` only as a bare offset and resolves no name IDs for it, so
 * this walks GSUB → FeatureList → Feature → FeatureParams (whose second
 * uint16 is the UI name ID for both `ssNN` and `cvNN`) and looks the ID up in
 * `name`. Pure and defensive: any out-of-range read yields an empty map.
 */
export function readFeatureNames(bytes: ArrayBuffer): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const v = new DataView(bytes);
    const tag = (o: number) =>
      String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

    const numTables = v.getUint16(4);
    const tables = new Map<string, number>();
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      tables.set(tag(rec), v.getUint32(rec + 8));
    }
    const gsub = tables.get("GSUB");
    const name = tables.get("name");
    if (gsub === undefined || name === undefined) return out;

    const nameIds = new Map<string, number>();
    const featureList = gsub + v.getUint16(gsub + 6);
    const featureCount = v.getUint16(featureList);
    for (let i = 0; i < featureCount; i++) {
      const rec = featureList + 2 + i * 6;
      const t = tag(rec);
      if (!/^(ss|cv)\d\d$/.test(t) || nameIds.has(t)) continue;
      const feature = featureList + v.getUint16(rec + 4);
      const paramsOffset = v.getUint16(feature);
      if (paramsOffset === 0) continue;
      const id = v.getUint16(feature + paramsOffset + 2);
      if (id >= 256) nameIds.set(t, id);
    }
    if (nameIds.size === 0) return out;

    const strings = readNameStrings(v, name);
    for (const [t, id] of nameIds) {
      const s = strings.get(id);
      if (s) out.set(t, s);
    }
  } catch {
    return new Map();
  }
  return out;
}

/** name ID → string, preferring Windows English, then any Windows, then Mac Roman. */
function readNameStrings(v: DataView, table: number): Map<number, string> {
  const count = v.getUint16(table + 2);
  const storage = table + v.getUint16(table + 4);
  const best = new Map<number, { rank: number; text: string }>();

  for (let i = 0; i < count; i++) {
    const rec = table + 6 + i * 12;
    const platform = v.getUint16(rec);
    const language = v.getUint16(rec + 4);
    const nameId = v.getUint16(rec + 6);
    const length = v.getUint16(rec + 8);
    const start = storage + v.getUint16(rec + 10);

    let text = "";
    let rank: number;
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(v.getUint16(start + j));
      rank = platform === 3 && language === 0x0409 ? 0 : 1;
    } else if (platform === 1) {
      for (let j = 0; j < length; j++) text += String.fromCharCode(v.getUint8(start + j));
      rank = 2;
    } else {
      continue;
    }
    const held = best.get(nameId);
    if (!held || rank < held.rank) best.set(nameId, { rank, text });
  }

  return new Map([...best].map(([id, { text }]) => [id, text]));
}
