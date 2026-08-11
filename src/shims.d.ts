declare module 'react-konva-to-svg';
declare module 'harfbuzzjs';
declare module 'imagetracerjs' {
  interface ImageTracerPaletteColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }
  interface ImageTracerOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    numberofcolors?: number;
    pal?: ImageTracerPaletteColor[];
    viewbox?: boolean;
    roundcoords?: number;
    scale?: number;
  }
  interface ImageTracerAPI {
    imagedataToSVG(imageData: ImageData, options?: ImageTracerOptions): string;
  }
  const ImageTracer: ImageTracerAPI;
  export default ImageTracer;
}

interface EyeDropperResult {
  sRGBHex: string;
}

interface Window {
  EyeDropper?: new () => {
    open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
  };
}