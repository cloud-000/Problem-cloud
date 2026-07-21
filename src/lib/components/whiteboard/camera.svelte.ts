import type { Bounds, Pair } from "$lib/asy/scene";
import { projectPoint, type WhiteboardViewport } from "./render";

/** Pixels per scene unit at 100% zoom. */
const BASE_SCALE = 40;
const MAX_SCALE = 400;

/**
 * The host's bindable viewport props. The camera owns the viewport *math* but
 * not the storage of `scale`/`panX`/`panY` — those stay `$bindable()` props on
 * `whiteboard.svelte`, reached through these accessors.
 */
export interface CameraHost {
    get scale(): number;
    set scale(value: number);
    get panX(): number;
    set panX(value: number);
    get panY(): number;
    set panY(value: number);
    /** Minimum viewport zoom percentage. */
    get minimumZoom(): number;
    /** The canvas, for client → local coordinate mapping. */
    get surface(): HTMLCanvasElement | null;
}

/**
 * The whiteboard viewport: the single owner of screen ↔ asy-space conversion
 * for the view layer. Everything below the view is asy-space (INVARIANTS §1).
 */
export class Camera {
    #host: CameraHost;
    #pinchStart: { distance: number; scale: number; world: Pair } | null = null;

    width = $state(0);
    height = $state(0);
    pixelRatio = $state(1);

    constructor(host: CameraHost) {
        this.#host = host;
    }

    get scale(): number {
        return this.#host.scale;
    }

    set scale(value: number) {
        this.#host.scale = value;
    }

    get panX(): number {
        return this.#host.panX;
    }

    set panX(value: number) {
        this.#host.panX = value;
    }

    get panY(): number {
        return this.#host.panY;
    }

    set panY(value: number) {
        this.#host.panY = value;
    }

    get origin(): Pair {
        return [this.width / 2 + this.panX, this.height / 2 + this.panY];
    }

    get minimumScale(): number {
        return Math.max(8, Math.min(MAX_SCALE, (this.#host.minimumZoom / 100) * BASE_SCALE));
    }

    get zoomPercentage(): number {
        return Math.round((this.scale / BASE_SCALE) * 100);
    }

    get viewport(): WhiteboardViewport {
        const [x, y] = this.origin;
        return { width: this.width, height: this.height, scale: this.scale, origin: [x, y] };
    }

    /** asy-space point → screen point. */
    project(point: Pair): Pair {
        return projectPoint(point, this.viewport);
    }

    /** Client (event) coordinates → canvas-local pixels. */
    localPoint(clientX: number, clientY: number): Pair {
        const rect = this.#host.surface?.getBoundingClientRect();
        return rect ? [clientX - rect.left, clientY - rect.top] : [0, 0];
    }

    /** Client (event) coordinates → asy-space point. */
    toAsy(clientX: number, clientY: number): Pair {
        const [px, py] = this.localPoint(clientX, clientY);
        const origin = this.origin;
        return [(px - origin[0]) / this.scale, (origin[1] - py) / this.scale];
    }

    /** A screen distance in pixels → the same distance in scene units. */
    toAsyLength(pixels: number): number {
        return pixels / this.scale;
    }

    /** A scene-unit distance → the same distance in screen pixels. */
    toScreenLength(units: number): number {
        return units * this.scale;
    }

    #clampScale(value: number): number {
        return Math.max(this.minimumScale, Math.min(MAX_SCALE, value));
    }

    /** Zoom by `factor`, keeping the point under the cursor fixed. */
    zoomAt(clientX: number, clientY: number, factor: number) {
        const world = this.toAsy(clientX, clientY);
        const [px, py] = this.localPoint(clientX, clientY);
        this.scale = this.#clampScale(this.scale * factor);
        this.panX = px - this.width / 2 - world[0] * this.scale;
        this.panY = py - this.height / 2 + world[1] * this.scale;
    }

    /** Zoom by `factor` about the canvas centre. */
    zoomBy(factor: number) {
        const rect = this.#host.surface?.getBoundingClientRect();
        if (rect) this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }

    zoomTo(percentage: number) {
        this.zoomBy(this.#clampScale((percentage / 100) * BASE_SCALE) / this.scale);
    }

    fitScene(bounds: Bounds | null) {
        if (!bounds || this.width <= 0 || this.height <= 0) return;

        const sceneWidth = bounds.max[0] - bounds.min[0];
        const sceneHeight = bounds.max[1] - bounds.min[1];
        const availableWidth = Math.max(1, this.width - 64);
        const availableHeight = Math.max(1, this.height - 64);
        const widthScale = sceneWidth > 1e-9 ? availableWidth / sceneWidth : Infinity;
        const heightScale = sceneHeight > 1e-9 ? availableHeight / sceneHeight : Infinity;
        const fittedScale = Math.min(widthScale, heightScale);

        this.scale = Number.isFinite(fittedScale) ? this.#clampScale(fittedScale) : BASE_SCALE;
        const centerX = (bounds.min[0] + bounds.max[0]) / 2;
        const centerY = (bounds.min[1] + bounds.max[1]) / 2;
        this.panX = -centerX * this.scale;
        this.panY = centerY * this.scale;
    }

    resetViewport() {
        this.scale = BASE_SCALE;
        this.panX = 0;
        this.panY = 0;
    }

    syncPixelRatio() {
        this.pixelRatio = window.devicePixelRatio || 1;
    }

    /**
     * Trackpad scroll pans. Pinch gestures arrive as ctrl-wheel; discrete
     * mouse-wheel events zoom. Every zoom stays anchored under the cursor.
     */
    wheel(e: WheelEvent) {
        const discreteWheel = e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
            (Math.abs(e.deltaY) >= 80 && Math.abs(e.deltaX) < 1);
        if (e.ctrlKey || e.metaKey || discreteWheel) {
            this.zoomAt(
                e.clientX,
                e.clientY,
                Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * 0.002),
            );
        } else {
            this.panX -= e.deltaX;
            this.panY -= e.deltaY;
        }
    }

    beginPinch(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
        this.#pinchStart = {
            distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
            scale: this.scale,
            world: this.toAsy((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
        };
    }

    updatePinch(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
        const start = this.#pinchStart;
        if (!start) return;
        const [midX, midY] = this.localPoint(
            (a.clientX + b.clientX) / 2,
            (a.clientY + b.clientY) / 2,
        );
        const distance = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
        this.scale = this.#clampScale(start.scale * (distance / start.distance));
        this.panX = midX - this.width / 2 - start.world[0] * this.scale;
        this.panY = midY - this.height / 2 + start.world[1] * this.scale;
    }

    endPinch() {
        this.#pinchStart = null;
    }
}
