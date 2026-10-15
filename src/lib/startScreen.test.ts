import { describe, it, expect } from "vitest";
import { STARTER_TEXT, shouldShowStartScreen, startingText } from "./startScreen";

describe("startScreen", () => {
  it("uses the starter word when the field is blank", () => {
    expect(startingText("")).toBe(STARTER_TEXT);
    expect(startingText("   ")).toBe(STARTER_TEXT);
    expect(startingText(" محمد ")).toBe("محمد");
  });
  it("shows only when there is nothing to restore", () => {
    const empty = { getItem: () => null };
    const saved = { getItem: (k: string) => (k === "key" ? "{}" : null) };
    expect(shouldShowStartScreen(empty, "key")).toBe(true);
    expect(shouldShowStartScreen(saved, "key")).toBe(false);
  });
  it("shows when storage is blocked, since nothing can be restored", () => {
    const blocked = {
      getItem: (): string | null => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };
    expect(shouldShowStartScreen(blocked, "key")).toBe(true);
  });
});
