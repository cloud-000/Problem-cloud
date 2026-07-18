import type { Pair, Scene } from "../../scene/types";
import { elementBounds } from "../../scene/bounds";
import { isStraightPathVertexEditable } from "../../scene/path-geometry";
import { hitTest } from "../hit-test";
import { distance, normalizeDeg, rotateElement, scaleElementBy, translateElement } from "../geometry";
import {
    mapElements,
    NO_RESULT,
    pointerPoint,
    type PointerInput,
    type SelectionTransformGesture,
    type Tool,
    type ToolContext,
    type ToolResult,
} from "./types";

type ShapeTransformGesture = Exclude<SelectionTransformGesture, { kind: "move" }>;

/**
 * Select + move + marquee + transform. Click an element to select it; drag
 * selected elements to move them. Drag empty space to rubber-band every
 * intersecting element. Handle metadata supplied by the view starts freeform or
 * aspect-locked resize, or rotation. Every completed gesture is committed once
 * on release.
 */
export class SelectTool implements Tool {
    readonly kind = "select" as const;
    private dragStart: Pair | null = null;
    private movingIds: string[] = [];
    private marqueeStart: Pair | null = null;
    private transform: ShapeTransformGesture | null = null;
    private transformPointerOffset: Pair = [0, 0];
    private base: Scene | null = null;
    private moved = false;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (ctx.lineContinuation) {
            const source = scene.elements.find(({ id }) => id === ctx.lineContinuation?.elementId);
            if (source?.kind !== "path") {
                return { lineContinuation: null, preview: null };
            }
            const first = source.path.nodes[0];
            const last = source.path.nodes.at(-1);
            const start = source.path.nodes[ctx.lineContinuation.nodeIndex];
            if (!start || !first || !last) {
                return { lineContinuation: null, preview: null };
            }
            if (distance(first, p) <= ctx.tolerance) {
                if (source.path.nodes.length > 2) {
                    return {
                        commit: this.closePath(scene, source.id),
                        selection: [source.id],
                        lineContinuation: null,
                        preview: null,
                        consoleMessage: "[Whiteboard] Closed path at its starting vertex.",
                    };
                }
                return { lineContinuation: null, preview: null };
            }
            if (distance(last, p) <= ctx.tolerance) {
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
        const selectionGesture = ctx.selectionTransform;
        if (selectionGesture?.kind === "move" && ctx.selection.length > 0) {
            this.reset();
            this.dragStart = p;
            this.movingIds = [...ctx.selection];
            this.base = scene;
            return {
                selection: this.movingIds,
                selectionPreview: null,
                preview: scene,
                marquee: null,
            };
        }
        if (selectionGesture && selectionGesture.kind !== "move" && ctx.selection.length > 0) {
            this.reset();
            this.dragStart = p;
            this.movingIds = [...ctx.selection];
            this.transform = selectionGesture;
            this.base = scene;
            if (
                selectionGesture.kind === "resize" ||
                selectionGesture.kind === "vertex" ||
                (selectionGesture.kind === "arc" && selectionGesture.control === "center")
            ) {
                this.transformPointerOffset = [
                    p[0] - selectionGesture.handle[0],
                    p[1] - selectionGesture.handle[1],
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

    onPointerMove(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (ctx.lineContinuation && !this.dragStart && !this.marqueeStart && !this.transform) {
            const source = scene.elements.find(({ id }) => id === ctx.lineContinuation?.elementId);
            if (source?.kind !== "path") {
                return { lineContinuation: null, preview: null };
            }
            const start = source.path.nodes[ctx.lineContinuation.nodeIndex];
            const first = source.path.nodes[0];
            const last = source.path.nodes.at(-1);
            if (!start || !first || !last) return { lineContinuation: null, preview: null };

            const target = distance(first, p) <= ctx.tolerance
                ? first
                : distance(last, p) <= ctx.tolerance
                  ? last
                  : p;
            if (distance(start, target) === 0) return { preview: scene };
            return { preview: this.appendPathNode(scene, source.id, target) };
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
                selectionPreview: this.intersectingIds(this.base, this.marqueeStart, p),
                marquee: { start: this.marqueeStart, end: p },
            };
        }
        return NO_RESULT;
    }

    onPointerUp(_scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
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
                selection: this.intersectingIds(base, start, p),
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

    private closePath(scene: Scene, elementId: string): Scene {
        return mapElements(scene, (element) =>
            element.id === elementId && element.kind === "path"
                ? {
                      ...element,
                      path: {
                          ...element.path,
                          cyclic: true,
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
        if (this.transform.kind === "arc") {
            const { elementId, control, handle, minimumRadius } = this.transform;
            const element = scene.elements.find(({ id }) => id === elementId);
            if (!selected.has(elementId) || element?.kind !== "arc") {
                return { scene, changed: false };
            }

            if (control === "center") {
                const nextCenter: Pair = [
                    pointer[0] - this.transformPointerOffset[0],
                    pointer[1] - this.transformPointerOffset[1],
                ];
                const changed = distance(nextCenter, handle) > 1e-9;
                return {
                    scene: changed
                        ? mapElements(scene, (candidate) =>
                              candidate.id === elementId && candidate.kind === "arc"
                                  ? { ...candidate, center: nextCenter }
                                  : candidate,
                          )
                        : scene,
                    changed,
                };
            }

            if (control === "radius") {
                const radius = Math.max(minimumRadius, distance(element.center, pointer));
                const changed = Math.abs(radius - element.radius) > 1e-9;
                return {
                    scene: changed
                        ? mapElements(scene, (candidate) =>
                              candidate.id === elementId && candidate.kind === "arc"
                                  ? { ...candidate, radius }
                                  : candidate,
                          )
                        : scene,
                    changed,
                };
            }

            const startPointerAngle = Math.atan2(
                this.dragStart[1] - element.center[1],
                this.dragStart[0] - element.center[0],
            );
            const pointerAngle = Math.atan2(
                pointer[1] - element.center[1],
                pointer[0] - element.center[0],
            );
            const delta = ((pointerAngle - startPointerAngle) * 180) / Math.PI;
            if (Math.abs(delta) <= 1e-9) return { scene, changed: false };

            const rawSweep = element.angle2 - element.angle1;
            const baseSweep = Math.abs(rawSweep) >= 360 ? 360 : normalizeDeg(rawSweep);
            const fixedStart = element.angle1;
            const fixedEnd = element.angle1 + baseSweep;
            const nextStart = control === "start" ? element.angle1 + delta : fixedStart;
            const nextEnd = control === "end" ? fixedEnd + delta : fixedEnd;
            const normalizedSweep = normalizeDeg(nextEnd - nextStart);
            const nextSweep = normalizedSweep <= 1e-9 ? 360 : normalizedSweep;

            return {
                scene: mapElements(scene, (candidate) =>
                    candidate.id === elementId && candidate.kind === "arc"
                        ? {
                              ...candidate,
                              angle1: nextStart,
                              angle2: nextStart + nextSweep,
                          }
                        : candidate,
                ),
                changed: true,
            };
        }
        if (this.transform.kind === "vertex") {
            const { elementId, nodeIndex, handle } = this.transform;
            const element = scene.elements.find(({ id }) => id === elementId);
            if (
                !selected.has(elementId) ||
                element?.kind !== "path" ||
                !isStraightPathVertexEditable(element.path) ||
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
            const { anchor, handle, axes, minimumScale } = this.transform;
            const startX = handle[0] - anchor[0];
            const startY = handle[1] - anchor[1];
            const adjustedX = pointer[0] - this.transformPointerOffset[0] - anchor[0];
            const adjustedY = pointer[1] - this.transformPointerOffset[1] - anchor[1];
            const activeX = axes.x && Math.abs(startX) > 1e-12;
            const activeY = axes.y && Math.abs(startY) > 1e-12;
            if (!activeX && !activeY) return { scene, changed: false };

            let scaleX = activeX ? adjustedX / startX : 1;
            let scaleY = activeY ? adjustedY / startY : 1;
            if (ctx.lockAspectRatio) {
                let factor: number;
                if (activeX && activeY) {
                    const lengthSquared = startX * startX + startY * startY;
                    factor = (adjustedX * startX + adjustedY * startY) / lengthSquared;
                } else {
                    factor = activeX ? scaleX : scaleY;
                }
                const uniformMinimum = Math.max(minimumScale[0], minimumScale[1]);
                factor = Math.max(uniformMinimum, factor);
                scaleX = factor;
                scaleY = factor;
            } else {
                if (activeX) scaleX = Math.max(minimumScale[0], scaleX);
                if (activeY) scaleY = Math.max(minimumScale[1], scaleY);
            }
            const factors: Pair = [scaleX, scaleY];
            return {
                scene: mapElements(scene, (element) =>
                    selected.has(element.id) ? scaleElementBy(element, anchor, factors) : element,
                ),
                changed: Math.abs(scaleX - 1) > 1e-9 || Math.abs(scaleY - 1) > 1e-9,
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

    private intersectingIds(scene: Scene, start: Pair, end: Pair): string[] {
        const minX = Math.min(start[0], end[0]);
        const maxX = Math.max(start[0], end[0]);
        const minY = Math.min(start[1], end[1]);
        const maxY = Math.max(start[1], end[1]);
        return scene.elements.flatMap((element) => {
            const bounds = elementBounds(element);
            return bounds &&
                bounds.max[0] >= minX && bounds.min[0] <= maxX &&
                bounds.max[1] >= minY && bounds.min[1] <= maxY
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
