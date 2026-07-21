import type { Pair, Scene } from "../../scene/types";
import { createDot } from "../../scene/factory";
import { NO_RESULT, pointerPoint, type PointerInput, type Tool, type ToolContext, type ToolResult } from "./types";

/** Places a dot on click. */
export class PointTool implements Tool {
    readonly kind = "point" as const;

    onPointerDown(_scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        const dot = createDot(p, ctx.pen);
        return { commit: { kind: "add", elements: [dot] }, selection: [dot.id] };
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
