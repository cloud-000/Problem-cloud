import type { Pair, Scene } from "../../scene/types";
import { elementBounds } from "../../scene/bounds";
import { hitTest } from "../hit-test";
import { distance, rotateElement, scaleElement, translateElement } from "../geometry";
import {
    mapElements,
    NO_RESULT,
    type SelectionTransformGesture,
    type Tool,
    type ToolContext,
    type ToolResult,
} from "./types";

/**
 * Select + move + marquee + transform. Click an element to select it; drag
 * selected elements to move them. Drag empty space to rubber-band every fully
 * enclosed element. Handle metadata supplied by the view starts proportional
 * resize or rotation. Every completed gesture is committed once on release.
 */
export class SelectTool implements Tool {
    readonly kind = "select" as const;
    private dragStart: Pair | null = null;
    private movingIds: string[] = [];
    private marqueeStart: Pair | null = null;
    private transform: SelectionTransformGesture | null = null;
    private transformPointerOffset: Pair = [0, 0];
    private base: Scene | null = null;
    private moved = false;

    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (ctx.lineContinuation) {
            const source = scene.elements.find(({ id }) => id === ctx.lineContinuation?.elementId);
            if (source?.kind !== "path") {
                return { lineContinuation: null, preview: null };
            }
            const endpoints = [source.path.nodes[0], source.path.nodes.at(-1)].filter(
                (point): point is Pair => point !== undefined,
            );
            const start = source.path.nodes[ctx.lineContinuation.nodeIndex];
            if (!start || endpoints.some((endpoint) => distance(endpoint, p) <= ctx.tolerance)) {
                return { lineContinuation: null, preview: null };
            }
            const nodeIndex = source.path.nodes.length;
            return {
                commit: this.appendPathNode(scene, source.id, p),
                selection: [source.id],
                lineContinuation: { elementId: source.id, nodeIndex },
                preview: null,
            };
        }
        if (ctx.selectionTransform && ctx.selection.length > 0) {
            this.reset();
            this.dragStart = p;
            this.movingIds = [...ctx.selection];
            this.transform = ctx.selectionTransform;
            this.base = scene;
            if (
                ctx.selectionTransform.kind === "resize" ||
                ctx.selectionTransform.kind === "vertex"
            ) {
                this.transformPointerOffset = [
                    p[0] - ctx.selectionTransform.handle[0],
                    p[1] - ctx.selectionTransform.handle[1],
                ];
            }
            return {
                selection: this.movingIds,
                selectionPreview: null,
                preview: scene,
                marquee: null,
            };
        }
        const hit = hitTest(scene, p, ctx.tolerance);
        if (!hit || hit.kind === "raw") {
            this.reset();
            this.marqueeStart = p;
            this.base = scene;
            return { selection: [], selectionPreview: [], marquee: { start: p, end: p } };
        }
        this.dragStart = p;
        this.movingIds = ctx.selection.includes(hit.id) ? [...ctx.selection] : [hit.id];
        this.base = scene;
        this.moved = false;
        return { selection: this.movingIds, selectionPreview: null, preview: scene, marquee: null };
    }

    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (ctx.lineContinuation && !this.dragStart && !this.marqueeStart && !this.transform) {
            const source = scene.elements.find(({ id }) => id === ctx.lineContinuation?.elementId);
            if (source?.kind !== "path") {
                return { lineContinuation: null, preview: null };
            }
            const start = source.path.nodes[ctx.lineContinuation.nodeIndex];
            if (!start) return { lineContinuation: null, preview: null };
            return { preview: this.appendPathNode(scene, source.id, p) };
        }
        if (this.transform && this.dragStart && this.base) {
            const transformed = this.transformScene(this.base, this.movingIds, p, ctx);
            this.moved = transformed.changed;
            return { preview: transformed.scene };
        }
        if (this.movingIds.length && this.dragStart && this.base) {
            const dx = p[0] - this.dragStart[0];
            const dy = p[1] - this.dragStart[1];
            if (dx !== 0 || dy !== 0) this.moved = true;
            return { preview: this.translate(this.base, this.movingIds, dx, dy) };
        }
        if (this.marqueeStart && this.base) {
            this.moved = this.moved || p[0] !== this.marqueeStart[0] || p[1] !== this.marqueeStart[1];
            return {
                selectionPreview: this.enclosedIds(this.base, this.marqueeStart, p),
                marquee: { start: this.marqueeStart, end: p },
            };
        }
        return NO_RESULT;
    }

    onPointerUp(_scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (this.transform && this.dragStart && this.base) {
            const transformed = this.transformScene(this.base, this.movingIds, p, ctx);
            this.reset();
            if (!transformed.changed) return { preview: null };
            return { commit: transformed.scene, preview: null };
        }
        if (this.movingIds.length && this.dragStart && this.base) {
            const dx = p[0] - this.dragStart[0];
            const dy = p[1] - this.dragStart[1];
            const base = this.base;
            const ids = this.movingIds;
            const moved = this.moved;
            this.reset();
            if (!moved) return { preview: null };
            return { commit: this.translate(base, ids, dx, dy), preview: null };
        }
        if (this.marqueeStart && this.base) {
            const start = this.marqueeStart;
            const base = this.base;
            const moved = this.moved;
            this.reset();
            if (!moved) return { selection: [], selectionPreview: null, marquee: null };
            return {
                selection: this.enclosedIds(base, start, p),
                selectionPreview: null,
                marquee: null,
            };
        }
        return NO_RESULT;
    }

    onCancel(): ToolResult {
        this.reset();
        return {
            preview: null,
            selectionPreview: null,
            marquee: null,
            lineContinuation: null,
        };
    }

    private translate(scene: Scene, ids: string[], dx: number, dy: number): Scene {
        const selected = new Set(ids);
        return mapElements(scene, (el) => selected.has(el.id) ? translateElement(el, dx, dy) : el);
    }

    private appendPathNode(scene: Scene, elementId: string, node: Pair): Scene {
        return mapElements(scene, (element) =>
            element.id === elementId && element.kind === "path"
                ? {
                      ...element,
                      path: {
                          ...element.path,
                          nodes: [...element.path.nodes, node],
                          joins: [...element.path.joins, "--"],
                      },
                  }
                : element,
        );
    }

    private transformScene(
        scene: Scene,
        ids: string[],
        pointer: Pair,
        ctx: ToolContext,
    ): { scene: Scene; changed: boolean } {
        if (!this.transform || !this.dragStart) return { scene, changed: false };
        const selected = new Set(ids);
        if (this.transform.kind === "vertex") {
            const { elementId, nodeIndex, handle } = this.transform;
            const element = scene.elements.find(({ id }) => id === elementId);
            if (
                !selected.has(elementId) ||
                element?.kind !== "path" ||
                nodeIndex < 0 ||
                nodeIndex >= element.path.nodes.length
            ) return { scene, changed: false };
            const next: Pair = [
                pointer[0] - this.transformPointerOffset[0],
                pointer[1] - this.transformPointerOffset[1],
            ];
            const changed = Math.hypot(next[0] - handle[0], next[1] - handle[1]) > 1e-9;
            if (!changed) return { scene, changed: false };
            return {
                scene: mapElements(scene, (element) => {
                    if (element.id !== elementId || element.kind !== "path") return element;
                    const nodes = element.path.nodes.map((node, index) =>
                        index === nodeIndex ? next : node,
                    );
                    return { ...element, path: { ...element.path, nodes } };
                }),
                changed: true,
            };
        }
        if (this.transform.kind === "resize") {
            const { anchor, handle, minimumScale } = this.transform;
            const startX = handle[0] - anchor[0];
            const startY = handle[1] - anchor[1];
            const lengthSquared = startX * startX + startY * startY;
            if (lengthSquared === 0) return { scene, changed: false };
            const adjustedX = pointer[0] - this.transformPointerOffset[0] - anchor[0];
            const adjustedY = pointer[1] - this.transformPointerOffset[1] - anchor[1];
            const projected = (adjustedX * startX + adjustedY * startY) / lengthSquared;
            const factor = Math.max(minimumScale, projected);
            return {
                scene: mapElements(scene, (element) =>
                    selected.has(element.id) ? scaleElement(element, anchor, factor) : element,
                ),
                changed: Math.abs(factor - 1) > 1e-9,
            };
        }

        const pivot = this.transform.pivot;
        const startAngle = Math.atan2(
            this.dragStart[1] - pivot[1],
            this.dragStart[0] - pivot[0],
        );
        const pointerAngle = Math.atan2(
            pointer[1] - pivot[1],
            pointer[0] - pivot[0],
        );
        let degrees = ((pointerAngle - startAngle) * 180) / Math.PI;
        if (ctx.snapRotation) degrees = Math.round(degrees / 15) * 15;
        return {
            scene: mapElements(scene, (element) =>
                selected.has(element.id)
                    ? rotateElement(element, pivot, degrees)
                    : element,
            ),
            changed: Math.abs(degrees) > 1e-9,
        };
    }

    private enclosedIds(scene: Scene, start: Pair, end: Pair): string[] {
        const minX = Math.min(start[0], end[0]);
        const maxX = Math.max(start[0], end[0]);
        const minY = Math.min(start[1], end[1]);
        const maxY = Math.max(start[1], end[1]);
        return scene.elements.flatMap((element) => {
            const bounds = elementBounds(element);
            return bounds &&
                bounds.min[0] >= minX && bounds.max[0] <= maxX &&
                bounds.min[1] >= minY && bounds.max[1] <= maxY
                ? [element.id]
                : [];
        });
    }

    private reset(): void {
        this.dragStart = null;
        this.movingIds = [];
        this.marqueeStart = null;
        this.transform = null;
        this.transformPointerOffset = [0, 0];
        this.base = null;
        this.moved = false;
    }
}
