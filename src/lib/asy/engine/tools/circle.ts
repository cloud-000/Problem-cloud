import type { Pair, Scene } from "../../scene/types";
import { createCircle } from "../../scene/factory";
import { distance } from "../geometry";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/** Circle by dragging from center to a point on the rim. */
export class CircleTool implements Tool {
    readonly kind = "circle" as const;
    private center: Pair | null = null;

    onPointerDown(scene: Scene, p: Pair): ToolResult {
        this.center = p;
        return { preview: scene };
    }

    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (!this.center) return NO_RESULT;
        const r = distance(this.center, p);
        return { preview: addElement(scene, createCircle(this.center, r, ctx.pen)) };
    }

    onPointerUp(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (!this.center) return NO_RESULT;
        const center = this.center;
        this.center = null;
        const r = distance(center, p);
        if (r < ctx.tolerance) return { preview: null };
        const circle = createCircle(center, r, ctx.pen);
        return { commit: addElement(scene, circle), selection: [circle.id], preview: null };
    }

    onCancel(): ToolResult {
        this.center = null;
        return { preview: null };
    }
}
