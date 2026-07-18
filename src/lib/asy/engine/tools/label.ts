import type { Pair, Scene } from "../../scene/types";
import { createLabel } from "../../scene/factory";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

/** Places a text label on click; the view supplies the text via `promptLabel`. */
export class LabelTool implements Tool {
    readonly kind = "label" as const;

    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
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
