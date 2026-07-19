/**
 * Scene / Intermediate Representation (IR).
 *
 * This is the single source of truth for the whiteboard document AND the
 * Asymptote interchange format. The codec (`../codec`) converts Scene <-> asy;
 * the engine (`../engine`) edits Scenes; the Svelte view renders them.
 *
 * BOUNDARY: this module (and everything under `src/lib/asy/`) is pure TS with
 * ZERO Svelte / `$lib` imports, so it stays independently `bun test`-able and
 * extractable to a standalone package later.
 *
 * COORDINATES: every position is stored in **asy-space** — y-up, origin
 * arbitrary, floating point, in asy user units. Only the SVG *view* flips y at
 * render time. So `serialize` is a literal dump of these numbers (faithful
 * round-trip) and `parse` stores asy numbers verbatim.
 */

/** A 2D point in asy-space (y-up). */
export type Pair = readonly [x: number, y: number];

// ---------------------------------------------------------------------------
// Pens / style
// ---------------------------------------------------------------------------

/** RGB color, components in 0..1 (asy convention). */
export interface RGB {
    r: number;
    g: number;
    b: number;
}

export type Dash =
    | "solid"
    | "dashed"
    | "dotted"
    | "longdashed"
    /** Preserve an exotic asy dash spec verbatim for round-trip. */
    | { pattern: string };

/**
 * A pen — the asy notion of stroke/fill style. Every field is optional; an
 * absent field means "asy default" (`currentpen`), which keeps serialization
 * minimal and round-trips faithful.
 */
export interface Pen {
    /** Resolved rgb color. */
    color?: RGB;
    /**
     * Named color as written in the source (`red`, `blue`, ...). Preserved
     * separately so `red` round-trips as `red` rather than degrading to
     * `rgb(1,0,0)`. When set it wins over `color` on serialize.
     */
    namedColor?: string;
    /** asy `linewidth(pt)`. */
    lineWidth?: number;
    dash?: Dash;
    /** asy `opacity(a)`, 0..1. */
    opacity?: number;
    /** For labels: asy `fontsize(pt)`. */
    fontSize?: number;
}

// ---------------------------------------------------------------------------
// Path geometry — the core of asy
// ---------------------------------------------------------------------------

/** Join between two consecutive path nodes: straight `--` or Hobby spline `..`. */
export type Join = "--" | "..";

/**
 * An open or closed path. `joins[i]` is the join between `nodes[i]` and the
 * next node (wrapping to `nodes[0]` when `cyclic`), so:
 *   - open path:   joins.length === nodes.length - 1
 *   - cyclic path: joins.length === nodes.length   (last join closes the cycle)
 *
 * v1 stores only node points + join kind; shared in-app geometry approximates
 * `..` with cubic controls for Canvas, SVG, hit-testing, and bounds. Exact
 * Hobby control points are a v2 upgrade (the asy text is already correct
 * either way).
 */
export interface Path {
    nodes: Pair[];
    joins: Join[];
    cyclic: boolean;
}

// ---------------------------------------------------------------------------
// Scene elements
// ---------------------------------------------------------------------------

export interface ElementBase {
    /** Stable unique id (see `factory.newId`). */
    id: string;
    pen?: Pen;
    /** Explicitly false for fill-only primitives whose absent pen must not mean currentpen. */
    strokeEnabled?: boolean;
}

/** A dot: asy `dot((x,y))`. */
export interface DotElement extends ElementBase {
    kind: "dot";
    at: Pair;
}

/** A stroked path: asy `draw(path, pen)`. */
export interface PathElement extends ElementBase {
    kind: "path";
    path: Path;
    /** Optional interior paint. Only meaningful for cyclic paths. */
    fillPen?: Pen;
}

/**
 * A circle kept first-class (center + radius) so `draw(circle(c,r))`
 * round-trips as `circle(...)` rather than a many-node polyline.
 */
export interface CircleElement extends ElementBase {
    kind: "circle";
    center: Pair;
    radius: number;
    fillPen?: Pen;
}

/** An arc: asy `draw(arc(c, r, angle1, angle2))`. Angles in degrees. */
export interface ArcElement extends ElementBase {
    kind: "arc";
    center: Pair;
    radius: number;
    angle1: number;
    angle2: number;
}

/**
 * An affine image of the unit circle. `axisX` and `axisY` are the transformed
 * unit-circle basis vectors, so a point at parameter t is
 * `center + axisX*cos(t) + axisY*sin(t)`. Keeping the full basis makes repeated
 * anisotropic resize + rotation exact, including sheared parameterizations.
 */
export interface EllipseElement extends ElementBase {
    kind: "ellipse";
    center: Pair;
    axisX: Pair;
    axisY: Pair;
    fillPen?: Pen;
}

/** An affine image of a circular arc, using the same basis convention as an ellipse. */
export interface EllipticalArcElement extends ElementBase {
    kind: "elliptical-arc";
    center: Pair;
    axisX: Pair;
    axisY: Pair;
    angle1: number;
    angle2: number;
}

/** A text label: asy `label("$...$", position, align)`. */
export interface LabelElement extends ElementBase {
    kind: "label";
    /** Label text, typically LaTeX (`$...$`). */
    text: string;
    at: Pair;
    /** Optional alignment direction (asy align pair, e.g. `N`, `(1,0)`). */
    align?: Pair;
}

/** A filled (or filled+stroked) region: asy `fill(path)` / `filldraw(path)`. */
export interface FillElement extends ElementBase {
    kind: "fill";
    path: Path;
    /** When set, this was a `filldraw`: `pen` fills, `drawPen` strokes. */
    drawPen?: Pen;
}

/**
 * The lossless escape hatch: any asy statement the parser doesn't understand is
 * captured verbatim here and re-emitted unchanged. Guarantees "import then
 * export" never loses data. Not editable in the view (shown as a marker; the
 * trace backdrop covers it visually).
 */
export interface RawElement extends ElementBase {
    kind: "raw";
    /** Exact original source text, including the terminating `;`. */
    source: string;
}

export type SceneElement =
    | DotElement
    | PathElement
    | CircleElement
    | ArcElement
    | EllipseElement
    | EllipticalArcElement
    | LabelElement
    | FillElement
    | RawElement;

export type SceneElementKind = SceneElement["kind"];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface SceneMeta {
    /** asy `unitsize`, if authored; preserved for context (not required). */
    unit?: number;
    /** Where this scene came from. */
    source?: "authored" | "import";
}

/**
 * A whole drawing. Bounds are DERIVED (see `bounds.ts`), never stored — any
 * explicit `size()`/`unitsize()` in imported asy survives as a `raw` element.
 */
export interface Scene {
    elements: SceneElement[];
    meta?: SceneMeta;
}
