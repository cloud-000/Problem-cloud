import { normalizeDeg } from "$lib/asy/engine";
import {
    pathCommands,
    resolvePenColor,
    type Pair,
    type Path,
    type PathCommand,
    type Pen,
    type Scene,
    type SceneElement,
} from "$lib/asy/scene";

export type Project = (point: Pair) => Pair;

export interface WhiteboardPalette {
    background: string;
    foreground: string;
    inverseInk: string;
    border: string;
    primary: string;
    isDark: boolean;
}

export interface WhiteboardViewport {
    width: number;
    height: number;
    scale: number;
    origin: Pair;
}

export interface WhiteboardRenderSnapshot {
    scene: Scene;
    viewport: WhiteboardViewport;
    showGrid: boolean;
    transparent: boolean;
    palette: WhiteboardPalette;
}

export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function isScreenPointInRect(point: Pair, rect: ScreenRect | null): boolean {
    return rect !== null &&
        point[0] >= rect.x && point[0] <= rect.x + rect.width &&
        point[1] >= rect.y && point[1] <= rect.y + rect.height;
}

export interface RenderResizeHandle {
    screen: Pair;
}

export interface RenderVertexHandle {
    screen: Pair;
    state?: "default" | "hovered" | "selected";
}

export interface RenderRotationControl {
    stemStart: Pair;
    screen: Pair;
}

export interface RenderArcHandle extends RenderResizeHandle {
    control: "center" | "start" | "end";
    state?: "default" | "hovered" | "selected";
}

export interface RenderArcGuide {
    center: Pair;
    radius?: number;
    points?: Pair[];
    handles: RenderArcHandle[];
}

export function isArcGuideAt(
    point: Pair,
    guide: Pick<RenderArcGuide, "center" | "radius" | "points"> | null,
    tolerance = 8,
): boolean {
    if (!guide) return false;
    if (guide.points && guide.points.length > 1) {
        for (let index = 1; index < guide.points.length; index++) {
            const a = guide.points[index - 1];
            const b = guide.points[index];
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const lengthSquared = dx * dx + dy * dy;
            const t = lengthSquared <= 1e-12
                ? 0
                : Math.max(0, Math.min(1,
                      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
                  ));
            if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) <= tolerance) {
                return true;
            }
        }
        return false;
    }
    return guide.radius !== undefined && Math.abs(
        Math.hypot(point[0] - guide.center[0], point[1] - guide.center[1]) - guide.radius,
    ) <= tolerance;
}

export function resizeHandleAt<T extends RenderResizeHandle>(
    point: Pair,
    handles: readonly T[],
    radius = 10,
): T | undefined {
    return handles.find((handle) =>
        Math.abs(point[0] - handle.screen[0]) <= radius &&
        Math.abs(point[1] - handle.screen[1]) <= radius
    );
}

export function isRotationHandleAt(
    point: Pair,
    control: RenderRotationControl | null,
    radius = 10,
): boolean {
    return control !== null && Math.hypot(
        point[0] - control.screen[0],
        point[1] - control.screen[1],
    ) <= radius;
}

export interface WhiteboardRenderOverlay {
    selectedIds: ReadonlySet<string>;
    selectionIsPreview: boolean;
    previewElementRects: ScreenRect[];
    marqueeRect: ScreenRect | null;
    selectionRect: ScreenRect | null;
    rotationControl: RenderRotationControl | null;
    resizeHandles: RenderResizeHandle[];
    vertexHandles: RenderVertexHandle[];
    arcGuide: RenderArcGuide | null;
}

export type ProjectedPathCommand = PathCommand;

export interface StrokeStyle {
    color: string;
    width: number;
    dash: number[];
    opacity: number;
}

const DASH: Record<string, number[]> = {
    dashed: [6, 4],
    dotted: [1, 4],
    longdashed: [12, 6],
};

const canvasSnapshots = new WeakMap<HTMLCanvasElement, WhiteboardRenderSnapshot>();
const canvasPathCache = new Map<string, { signature: string; path: Path2D }>();
const MAX_CACHED_PATHS = 2048;

export function registerCanvasSnapshot(canvas: HTMLCanvasElement, snapshot: WhiteboardRenderSnapshot): void {
    canvasSnapshots.set(canvas, snapshot);
}

export function canvasSnapshot(canvas: HTMLCanvasElement): WhiteboardRenderSnapshot | undefined {
    return canvasSnapshots.get(canvas);
}

export function projectPoint(point: Pair, viewport: WhiteboardViewport): Pair {
    return [
        viewport.origin[0] + point[0] * viewport.scale,
        viewport.origin[1] - point[1] * viewport.scale,
    ];
}

export function projectedPath(path: Path, project: Project): ProjectedPathCommand[] {
    return pathCommands(path).map((command) => {
        if (command.kind === "close") return command;
        if (command.kind === "curve") {
            return {
                ...command,
                c1: project(command.c1),
                c2: project(command.c2),
                point: project(command.point),
            };
        }
        return { ...command, point: project(command.point) };
    });
}

export function projectedArc(
    center: Pair,
    radius: number,
    angle1: number,
    angle2: number,
    project: Project,
    steps = 48,
): Pair[] {
    const rawSweep = angle2 - angle1;
    const sweep = Math.abs(rawSweep) >= 360 ? 360 : normalizeDeg(rawSweep);
    const points: Pair[] = [];
    for (let index = 0; index <= steps; index++) {
        const degrees = angle1 + (sweep * index) / steps;
        const radians = (degrees * Math.PI) / 180;
        points.push(project([
            center[0] + radius * Math.cos(radians),
            center[1] + radius * Math.sin(radians),
        ]));
    }
    return points;
}

export function projectedEllipseArc(
    center: Pair,
    axisX: Pair,
    axisY: Pair,
    angle1: number,
    angle2: number,
    project: Project,
    steps = 96,
): Pair[] {
    const rawSweep = angle2 - angle1;
    const sweep = Math.abs(rawSweep) >= 360 ? 360 : normalizeDeg(rawSweep);
    const points: Pair[] = [];
    for (let index = 0; index <= steps; index++) {
        const radians = ((angle1 + (sweep * index) / steps) * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        points.push(project([
            center[0] + axisX[0] * cos + axisY[0] * sin,
            center[1] + axisX[1] * cos + axisY[1] * sin,
        ]));
    }
    return points;
}

export function penStroke(pen: Pen | undefined, palette: WhiteboardPalette): StrokeStyle {
    const rgb = resolvePenColor(pen);
    let color = palette.foreground;
    if (rgb) {
        const black = rgb.r <= 1e-4 && rgb.g <= 1e-4 && rgb.b <= 1e-4;
        const white = rgb.r >= 1 - 1e-4 && rgb.g >= 1 - 1e-4 && rgb.b >= 1 - 1e-4;
        if (black) color = palette.foreground;
        else if (white && palette.isDark) color = palette.inverseInk;
        else color = `rgb(${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)})`;
    }

    const dash = typeof pen?.dash === "string" && pen.dash !== "solid"
        ? (DASH[pen.dash] ?? [])
        : [];
    return {
        color,
        width: pen?.lineWidth ?? 1.5,
        dash,
        opacity: pen?.opacity ?? 1,
    };
}

/** Use the size-1 pen's 7 px dot as the baseline and scale linearly with pen width. */
export function dotRadius(style: StrokeStyle): number {
    return Math.max(0, style.width) * 3.5;
}

export function gridStep(scale: number): number {
    const target = 32 / scale;
    const power = Math.pow(10, Math.floor(Math.log10(target)));
    for (const multiplier of [1, 2, 5, 10]) {
        if (power * multiplier >= target) return power * multiplier;
    }
    return power * 10;
}

export function gridLines(viewport: WhiteboardViewport): { vertical: number[]; horizontal: number[] } {
    const { width, height, scale, origin } = viewport;
    if (width === 0 || height === 0) return { vertical: [], horizontal: [] };
    const step = gridStep(scale);
    const xMin = -origin[0] / scale;
    const xMax = (width - origin[0]) / scale;
    const yMin = (origin[1] - height) / scale;
    const yMax = origin[1] / scale;
    const vertical: number[] = [];
    const horizontal: number[] = [];
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) vertical.push(x);
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) horizontal.push(y);
    return { vertical, horizontal };
}

type PathTarget = Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "bezierCurveTo" | "closePath">;

function appendPath(target: PathTarget, commands: ProjectedPathCommand[]): void {
    for (const command of commands) {
        if (command.kind === "move") target.moveTo(command.point[0], command.point[1]);
        else if (command.kind === "line") target.lineTo(command.point[0], command.point[1]);
        else if (command.kind === "curve") {
            target.bezierCurveTo(
                command.c1[0], command.c1[1], command.c2[0], command.c2[1], command.point[0], command.point[1],
            );
        } else target.closePath();
    }
}

function tracePath(context: CanvasRenderingContext2D, commands: ProjectedPathCommand[]): void {
    context.beginPath();
    appendPath(context, commands);
}

function mixHash(hash: number, value: number): number {
    hash ^= Math.round(value * 1_000_000);
    return Math.imul(hash, 16_777_619);
}

function pathSignature(path: Path, viewport: WhiteboardViewport): string {
    let hash = 2_166_136_261;
    for (const [x, y] of path.nodes) {
        hash = mixHash(hash, x);
        hash = mixHash(hash, y);
    }
    for (const join of path.joins) hash = mixHash(hash, join === ".." ? 2 : 1);
    hash = mixHash(hash, path.cyclic ? 1 : 0);
    return [
        hash >>> 0,
        path.nodes.length,
        viewport.scale,
        viewport.origin[0],
        viewport.origin[1],
    ].join(":");
}

function cachedPath(
    id: string,
    path: Path,
    viewport: WhiteboardViewport,
    project: Project,
): Path2D | null {
    if (typeof Path2D === "undefined") return null;
    const signature = pathSignature(path, viewport);
    const cached = canvasPathCache.get(id);
    if (cached?.signature === signature) return cached.path;

    const canvasPath = new Path2D();
    appendPath(canvasPath, projectedPath(path, project));
    if (canvasPathCache.size >= MAX_CACHED_PATHS && !canvasPathCache.has(id)) {
        canvasPathCache.clear();
    }
    canvasPathCache.set(id, { signature, path: canvasPath });
    return canvasPath;
}

function applyStroke(context: CanvasRenderingContext2D, style: StrokeStyle): void {
    context.strokeStyle = style.color;
    context.lineWidth = style.width;
    context.globalAlpha = style.opacity;
    context.setLineDash(style.dash);
    context.lineJoin = "round";
    context.lineCap = "round";
}

function drawPolyline(context: CanvasRenderingContext2D, points: Pair[]): void {
    context.beginPath();
    points.forEach((point, index) => {
        if (index === 0) context.moveTo(point[0], point[1]);
        else context.lineTo(point[0], point[1]);
    });
}

export function drawSceneElement(
    context: CanvasRenderingContext2D,
    element: SceneElement,
    viewport: WhiteboardViewport,
    palette: WhiteboardPalette,
    selected = false,
): void {
    const project = (point: Pair) => projectPoint(point, viewport);
    const style = penStroke(element.pen, palette);
    context.save();

    if (element.kind === "path") {
        const path = cachedPath(element.id, element.path, viewport, project);
        if (!path) tracePath(context, projectedPath(element.path, project));
        if (element.fillPen && element.path.cyclic) {
            const fill = penStroke(element.fillPen, palette);
            context.fillStyle = fill.color;
            context.globalAlpha = fill.opacity;
            if (path) context.fill(path);
            else context.fill();
        }
        if (element.strokeEnabled !== false) {
            applyStroke(context, style);
            if (path) context.stroke(path);
            else context.stroke();
        }
        if (selected) {
            context.strokeStyle = palette.primary;
            context.lineWidth = style.width + 3;
            context.globalAlpha = 0.25;
            context.setLineDash([]);
            if (path) context.stroke(path);
            else context.stroke();
        }
    } else if (element.kind === "fill") {
        const path = cachedPath(element.id, element.path, viewport, project);
        if (!path) tracePath(context, projectedPath(element.path, project));
        context.fillStyle = style.color;
        context.globalAlpha = element.pen?.opacity ?? 0.85;
        if (path) context.fill(path);
        else context.fill();
        if (element.drawPen) {
            applyStroke(context, penStroke(element.drawPen, palette));
            if (path) context.stroke(path);
            else context.stroke();
        }
    } else if (element.kind === "circle") {
        const center = project(element.center);
        context.beginPath();
        context.arc(center[0], center[1], Math.abs(element.radius * viewport.scale), 0, Math.PI * 2);
        if (element.fillPen) {
            const fill = penStroke(element.fillPen, palette);
            context.fillStyle = fill.color;
            context.globalAlpha = fill.opacity;
            context.fill();
        }
        if (element.strokeEnabled !== false) {
            applyStroke(context, style);
            if (selected) context.strokeStyle = palette.primary;
            context.stroke();
        }
    } else if (element.kind === "arc") {
        drawPolyline(context, projectedArc(
            element.center, element.radius, element.angle1, element.angle2, project,
        ));
        applyStroke(context, style);
        if (selected) context.strokeStyle = palette.primary;
        context.stroke();
    } else if (element.kind === "ellipse" || element.kind === "elliptical-arc") {
        drawPolyline(context, projectedEllipseArc(
            element.center,
            element.axisX,
            element.axisY,
            element.kind === "ellipse" ? 0 : element.angle1,
            element.kind === "ellipse" ? 360 : element.angle2,
            project,
        ));
        if (element.kind === "ellipse" && element.fillPen) {
            const fill = penStroke(element.fillPen, palette);
            context.fillStyle = fill.color;
            context.globalAlpha = fill.opacity;
            context.fill();
        }
        if (element.strokeEnabled !== false) {
            applyStroke(context, style);
            if (selected) context.strokeStyle = palette.primary;
            context.stroke();
        }
    } else if (element.kind === "dot") {
        const point = project(element.at);
        context.beginPath();
        context.arc(point[0], point[1], selected ? Math.max(5, dotRadius(style)) : dotRadius(style), 0, Math.PI * 2);
        context.fillStyle = selected ? palette.primary : style.color;
        context.globalAlpha = style.opacity;
        context.fill();
    } else if (element.kind === "label") {
        const point = project(element.at);
        context.fillStyle = selected ? palette.primary : style.color;
        context.globalAlpha = style.opacity;
        context.font = `${element.pen?.fontSize ?? 14}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(element.text.replaceAll("$", ""), point[0], point[1]);
    }
    context.restore();
}

function strokeRect(context: CanvasRenderingContext2D, rect: ScreenRect): void {
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function drawGrid(context: CanvasRenderingContext2D, snapshot: WhiteboardRenderSnapshot): void {
    const { viewport, palette } = snapshot;
    const lines = gridLines(viewport);
    context.save();
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.setLineDash([]);
    for (const x of lines.vertical) {
        const projected = projectPoint([x, 0], viewport)[0];
        context.globalAlpha = Math.abs(x) < 1e-9 ? 0.5 : 0.12;
        context.beginPath();
        context.moveTo(projected, 0);
        context.lineTo(projected, viewport.height);
        context.stroke();
    }
    for (const y of lines.horizontal) {
        const projected = projectPoint([0, y], viewport)[1];
        context.globalAlpha = Math.abs(y) < 1e-9 ? 0.5 : 0.12;
        context.beginPath();
        context.moveTo(0, projected);
        context.lineTo(viewport.width, projected);
        context.stroke();
    }
    context.restore();
}

function drawOverlay(context: CanvasRenderingContext2D, overlay: WhiteboardRenderOverlay, palette: WhiteboardPalette): void {
    context.save();
    context.strokeStyle = palette.primary;
    context.fillStyle = palette.primary;
    context.lineWidth = 1;
    for (const rect of overlay.previewElementRects) {
        context.globalAlpha = 0.06;
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        context.globalAlpha = 1;
        context.setLineDash([3, 3]);
        strokeRect(context, rect);
    }
    if (overlay.marqueeRect) {
        context.globalAlpha = 0.08;
        context.fillRect(
            overlay.marqueeRect.x, overlay.marqueeRect.y,
            overlay.marqueeRect.width, overlay.marqueeRect.height,
        );
        context.globalAlpha = 1;
        context.setLineDash([5, 4]);
        strokeRect(context, overlay.marqueeRect);
    }
    if (overlay.selectionRect) {
        context.globalAlpha = 1;
        context.lineWidth = 1.5;
        context.setLineDash(overlay.selectionIsPreview ? [6, 4] : []);
        strokeRect(context, overlay.selectionRect);
    }
    if (overlay.arcGuide) {
        context.globalAlpha = 0.65;
        context.lineWidth = 1.25;
        context.setLineDash([5, 4]);
        context.beginPath();
        const guidePoints = overlay.arcGuide.points;
        if (guidePoints && guidePoints.length > 0) {
            context.moveTo(guidePoints[0][0], guidePoints[0][1]);
            for (const point of guidePoints.slice(1)) context.lineTo(point[0], point[1]);
        } else if (overlay.arcGuide.radius !== undefined) {
            context.arc(
                overlay.arcGuide.center[0],
                overlay.arcGuide.center[1],
                overlay.arcGuide.radius,
                0,
                Math.PI * 2,
            );
        }
        context.stroke();
        context.globalAlpha = 1;
        context.setLineDash([]);
    }
    if (overlay.rotationControl) {
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(overlay.rotationControl.stemStart[0], overlay.rotationControl.stemStart[1]);
        context.lineTo(overlay.rotationControl.screen[0], overlay.rotationControl.screen[1]);
        context.stroke();
        context.beginPath();
        context.arc(overlay.rotationControl.screen[0], overlay.rotationControl.screen[1], 4.5, 0, Math.PI * 2);
        context.fillStyle = palette.background;
        context.fill();
        context.strokeStyle = palette.primary;
        context.stroke();
    }
    for (const handle of overlay.resizeHandles) {
        context.fillStyle = palette.background;
        context.strokeStyle = palette.primary;
        context.beginPath();
        context.roundRect(handle.screen[0] - 4, handle.screen[1] - 4, 8, 8, 1);
        context.fill();
        context.stroke();
    }
    for (const handle of overlay.vertexHandles) {
        const state = handle.state ?? "default";
        const radius = state === "selected" ? 6 : state === "hovered" ? 5.5 : 5;
        context.globalAlpha = state === "hovered" ? 0.2 : 1;
        context.fillStyle = state === "default" ? palette.background : palette.primary;
        context.strokeStyle = palette.primary;
        context.beginPath();
        context.arc(handle.screen[0], handle.screen[1], radius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        context.stroke();
    }
    for (const handle of overlay.arcGuide?.handles ?? []) {
        const state = handle.state ?? "default";
        const radius = state === "selected" ? 6 : state === "hovered" ? 5.5 : 5;
        context.globalAlpha = state === "hovered" ? 0.2 : 1;
        context.fillStyle = handle.control === "center" || state !== "default"
            ? palette.primary
            : palette.background;
        context.strokeStyle = palette.primary;
        context.beginPath();
        context.arc(handle.screen[0], handle.screen[1], radius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        context.stroke();
    }
    context.restore();
}

export function renderWhiteboard(
    context: CanvasRenderingContext2D,
    snapshot: WhiteboardRenderSnapshot,
    overlay?: WhiteboardRenderOverlay,
    pixelRatio = 1,
): void {
    const { viewport } = snapshot;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    if (!snapshot.transparent) {
        context.fillStyle = snapshot.palette.background;
        context.globalAlpha = 1;
        context.fillRect(0, 0, viewport.width, viewport.height);
    }
    if (snapshot.showGrid) drawGrid(context, snapshot);
    for (const element of snapshot.scene.elements) {
        drawSceneElement(context, element, viewport, snapshot.palette, overlay?.selectedIds.has(element.id));
    }
    if (overlay) drawOverlay(context, overlay, snapshot.palette);
    context.setTransform(1, 0, 0, 1, 0, 0);
}
