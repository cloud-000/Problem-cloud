/**
 * Scene -> Asymptote source. The deterministic, easy direction of the codec.
 *
 * Built (and unit-tested) before the parser so Scenes can be round-tripped in
 * tests. Every element kind has one `emit*` case; pens compose as asy pen
 * expressions; `raw` elements pass through verbatim.
 */

import type {
    ArcElement,
    CircleElement,
    DotElement,
    EllipseElement,
    EllipticalArcElement,
    FillElement,
    LabelElement,
    Pair,
    Path,
    PathElement,
    Pen,
    Scene,
    SceneElement,
} from "../scene/types";
import { isDefaultPen, rgbToNamedColor } from "../scene/pen";

export interface SerializeOptions {
    /**
     * Precision (decimal places) for coordinate/number output. Trailing zeros
     * are trimmed. Default 6.
     */
    precision?: number;
}

/** Serialize a whole Scene to asy source (one statement per line). */
export function serialize(scene: Scene, options: SerializeOptions = {}): string {
    const ctx = { precision: options.precision ?? 6 };
    return scene.elements.map((el) => emitElement(el, ctx)).join("\n");
}

interface Ctx {
    precision: number;
}

function emitElement(el: SceneElement, ctx: Ctx): string {
    switch (el.kind) {
        case "dot":
            return emitDot(el, ctx);
        case "path":
            return emitPath(el, ctx);
        case "circle":
            return emitCircle(el, ctx);
        case "arc":
            return emitArc(el, ctx);
        case "ellipse":
            return emitEllipse(el, ctx);
        case "elliptical-arc":
            return emitEllipticalArc(el, ctx);
        case "label":
            return emitLabel(el, ctx);
        case "fill":
            return emitFill(el, ctx);
        case "raw":
            return el.source;
    }
}

// --- number / pair formatting -------------------------------------------------

function num(n: number, ctx: Ctx): string {
    if (!Number.isFinite(n)) return "0";
    if (Number.isInteger(n)) return String(n);
    // Fixed precision, then strip trailing zeros and a dangling dot.
    let s = n.toFixed(ctx.precision);
    s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return s;
}

function pair(p: Pair, ctx: Ctx): string {
    return `(${num(p[0], ctx)},${num(p[1], ctx)})`;
}

// --- pens ---------------------------------------------------------------------

/**
 * Emit an asy pen expression, e.g. `red+linewidth(1)+dashed`. Returns `null`
 * for a default pen so callers can omit the argument entirely.
 */
function emitPen(pen: Pen | undefined, ctx: Ctx): string | null {
    if (isDefaultPen(pen) || !pen) return null;
    const parts: string[] = [];

    if (pen.namedColor) {
        parts.push(pen.namedColor);
    } else if (pen.color) {
        const named = rgbToNamedColor(pen.color);
        parts.push(
            named ?? `rgb(${num(pen.color.r, ctx)},${num(pen.color.g, ctx)},${num(pen.color.b, ctx)})`
        );
    }

    if (pen.lineWidth !== undefined) parts.push(`linewidth(${num(pen.lineWidth, ctx)})`);

    if (pen.dash !== undefined && pen.dash !== "solid") {
        if (typeof pen.dash === "string") parts.push(pen.dash);
        else parts.push(pen.dash.pattern);
    }

    if (pen.opacity !== undefined) parts.push(`opacity(${num(pen.opacity, ctx)})`);
    if (pen.fontSize !== undefined) parts.push(`fontsize(${num(pen.fontSize, ctx)})`);

    return parts.length ? parts.join("+") : null;
}

/** Append `, <pen>` to a base argument list when the pen is non-default. */
function withPen(base: string, pen: Pen | undefined, ctx: Ctx): string {
    const p = emitPen(pen, ctx);
    return p ? `${base}, ${p}` : base;
}

// --- paths --------------------------------------------------------------------

function emitPathGuide(path: Path, ctx: Ctx): string {
    const { nodes, joins, cyclic } = path;
    if (nodes.length === 0) return "";
    let out = pair(nodes[0], ctx);
    for (let i = 1; i < nodes.length; i++) {
        const join = joins[i - 1] ?? "--";
        out += join + pair(nodes[i], ctx);
    }
    if (cyclic) {
        const closingJoin = joins[nodes.length - 1] ?? "--";
        out += closingJoin + "cycle";
    }
    return out;
}

// --- elements -----------------------------------------------------------------

function emitDot(el: DotElement, ctx: Ctx): string {
    return `dot(${withPen(pair(el.at, ctx), el.pen, ctx)});`;
}

function emitPath(el: PathElement, ctx: Ctx): string {
    if (el.fillPen !== undefined) return emitFillDraw(emitPathGuide(el.path, ctx), el.fillPen, el.pen, ctx, el.strokeEnabled !== false);
    return `draw(${withPen(emitPathGuide(el.path, ctx), el.pen, ctx)});`;
}

function emitCircle(el: CircleElement, ctx: Ctx): string {
    const guide = `circle(${pair(el.center, ctx)}, ${num(el.radius, ctx)})`;
    if (el.fillPen !== undefined) return emitFillDraw(guide, el.fillPen, el.pen, ctx, el.strokeEnabled !== false);
    return `draw(${withPen(guide, el.pen, ctx)});`;
}

function emitArc(el: ArcElement, ctx: Ctx): string {
    const guide = `arc(${pair(el.center, ctx)}, ${num(el.radius, ctx)}, ${num(el.angle1, ctx)}, ${num(el.angle2, ctx)})`;
    return `draw(${withPen(guide, el.pen, ctx)});`;
}

function affineGuide(center: Pair, axisX: Pair, axisY: Pair, primitive: string, ctx: Ctx): string {
    const matrix = [axisX[0], axisY[0], axisX[1], axisY[1]].map((value) => num(value, ctx));
    return `shift(${pair(center, ctx)})*transform(0,0,${matrix.join(",")})*${primitive}`;
}

function emitEllipse(el: EllipseElement, ctx: Ctx): string {
    const guide = affineGuide(el.center, el.axisX, el.axisY, "unitcircle", ctx);
    if (el.fillPen !== undefined) return emitFillDraw(guide, el.fillPen, el.pen, ctx, el.strokeEnabled !== false);
    return `draw(${withPen(guide, el.pen, ctx)});`;
}

function emitEllipticalArc(el: EllipticalArcElement, ctx: Ctx): string {
    const arc = `arc((0,0), 1, ${num(el.angle1, ctx)}, ${num(el.angle2, ctx)})`;
    const guide = affineGuide(el.center, el.axisX, el.axisY, arc, ctx);
    return `draw(${withPen(guide, el.pen, ctx)});`;
}

function emitLabel(el: LabelElement, ctx: Ctx): string {
    let args = `"${escapeAsyString(el.text)}", ${pair(el.at, ctx)}`;
    if (el.align) args += `, ${pair(el.align, ctx)}`;
    return `label(${withPen(args, el.pen, ctx)});`;
}

function emitFill(el: FillElement, ctx: Ctx): string {
    const guide = emitPathGuide(el.path, ctx);
    if (el.drawPen !== undefined) {
        // filldraw(path, fillpen, drawpen)
        const fill = emitPen(el.pen, ctx) ?? "currentpen";
        const draw = emitPen(el.drawPen, ctx) ?? "currentpen";
        return `filldraw(${guide}, ${fill}, ${draw});`;
    }
    return `fill(${withPen(guide, el.pen, ctx)});`;
}

function emitFillDraw(
    guide: string,
    fillPen: Pen,
    drawPen: Pen | undefined,
    ctx: Ctx,
    strokeEnabled: boolean,
): string {
    if (!strokeEnabled) return `fill(${withPen(guide, fillPen, ctx)});`;
    const fill = emitPen(fillPen, ctx) ?? "currentpen";
    const draw = emitPen(drawPen, ctx) ?? "currentpen";
    return `filldraw(${guide}, ${fill}, ${draw});`;
}

function escapeAsyString(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
