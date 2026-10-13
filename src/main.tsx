import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// iOS Safari ignores the viewport's user-scalable=no and zooms the whole
// page on a pinch; its proprietary gesture events are the only way to stop
// that. The canvas has its own pinch zoom (useTouchPinch).
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (e) => e.preventDefault());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);