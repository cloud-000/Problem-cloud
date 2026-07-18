import type { Pair, Scene } from "../../scene/types";
import { createPath, makePath } from "../../scene/factory";
import { distance } from "../geometry";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/** Straight segment via press-drag-release. */
export class LineTool implements Tool {
    readonly kind = "line" as const;
    private start: Pair | null = null;

    onPointerDown(scene: Scene, p: Pair): ToolResult {
        this.start = p;
        return { preview: scene };
    }

    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (!this.start) return NO_RESULT;
        return { preview: addElement(scene, createPath(makePath([this.start, p]), ctx.pen)) };
    }

    onPointerUp(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (!this.start) return NO_RESULT;
        const start = this.start;
        this.start = null;
        if (distance(start, p) < ctx.tolerance) return { preview: null };
        const path = createPath(makePath([start, p]), ctx.pen);
        return { commit: addElement(scene, path), selection: [path.id], preview: null };
    }

    onCancel(): ToolResult {
        this.start = null;
        return { preview: null };
    }
}
