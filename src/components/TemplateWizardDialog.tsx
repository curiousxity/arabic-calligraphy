import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { templateFieldDefaults, type StarterTemplate } from "../lib/templates";

export type TemplateWizardDialogProps = {
  template: StarterTemplate;
  onGenerate: (values: string[]) => void;
  onCancel: () => void;
};

/**
 * Modal for the "Start from a Template" wizard flow: one RTL text field per
 * template field (StarterTemplate.fields), pre-filled with that block's
 * original text. Modeled on ConfirmDialog.tsx's portaled-overlay pattern.
 * Folds in the "this replaces the canvas" warning ConfirmDialog used to
 * show separately for templates — filling out this form is already a
 * deliberate multi-step action, so a second confirmation on top of
 * Generate would be redundant friction, not added safety.
 */
export const TemplateWizardDialog: React.FC<TemplateWizardDialogProps> = ({
  template,
  onGenerate,
  onCancel,
}) => {
  const fields = template.fields ?? [];
  const [values, setValues] = useState<string[]>(() => templateFieldDefaults(template));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div
      className="confirmDialogOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirmDialog templateWizardDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="templateWizardDialogTitle"
      >
        <div id="templateWizardDialogTitle" className="confirmDialogTitle">
          {template.label}
        </div>
        <div className="confirmDialogMessage">{template.description}</div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onGenerate(values);
          }}
        >
          {/* Single-line only: a TextBlock's text may contain newlines, but no
              current template's default does, and a <textarea> here would both
              reshape the dialog layout and break Enter-to-submit. */}
          {fields.map((field, i) => (
            <div className="templateWizardField" key={i}>
              <label htmlFor={`template-wizard-field-${i}`}>{field.label}</label>
              <input
                id={`template-wizard-field-${i}`}
                className="templateWizardInput"
                type="text"
                value={values[i] ?? ""}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setValues(next);
                }}
                dir="rtl"
                lang="ar"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus={i === 0}
              />
            </div>
          ))}

          <div className="templateWizardWarning">
            This replaces every block currently on the canvas. Ctrl+Z will bring your design back if you change your mind.
          </div>

          <div className="confirmDialogActions">
            <button type="button" className="sidebarSmallAction" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="sidebarSmallAction sidebarSmallAction--accent">
              Generate
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default TemplateWizardDialog;
