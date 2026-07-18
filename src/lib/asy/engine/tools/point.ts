import type { Pair, Scene } from "../../scene/types";
import { createDot } from "../../scene/factory";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/** Places a dot on click. */
export class PointTool implements Tool {
    readonly kind = "point" as const;

    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        const dot = createDot(p, ctx.pen);
        return { commit: addElement(scene, dot), selection: [dot.id] };
    }
    onPointerMove(): ToolResult {
        return NO_RESULT;
    }
    onPointerUp(): ToolResult {
        return NO_RESULT;
    }
    onCancel(): ToolResult {
        return NO_RESULT;
    }
}
