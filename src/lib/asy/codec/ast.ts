/**
 * Intermediate Asymptote statement AST. This is NOT the Scene — it mirrors the
 * asy *syntax* the parser recognizes. `lower.ts` walks these nodes and produces
 * Scene elements; anything unrecognized is captured as `UnknownStmt` (byte span)
 * and lowered to a `raw` element.
 */

// --- expressions --------------------------------------------------------------

/** A literal pair `(x, y)`. */
export interface PairExpr {
    kind: "pair";
    x: number;
    y: number;
}

/** A reference to a previously declared `pair`/`path` variable. */
export interface RefExpr {
    kind: "ref";
    name: string;
}

/** `circle(center, radius)`. */
export interface CircleExpr {
    kind: "circle";
    center: PairExpr | RefExpr;
    radius: number;
}

/** `arc(center, radius, angle1, angle2)`. */
export interface ArcExpr {
    kind: "arc";
    center: PairExpr | RefExpr;
    radius: number;
    angle1: number;
    angle2: number;
}

/** A guide/path built from nodes joined by `--`/`..`, optionally cyclic. */
export interface GuideExpr {
    kind: "guide";
    nodes: (PairExpr | RefExpr)[];
    joins: ("--" | "..")[];
    cyclic: boolean;
}

/** Any path-valued expression. */
export type PathExpr = GuideExpr | CircleExpr | ArcExpr | RefExpr;

// --- pens ---------------------------------------------------------------------

export interface PenExpr {
    /** Named color, e.g. `red`. */
    namedColor?: string;
    /** rgb(r,g,b). */
    rgb?: { r: number; g: number; b: number };
    lineWidth?: number;
    dash?: string; // "dashed" | "dotted" | "longdashed"
    opacity?: number;
    fontSize?: number;
}

// --- statements ---------------------------------------------------------------

export interface DrawStmt {
    kind: "draw";
    path: PathExpr;
    pen?: PenExpr;
}

export interface DotStmt {
    kind: "dot";
    at: PairExpr | RefExpr;
    pen?: PenExpr;
}

export interface LabelStmt {
    kind: "label";
    text: string;
    at?: PairExpr | RefExpr;
    align?: PairExpr | RefExpr;
    pen?: PenExpr;
}

export interface FillStmt {
    kind: "fill";
    path: PathExpr;
    pen?: PenExpr;
    /** Present for `filldraw`: the stroke pen. */
    drawPen?: PenExpr;
    filldraw: boolean;
}

/** `pair X = (..);` or `path X = ..;` — populates the symbol table. */
export interface DeclStmt {
    kind: "decl";
    declType: "pair" | "path";
    name: string;
    pairValue?: PairExpr;
    pathValue?: PathExpr;
}

/** Anything the parser didn't recognize — captured as an exact source span. */
export interface UnknownStmt {
    kind: "unknown";
    start: number;
    end: number;
}

export type AsyStmt = DrawStmt | DotStmt | LabelStmt | FillStmt | DeclStmt | UnknownStmt;
