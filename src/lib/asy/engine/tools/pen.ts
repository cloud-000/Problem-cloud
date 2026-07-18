import type { Pair, Scene } from "../../scene/types";
import { createDot, makePath, newId } from "../../scene/factory";
import { classifyStrokeJoins, processStroke } from "../simplify";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/**
 * Freehand pen. Raw pointer samples pass through one shared cleanup pipeline,
 * so the live spline and committed spline have identical geometry.
 */
export class PenTool implements Tool {
    readonly kind = "pen" as const;
    private samples: Pair[] = [];
    private drawing = false;
    private draftId: string | null = null;

    onPointerDown(scene: Scene, p: Pair): ToolResult {
        this.drawing = true;
        this.samples = [p];
        this.draftId = newId();
        return { preview: scene };
    }

    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        return this.onPointerMoves(scene, [p], ctx);
    }

    onPointerMoves(scene: Scene, points: readonly Pair[], ctx: ToolContext): ToolResult {
        if (!this.drawing) return NO_RESULT;
        this.samples.push(...points);
        return { preview: addElement(scene, this.strokePath(ctx)) };
    }

    onPointerUp(
        scene: Scene,
        p: Pair,
        ctx: ToolContext,
        pendingMoves: readonly Pair[] = [],
    ): ToolResult {
        if (!this.drawing) return NO_RESULT;
        this.drawing = false;
        this.samples.push(...pendingMoves);
        this.samples.push(p);
        const isTap = this.gestureTravel() <= Math.max(0, ctx.penTapTolerance);
        const tapAt = this.samples[0];
        const nodes = processStroke(this.samples, ctx.strokeProcessing);
        this.samples = [];
        if (isTap) {
            const dot = createDot(tapAt, ctx.pen);
            this.draftId = null;
            return { commit: addElement(scene, dot), selection: [], preview: null };
        }
        if (nodes.length < 2) {
            this.draftId = null;
            return { preview: null };
        }
        const path = this.strokePathFromNodes(nodes, ctx);
        this.draftId = null;
        // Freehand is a continuous drawing tool: keep it active and leave the
        // finished stroke unselected so the next stroke can begin cleanly.
        return { commit: addElement(scene, path), selection: [], preview: null };
    }

    onCancel(): ToolResult {
        this.drawing = false;
        this.samples = [];
        this.draftId = null;
        return { preview: null };
    }

    private strokePath(ctx: ToolContext) {
        const nodes = processStroke(this.samples, ctx.strokeProcessing);
        return this.strokePathFromNodes(nodes, ctx);
    }

    /** Largest displacement from pointer-down; tiny coalesced jitter remains a tap. */
    private gestureTravel(): number {
        const start = this.samples[0];
        if (!start) return 0;
        return this.samples.reduce(
            (maximum, point) => Math.max(maximum, Math.hypot(point[0] - start[0], point[1] - start[1])),
            0,
        );
    }

    private strokePathFromNodes(nodes: Pair[], ctx: ToolContext) {
        return {
            id: this.draftId ?? newId(),
            kind: "path" as const,
            path: makePath(nodes, {
                joins: classifyStrokeJoins(
                    nodes,
                    ctx.strokeProcessing.cornerThresholdDegrees,
                ),
            }),
            pen: ctx.pen,
        };
    }
}
