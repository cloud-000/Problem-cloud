import type { Pair, Scene } from "../../scene/types";
import { makePath, newId } from "../../scene/factory";
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
        const nodes = processStroke(this.samples, ctx.strokeProcessing);
        this.samples = [];
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
