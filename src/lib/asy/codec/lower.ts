/**
 * Lower the statement AST to Scene elements.
 *
 * Maintains a symbol table for `pair`/`path` declarations so later references
 * resolve. Preserves the no-silent-loss guarantee: if a recognized statement
 * can't be fully represented as a typed element (e.g. an unresolved reference),
 * it falls back to a `raw` element carrying the exact original source.
 */

import type { SpannedStmt } from "./parser";
import type { PairExpr, PathExpr, PenExpr, RefExpr } from "./ast";
import type { Pair, Path, Pen, Scene, SceneElement } from "../scene/types";
import {
    createArc,
    createCircle,
    createDot,
    createEllipse,
    createEllipticalArc,
    createFill,
    createLabel,
    createPath,
    createRaw,
} from "../scene/factory";

export interface Diagnostic {
    message: string;
    start: number;
    end: number;
}

class LowerError extends Error {}

/** asy predefined compass directions used as label alignments. */
const COMPASS: Record<string, Pair> = {
    N: [0, 1],
    S: [0, -1],
    E: [1, 0],
    W: [-1, 0],
    NE: [1, 1],
    NW: [-1, 1],
    SE: [1, -1],
    SW: [-1, -1],
};

interface SymbolTable {
    pairs: Map<string, Pair>;
    paths: Map<string, Path>;
}

export function lower(
    stmts: SpannedStmt[],
    src: string
): { elements: SceneElement[]; diagnostics: Diagnostic[] } {
    const elements: SceneElement[] = [];
    const diagnostics: Diagnostic[] = [];
    const syms: SymbolTable = { pairs: new Map(), paths: new Map() };

    const raw = (stmt: SpannedStmt, reason: string) => {
        elements.push(createRaw(src.slice(stmt.start, stmt.end)));
        diagnostics.push({ message: reason, start: stmt.start, end: stmt.end });
    };

    for (const stmt of stmts) {
        try {
            switch (stmt.kind) {
                case "decl":
                    lowerDecl(stmt, syms);
                    break;
                case "draw":
                    elements.push(lowerDraw(stmt.path, lowerPen(stmt.pen), syms));
                    break;
                case "dot":
                    elements.push(createDot(resolvePoint(stmt.at, syms), lowerPen(stmt.pen)));
                    break;
                case "label":
                    elements.push(lowerLabel(stmt, syms));
                    break;
                case "fill":
                    elements.push(lowerFill(stmt, syms));
                    break;
                case "unknown":
                    raw(stmt, "unrecognized statement");
                    break;
            }
        } catch (err) {
            if (!(err instanceof LowerError)) throw err;
            raw(stmt, err.message);
        }
    }

    return { elements, diagnostics };
}

function lowerFill(
    stmt: Extract<SpannedStmt, { kind: "fill" }>,
    syms: SymbolTable,
): SceneElement {
    const fillPen = lowerPen(stmt.pen);
    const drawPen = stmt.filldraw ? (lowerPen(stmt.drawPen) ?? {}) : undefined;
    const strokeEnabled = stmt.filldraw;
    if (stmt.path.kind === "circle") {
        return {
            ...createCircle(resolvePoint(stmt.path.center, syms), stmt.path.radius, drawPen, fillPen ?? {}),
            strokeEnabled,
        };
    }
    if (stmt.path.kind === "affine-ellipse") {
        return {
            ...createEllipse(
                resolvePoint(stmt.path.center, syms),
                resolvePoint(stmt.path.axisX, syms),
                resolvePoint(stmt.path.axisY, syms),
                drawPen,
                fillPen ?? {},
            ),
            strokeEnabled,
        };
    }
    return createFill(
        resolvePath(stmt.path, syms),
        fillPen,
        stmt.filldraw ? (drawPen ?? {}) : undefined,
    );
}

function lowerDecl(
    stmt: Extract<SpannedStmt, { kind: "decl" }>,
    syms: SymbolTable
): void {
    if (stmt.declType === "pair" && stmt.pairValue) {
        syms.pairs.set(stmt.name, [stmt.pairValue.x, stmt.pairValue.y]);
    } else if (stmt.declType === "path" && stmt.pathValue) {
        syms.paths.set(stmt.name, resolvePath(stmt.pathValue, syms));
    }
}

function lowerDraw(path: PathExpr, pen: Pen | undefined, syms: SymbolTable): SceneElement {
    if (path.kind === "circle") {
        return createCircle(resolvePoint(path.center, syms), path.radius, pen);
    }
    if (path.kind === "arc") {
        return createArc(
            resolvePoint(path.center, syms),
            path.radius,
            path.angle1,
            path.angle2,
            pen
        );
    }
    if (path.kind === "affine-ellipse") {
        return createEllipse(
            resolvePoint(path.center, syms),
            resolvePoint(path.axisX, syms),
            resolvePoint(path.axisY, syms),
            pen,
        );
    }
    if (path.kind === "affine-arc") {
        return createEllipticalArc(
            resolvePoint(path.center, syms),
            resolvePoint(path.axisX, syms),
            resolvePoint(path.axisY, syms),
            path.angle1,
            path.angle2,
            pen,
        );
    }
    return createPath(resolvePath(path, syms), pen);
}

function lowerLabel(
    stmt: Extract<SpannedStmt, { kind: "label" }>,
    syms: SymbolTable
): SceneElement {
    if (!stmt.at) throw new LowerError("label without a position");
    const at = resolvePoint(stmt.at, syms);
    let align: Pair | undefined;
    if (stmt.align) align = resolveAlign(stmt.align, syms);
    return createLabel(stmt.text, at, align, lowerPen(stmt.pen));
}

// --- resolution ---------------------------------------------------------------

function resolvePoint(expr: PairExpr | RefExpr, syms: SymbolTable): Pair {
    if (expr.kind === "pair") return [expr.x, expr.y];
    const p = syms.pairs.get(expr.name);
    if (!p) throw new LowerError(`unresolved pair reference: ${expr.name}`);
    return p;
}

function resolveAlign(expr: PairExpr | RefExpr, syms: SymbolTable): Pair {
    if (expr.kind === "pair") return [expr.x, expr.y];
    const compass = COMPASS[expr.name];
    if (compass) return compass;
    const p = syms.pairs.get(expr.name);
    if (!p) throw new LowerError(`unresolved align: ${expr.name}`);
    return p;
}

function resolvePath(expr: PathExpr, syms: SymbolTable): Path {
    if (expr.kind === "ref") {
        const p = syms.paths.get(expr.name);
        if (!p) throw new LowerError(`unresolved path reference: ${expr.name}`);
        return clonePath(p);
    }
    if (
        expr.kind === "circle" ||
        expr.kind === "arc" ||
        expr.kind === "affine-ellipse" ||
        expr.kind === "affine-arc"
    ) {
        // fill/decl of a circle/arc isn't representable as a node Path.
        throw new LowerError(`cannot lower ${expr.kind} to a node path`);
    }
    // guide
    if (
        expr.nodes.length === 1 &&
        expr.joins.length === 0 &&
        !expr.cyclic &&
        expr.nodes[0].kind === "ref"
    ) {
        const stored = syms.paths.get((expr.nodes[0] as RefExpr).name);
        if (stored) return clonePath(stored);
    }
    const nodes = expr.nodes.map((node) => resolvePoint(node, syms));
    return { nodes, joins: [...expr.joins], cyclic: expr.cyclic };
}

function clonePath(p: Path): Path {
    return { nodes: p.nodes.map((n) => [n[0], n[1]] as Pair), joins: [...p.joins], cyclic: p.cyclic };
}

function lowerPen(expr: PenExpr | undefined): Pen | undefined {
    if (!expr) return undefined;
    const pen: Pen = {};
    if (expr.namedColor !== undefined) pen.namedColor = expr.namedColor;
    if (expr.rgb !== undefined) pen.color = expr.rgb;
    if (expr.lineWidth !== undefined) pen.lineWidth = expr.lineWidth;
    if (expr.dash !== undefined) pen.dash = expr.dash as Pen["dash"];
    if (expr.opacity !== undefined) pen.opacity = expr.opacity;
    if (expr.fontSize !== undefined) pen.fontSize = expr.fontSize;
    return Object.keys(pen).length ? pen : undefined;
}
