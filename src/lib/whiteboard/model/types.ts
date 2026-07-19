import type { Pair, Pen, SceneElement, SceneMeta } from "../../asy/scene/types";

export const WHITEBOARD_SCHEMA_VERSION = 2 as const;

export type PointId = string;
export type ParameterId = string;
export type CurveId = string;
export type ConstraintId = string;

export interface SketchPoint {
    id: PointId;
    at: Pair;
}

export interface ScalarParameter {
    id: ParameterId;
    name?: string;
    value: number;
    unit: "length" | "angle" | "unitless";
}

export type SketchCurve =
    | { id: CurveId; kind: "segment"; start: PointId; end: PointId }
    | { id: CurveId; kind: "circle"; center: PointId; radius: number }
    | {
          id: CurveId;
          kind: "arc";
          center: PointId;
          radius: number;
          startAngle: number;
          sweepAngle: number;
      };

export type PointFeatureRef =
    | { kind: "point"; pointId: PointId }
    | { kind: "curve-point"; curveId: CurveId; feature: "center" | "start" | "end" };

export type CurveFeatureRef = { kind: "curve"; curveId: CurveId };
export type FeatureRef = PointFeatureRef | CurveFeatureRef;

export type Constraint = {
    id: ConstraintId;
    enabled: boolean;
    origin: "explicit" | "inferred";
} & (
    | { kind: "coincident"; a: PointFeatureRef; b: PointFeatureRef }
    | { kind: "horizontal" | "vertical"; curveId: CurveId }
    | { kind: "parallel" | "perpendicular" | "equal-length"; a: CurveId; b: CurveId }
    | { kind: "fixed-point"; point: PointFeatureRef; at: Pair }
    | { kind: "distance"; a: PointFeatureRef; b: PointFeatureRef; value: ParameterId }
    | {
          kind: "radial-distance";
          curveId: CurveId;
          value: ParameterId;
          display: "radius" | "diameter";
      }
    | { kind: "angle"; a: CurveId; b: CurveId; value: ParameterId }
);

export interface SketchGraph {
    points: Record<PointId, SketchPoint>;
    parameters: Record<ParameterId, ScalarParameter>;
    curves: Record<CurveId, SketchCurve>;
    constraints: Record<ConstraintId, Constraint>;
}

export interface LengthDimension {
    id: string;
    kind: "length";
    mode: "driving" | "reference";
    a: PointFeatureRef;
    b: PointFeatureRef;
    /** Present only for driving dimensions. */
    constraintId?: ConstraintId;
    /** Scene-space label offset from the measured segment midpoint. */
    labelOffset?: Pair;
}

export interface BakedItem {
    kind: "baked";
    element: SceneElement;
}

interface PresentationStyle {
    pen?: Pen;
    fillPen?: Pen;
    strokeEnabled?: boolean;
}

export interface SketchPathItem extends PresentationStyle {
    id: string;
    kind: "sketch-path";
    uses: Array<{ curveId: CurveId; reversed: boolean }>;
    cyclic: boolean;
}

export interface SketchCurveItem extends PresentationStyle {
    id: string;
    kind: "sketch-curve";
    curveId: CurveId;
}

export interface SketchPointMarkerItem {
    id: string;
    kind: "sketch-point-marker";
    pointId: PointId;
    pen?: Pen;
    strokeEnabled?: boolean;
}

export type WhiteboardItem = BakedItem | SketchPathItem | SketchCurveItem | SketchPointMarkerItem;

export interface WhiteboardDocument {
    schemaVersion: typeof WHITEBOARD_SCHEMA_VERSION;
    items: WhiteboardItem[];
    sketch: SketchGraph;
    /** Optional so persisted Phase 1/2 V2 documents remain valid without migration. */
    dimensions?: Record<string, LengthDimension>;
    meta?: SceneMeta;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
