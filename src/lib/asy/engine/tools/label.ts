import type { Pair, Scene } from "../../scene/types";
import { createLabel } from "../../scene/factory";
import { addElement, NO_RESULT, pointerPoint, type PointerInput, type Tool, type ToolContext, type ToolResult } from "./types";

/** Places a text label on click; the view supplies the text via `promptLabel`. */
export class LabelTool implements Tool {
    readonly kind = "label" as const;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        const text = ctx.promptLabel?.(p);
        if (!text) return NO_RESULT;
        const label = createLabel(text, p, undefined, ctx.pen);
        return { commit: addElement(scene, label), selection: [label.id] };
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
