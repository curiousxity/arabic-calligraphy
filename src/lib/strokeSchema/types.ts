// TypeScript port of the externally-authored Arabic Calligraphy Parametric
// Stroke Schema (arabic_stroke_schema.json / arabic_stroke_types.ts) — kept
// field-for-field compatible so JSON files conforming to that schema can be
// imported directly as GlyphDescription. See src/data/strokeSchemas/ for the
// data and lib/strokeSchema/registry.ts for how files are loaded.

export type ComponentType =
  | "HEAD" | "BODY" | "EYE" | "TOOTH" | "NECK" | "CUP" | "TAIL" | "DOT"
  | "ASCENDER" | "DESCENDER" | "CONNECTOR";

export type Direction =
  | "up-right" | "up-left" | "down-right" | "down-left"
  | "horizontal-right" | "horizontal-left"
  | "loop" | "counterclockwise-loop" | "clockwise-loop";

// Wider than the original schema doc's enum (straight/soft-curve/tight-curve/
// S-curve/hook/loop) — "bowl"/"zig-curve" (noon/ya/meem bowls, hamza's
// zigzag) and the "refined geometry variants" batch's more specific curve
// descriptions (alif-leg, closed-final/-medial, compressed-bowl, deep-bowl,
// narrow-counter, shallow-bowl) aren't consumed by any switch/narrowing
// logic here, so the type just needs to describe them.
export type Curvature =
  | "straight" | "soft-curve" | "tight-curve" | "S-curve" | "hook" | "loop"
  | "bowl" | "zig-curve"
  | "alif-leg" | "closed-final" | "closed-medial" | "compressed-bowl"
  | "deep-bowl" | "narrow-counter" | "shallow-bowl"
  | "linear" | "tooth";

// "join-left"/"join-right" (refined geometry variants batch) mark a terminal
// that flows directly into a join rather than ending freely — display-only,
// same as the rest of this field.
export type Terminal = "blunt" | "sharp" | "teardrop" | "taper" | "hidden" | "join-left" | "join-right";
export type ThicknessProfile =
  | "constant" | "taper-in" | "taper-out" | "taper-in-out" | "contrast-high" | "contrast-low";

export interface Vec2 { x: number; y: number; }
export interface BezierNode extends Vec2 { in?: Vec2; out?: Vec2; tension?: number; }

export interface StretchZone {
  fromNode: number;
  toNode: number;
  axis: "x" | "y" | "path";
  minFactor: number;
  maxFactor: number;
  preserveCurvature?: boolean;
  preserveThickness?: boolean;
  /**
   * Optional per-zone label (e.g. "Height" vs "Length" on the same stroke) —
   * lets one stroke expose several independently named sliders instead of
   * collapsing to a single range. Absent = deriveCatalog.ts falls back to
   * the stroke/component label, exactly as every pre-existing schema file
   * (one zone per stroke) already behaves.
   */
  label?: { ar?: string; en?: string };
}

export interface ProtectedZone {
  fromNode: number;
  toNode: number;
  // Widened beyond the original schema doc's enum to match authored data —
  // bowl-legibility/counter-shape/mark-identity (noon/ya bowls, heh's counter,
  // hamza's mark), left-join-exit/right-join-entry/left-tail-terminal/
  // standalone-balance (contextual-form batch: join-edge and standalone-form
  // protections), and entry-balance/entry-head/entry-join/exit-join/
  // final-terminal/leg-terminal/compressed-bowl/counter-legibility/
  // narrow-counter (refined geometry variants batch) — display-only, no
  // narrowing logic reads this.
  reason:
    | "terminal-shape"
    | "join-integrity"
    | "dot-shape"
    | "loop-legibility"
    | "historical-rule"
    | "bowl-legibility"
    | "counter-shape"
    | "mark-identity"
    | "left-join-exit"
    | "right-join-entry"
    | "left-tail-terminal"
    | "standalone-balance"
    | "entry-balance"
    | "entry-head"
    | "entry-join"
    | "exit-join"
    | "final-terminal"
    | "leg-terminal"
    | "compressed-bowl"
    | "counter-legibility"
    | "narrow-counter"
    | "tooth-rhythm";
}

export interface Stroke {
  id: string;
  function: ComponentType;
  direction?: Direction;
  curvature?: Curvature;
  terminalStart?: Terminal;
  terminalEnd?: Terminal;
  thicknessProfile?: ThicknessProfile;
  startLevel?: string;
  endLevel?: string;
  lengthDots?: number;
  path: { kind: "bezier" | "polyline" | "arc"; nodes: BezierNode[]; };
  editBehavior: {
    stretchZones: StretchZone[];
    protectedZones: ProtectedZone[];
    priority: number;
    kashidaEligible?: boolean;
    elongationStrategy?: "none" | "linear" | "curve-relax" | "repeat-tooth" | "expand-loop";
  };
  labels?: { ar?: string; en?: string; };
}

export interface Component {
  id: string;
  type: ComponentType;
  semanticLabel?: { ar?: string; en?: string; };
  anchors?: { id: string; x: number; y: number; }[];
  strokes: Stroke[];
}

export interface GlyphDescription {
  schemaVersion: string;
  styleProfile: {
    script: "arabic";
    calligraphicModel: "naskh" | "thuluth" | "diwani" | "kufic" | "hybrid";
    measurementSystem: {
      dotUnit: { name: "nuqta"; shape: "rhombic" | "teardrop" | "round"; width: number; height: number; };
      angleDegrees: number;
    };
    verticalLevels: { id: string; name: string; y: number; }[];
  };
  glyph: {
    id: string;
    baseLetter: string;
    joiningForm: "isolated" | "initial" | "medial" | "final" | "ligature" | "ornament";
    role?: "base_letter" | "diacritic" | "ligature" | "ornament";
    unicode?: string;
    /**
     * Bare-codepoint (hex, no 0x prefix) sequence of the base letters this
     * glyph fuses, in logical (typed) order — e.g. ["0627","0644","0644","0647"]
     * for the "الله" ligature. Required (instead of `unicode`) on `role:
     * "ligature"` entries; used as the registry's ligature lookup key (see
     * registry.ts's getLigatureSchema) since a single `unicode` codepoint
     * can't identify a multi-character fused glyph.
     */
    baseLetterSequence?: string[];
    components: Component[];
    /**
     * Present on the contextual-form batch (one file per letter x joining
     * form): whether this specific form connects to the previous/next glyph,
     * which base letter it was derived from, and an optional authoring note.
     * Not yet consumed by any rendering/editor logic — informational metadata
     * only, describing the connection rules the form was generated under.
     */
    formMetadata?: {
      connectsRight: boolean;
      connectsLeft: boolean;
      derivedFrom: string;
      rulesNote?: string;
      /** True on the "refined geometry variants" batch — this form's outline was individually redesigned rather than reusing the base letter's skeleton. Informational only, not consumed by any logic. */
      geometryVariant?: boolean;
    };
  };
}
