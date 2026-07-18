import type { Pair, Scene } from "../../scene/types";
import { createPath, makePath } from "../../scene/factory";
import { processStroke } from "../simplify";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/**
 * Freehand pen. Raw pointer samples pass through one shared cleanup pipeline,
 * so the live spline and committed spline have identical geometry.
 */
export class PenTool implements Tool {
    readonly kind = "pen" as const;
    private samples: Pair[] = [];
    private drawing = false;

    onPointerDown(scene: Scene, p: Pair): ToolResult {
        this.drawing = true;
        this.samples = [p];
        return { preview: scene };
    }

    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (!this.drawing) return NO_RESULT;
        this.samples.push(p);
        return { preview: addElement(scene, this.strokePath(ctx)) };
    }

    onPointerUp(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (!this.drawing) return NO_RESULT;
        this.drawing = false;
        this.samples.push(p);
        const nodes = processStroke(this.samples, ctx.simplifyEpsilon);
        this.samples = [];
        if (nodes.length < 2) return { preview: null };
        const path = createPath(makePath(nodes, { join: ".." }), ctx.pen);
        // Freehand is a continuous drawing tool: keep it active and leave the
        // finished stroke unselected so the next stroke can begin cleanly.
        return { commit: addElement(scene, path), selection: [], preview: null };
    }

    onCancel(): ToolResult {
        this.drawing = false;
        this.samples = [];
        return { preview: null };
    }

    private strokePath(ctx: ToolContext) {
        const nodes = processStroke(this.samples, ctx.simplifyEpsilon);
        return createPath(makePath(nodes, { join: ".." }), ctx.pen);
    }
}
