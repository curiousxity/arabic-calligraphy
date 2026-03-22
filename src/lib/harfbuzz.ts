import hbjs from "harfbuzzjs";

let hbPromise: Promise<any> | null = null;

export async function initHarfBuzz() {
  if (!hbPromise) {
    hbPromise = (async () => {
      const wasm = await fetch("/hb.wasm").then((r) => r.arrayBuffer());
      const result = await WebAssembly.instantiate(wasm, {});
      return hbjs(result.instance);
    })();
  }
  return hbPromise;
}

export async function shapeText(text: string, fontUrl: string) {
  const hb = await initHarfBuzz();
  const fontData = await fetch(fontUrl).then((r) => r.arrayBuffer());

  const blob = hb.createBlob(fontData);
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer, []);

  const glyphs = buffer.json();

  buffer.destroy?.();
  font.destroy?.();
  face.destroy?.();
  blob.destroy?.();

  return glyphs;
}
