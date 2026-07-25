import type { Pair, Pen, SceneElement, SceneMeta } from "../../asy/scene/types";

export const WHITEBOARD_SCHEMA_VERSION = 3 as const;

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
    | { id: CurveId; kind: "ellipse"; center: PointId; axisX: Pair; axisY: Pair }
    | {
          id: CurveId;
          kind: "arc";
          /**
           * A smart arc is defined by three real sketch points — its center and
           * two rim endpoints — so the endpoints are independently draggable,
           * snap-attachable, and (later) constrainable. The drawn radius is
           * `|center − start|`; `end` supplies only the swept-to angle (it may
           * sit off that circle until a point-on-circle constraint pins it). The
           * arc is the CCW sweep from `start`'s angle to `end`'s angle, matching
           * the Scene `arc` element's angle convention.
           */
          center: PointId;
          start: PointId;
          end: PointId;
      }
    | {
          id: CurveId;
          kind: "elliptical-arc";
          center: PointId;
          /** Affine images of the source circle's unit X/Y radius vectors. */
          axisX: Pair;
          axisY: Pair;
          /** Real sketch points that retain endpoint snapping and constraints. */
          start: PointId;
          end: PointId;
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
    // `point` lies on `curveId` — a segment's line, or a circle/arc's circle.
    | { kind: "point-on-curve"; point: PointFeatureRef; curveId: CurveId }
    // The two curves are tangent (an arc/circle and a segment's supporting line).
    | { kind: "tangent"; a: CurveId; b: CurveId }
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
    /** Optional so migrated legacy documents remain valid without synthesized data. */
    dimensions?: Record<string, LengthDimension>;
    meta?: SceneMeta;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
