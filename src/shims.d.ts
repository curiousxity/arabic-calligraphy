declare module 'react-konva-to-svg';
declare module 'harfbuzzjs';
interface EyeDropperResult {
  sRGBHex: string;
}

interface Window {
  EyeDropper?: new () => {
    open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
  };
}