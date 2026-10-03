import type { Pair, SceneElement } from "$lib/asy/scene";
import { DEFAULT_FONT_SIZE_UNITS, REFERENCE_PX_PER_UNIT } from "$lib/asy/scene";
import {
    canvasSnapshot,
    dotRadius,
    gridLines,
    penStroke,
    projectPoint,
    projectedArc,
    projectedEllipseArc,
    projectedPath,
    renderWhiteboard,
    type ProjectedPathCommand,
    type WhiteboardRenderSnapshot,
    type WhiteboardViewport,
} from "./render";

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function number(value: number): string {
    return String(Math.round(value * 100) / 100);
}

function point(value: Pair): string {
    return `${number(value[0])},${number(value[1])}`;
}

function pathData(commands: ProjectedPathCommand[]): string {
    return commands.map((command) => {
        if (command.kind === "move") return `M ${point(command.point)}`;
        if (command.kind === "line") return `L ${point(command.point)}`;
        if (command.kind === "curve") {
            return `C ${point(command.c1)} ${point(command.c2)} ${point(command.point)}`;
        }
        return "Z";
    }).join(" ");
}

function dashAttribute(dash: number[]): string {
    return dash.length > 0 ? ` stroke-dasharray="${dash.join(" ")}"` : "";
}

function elementSvg(element: SceneElement, snapshot: WhiteboardRenderSnapshot): string {
    const { viewport, palette } = snapshot;
    const project = (value: Pair) => projectPoint(value, viewport);
    const style = penStroke(element.pen, palette, viewport.scale);
    const stroke = `stroke="${escapeXml(style.color)}" stroke-width="${number(style.width)}"` +
        `${dashAttribute(style.dash)} stroke-opacity="${number(style.opacity)}"`;
    const strokeAttributes = element.strokeEnabled === false ? 'stroke="none"' : stroke;
    const fillAttributes = "fillPen" in element && element.fillPen
        ? (() => {
              const fill = penStroke(element.fillPen, palette, viewport.scale);
              return `fill="${escapeXml(fill.color)}" fill-opacity="${number(fill.opacity)}"`;
          })()
        : 'fill="none"';

    if (element.kind === "path") {
        return `<path d="${pathData(projectedPath(element.path, project))}" ${fillAttributes} ${strokeAttributes} ` +
            'stroke-linejoin="round" stroke-linecap="round"/>';
    }
    if (element.kind === "fill") {
        const draw = element.drawPen ? penStroke(element.drawPen, palette, viewport.scale) : null;
        const drawAttributes = draw
            ? ` stroke="${escapeXml(draw.color)}" stroke-width="${number(draw.width)}"` +
                `${dashAttribute(draw.dash)} stroke-opacity="${number(draw.opacity)}"`
            : ' stroke="none"';
        return `<path d="${pathData(projectedPath(element.path, project))}" ` +
            `fill="${escapeXml(style.color)}" fill-opacity="${number(element.pen?.opacity ?? 0.85)}"` +
            `${drawAttributes}/>`;
    }
    if (element.kind === "circle") {
        const center = project(element.center);
        return `<circle cx="${number(center[0])}" cy="${number(center[1])}" ` +
            `r="${number(Math.abs(element.radius * viewport.scale))}" ${fillAttributes} ${strokeAttributes}/>`;
    }
    if (element.kind === "arc") {
        const commands: ProjectedPathCommand[] = projectedArc(
            element.center,
            element.radius,
            element.angle1,
            element.angle2,
            project,
        ).map((value, index) => index === 0
            ? { kind: "move" as const, point: value }
            : { kind: "line" as const, point: value });
        return `<path d="${pathData(commands)}" fill="none" ${strokeAttributes} stroke-linecap="round"/>`;
    }
    if (element.kind === "ellipse" || element.kind === "elliptical-arc") {
        const commands: ProjectedPathCommand[] = projectedEllipseArc(
            element.center,
            element.axisX,
            element.axisY,
            element.kind === "ellipse" ? 0 : element.angle1,
            element.kind === "ellipse" ? 360 : element.angle2,
            project,
        ).map((value, index) => index === 0
            ? { kind: "move" as const, point: value }
            : { kind: "line" as const, point: value });
        return `<path d="${pathData(commands)}" ${element.kind === "ellipse" ? fillAttributes : 'fill="none"'} ${strokeAttributes} stroke-linecap="round"/>`;
    }
    if (element.kind === "dot") {
        const at = project(element.at);
        return `<circle cx="${number(at[0])}" cy="${number(at[1])}" r="${number(dotRadius(style))}" ` +
            `fill="${escapeXml(style.color)}" opacity="${number(style.opacity)}"/>`;
    }
    if (element.kind === "label") {
        const at = project(element.at);
        const fontPx = (element.pen?.fontSize ?? DEFAULT_FONT_SIZE_UNITS) * viewport.scale;
        return `<text x="${number(at[0])}" y="${number(at[1])}" ` +
            `fill="${escapeXml(style.color)}" opacity="${number(style.opacity)}" ` +
            `font-family="sans-serif" font-size="${number(fontPx)}" ` +
            `text-anchor="middle" dominant-baseline="middle">` +
            `${escapeXml(element.text.replaceAll("$", ""))}</text>`;
    }
    return "";
}

function gridSvg(snapshot: WhiteboardRenderSnapshot): string {
    if (!snapshot.showGrid) return "";
    const { viewport, palette } = snapshot;
    const lines = gridLines(viewport);
    const vertical = lines.vertical.map((x) => {
        const screenX = projectPoint([x, 0], viewport)[0];
        return `<line x1="${number(screenX)}" x2="${number(screenX)}" y1="0" ` +
            `y2="${number(viewport.height)}" opacity="${Math.abs(x) < 1e-9 ? "0.5" : "0.12"}"/>`;
    });
    const horizontal = lines.horizontal.map((y) => {
        const screenY = projectPoint([0, y], viewport)[1];
        return `<line x1="0" x2="${number(viewport.width)}" y1="${number(screenY)}" ` +
            `y2="${number(screenY)}" opacity="${Math.abs(y) < 1e-9 ? "0.5" : "0.12"}"/>`;
    });
    return `<g stroke="${escapeXml(palette.border)}" stroke-width="1">${vertical.join("")}${horizontal.join("")}</g>`;
}

/** Serialize the committed scene as vector SVG at the reference zoom. */
export function toSvgString(surface: HTMLCanvasElement): string {
    const snapshot = normalizedSnapshot(surface);
    if (!snapshot) throw new Error("whiteboard canvas has not rendered");
    const { width, height } = snapshot.viewport;
    const elements = snapshot.scene.elements.map((element) => elementSvg(element, snapshot)).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" ` +
        `viewBox="0 0 ${number(width)} ${number(height)}">` +
        `<rect width="100%" height="100%" fill="${escapeXml(snapshot.palette.background)}"/>` +
        `${gridSvg(snapshot)}${elements}</svg>`;
}

/**
 * The committed scene re-projected at the reference zoom, keeping the current
 * view center. Exports then carry document dimensions — the same scene always
 * exports the same ink — instead of baking whatever zoom the canvas happens
 * to sit at.
 */
function normalizedSnapshot(surface: HTMLCanvasElement): WhiteboardRenderSnapshot | null {
    const snapshot = canvasSnapshot(surface);
    if (!snapshot) return null;
    const { viewport } = snapshot;
    if (viewport.scale === REFERENCE_PX_PER_UNIT) return snapshot;
    const centerX = (viewport.width / 2 - viewport.origin[0]) / viewport.scale;
    const centerY = (viewport.origin[1] - viewport.height / 2) / viewport.scale;
    const viewportAtReference: WhiteboardViewport = {
        width: viewport.width,
        height: viewport.height,
        scale: REFERENCE_PX_PER_UNIT,
        origin: [
            viewport.width / 2 - centerX * REFERENCE_PX_PER_UNIT,
            viewport.height / 2 + centerY * REFERENCE_PX_PER_UNIT,
        ],
    };
    return { ...snapshot, viewport: viewportAtReference };
}

/** Re-render the committed scene to an opaque PNG at `scale`x CSS resolution. */
export function toPngBlob(surface: HTMLCanvasElement, scale = 2): Promise<Blob> {
    const snapshot = normalizedSnapshot(surface);
    if (!snapshot) return Promise.reject(new Error("whiteboard canvas has not rendered"));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(snapshot.viewport.width * scale));
    canvas.height = Math.max(1, Math.round(snapshot.viewport.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("no 2d context"));
    renderWhiteboard(context, { ...snapshot, transparent: false }, undefined, scale);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/png");
    });
}

/** Trigger a browser download of `blob` under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
