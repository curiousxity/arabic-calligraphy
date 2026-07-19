import { useState } from "react";
import { ARABIC_KEYBOARD_ROWS, type ArabicKeyDef } from "../../lib/arabicKeyboardLayout";

export const ArabicKeyboard = ({
  onInsert,
  onBackspace,
}: {
  onInsert: (value: string) => void;
  onBackspace: () => void;
}) => {
  const [shift, setShift] = useState(false);

  const renderKey = (k: ArabicKeyDef, idx: number) => {
    const label = shift ? k.shift : k.base;
    const hint = shift ? k.base : k.shift;
    return (
      <button
        key={idx}
        type="button"
        onClick={() => onInsert(label)}
        className={
          label.length > 1
            ? "sidebarPresetKeyboardKey sidebarPresetKeyboardKeyWide"
            : "sidebarPresetKeyboardKey"
        }
      >
        <span className="sidebarPresetKeyboardKeyHint">{hint}</span>
        {label}
      </button>
    );
  };

  const shiftButton = (key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setShift((v) => !v)}
      className={
        shift
          ? "sidebarPresetKeyboardKey sidebarPresetKeyboardKeyAction sidebarPresetKeyboardKeyActive"
          : "sidebarPresetKeyboardKey sidebarPresetKeyboardKeyAction"
      }
      title="Shift"
      aria-label="Shift"
      aria-pressed={shift}
    >
      ⇧
    </button>
  );

  return (
    <div className="sidebarPresetKeyboard">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="sidebarPresetKeyboardRow">
          {ARABIC_KEYBOARD_ROWS[0].map(renderKey)}
          <button
            type="button"
            onClick={onBackspace}
            className="sidebarPresetKeyboardKey sidebarPresetKeyboardKeyAction"
            title="Backspace"
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>

        <div className="sidebarPresetKeyboardRow">
          {ARABIC_KEYBOARD_ROWS[1].map(renderKey)}
        </div>

        <div className="sidebarPresetKeyboardRow">
          {ARABIC_KEYBOARD_ROWS[2].map(renderKey)}
          <button
            type="button"
            onClick={() => onInsert("\n")}
            className="sidebarPresetKeyboardKey sidebarPresetKeyboardKeyAction"
            title="New line"
            aria-label="New line"
          >
            ↵
          </button>
        </div>

        <div className="sidebarPresetKeyboardRow">
          {shiftButton("shift-left")}
          {ARABIC_KEYBOARD_ROWS[3].map(renderKey)}
          {shiftButton("shift-right")}
        </div>

        <div className="sidebarPresetKeyboardRow">
          <button
            type="button"
            onClick={() => onInsert(" ")}
            className="sidebarPresetKeyboardKey sidebarPresetKeyboardKeySpace"
          >
            مسافة
          </button>
        </div>
      </div>
    </div>
  );
};
