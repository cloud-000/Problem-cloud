import type { Pair, Scene } from "../../scene/types";
import { createArc, createCircle } from "../../scene/factory";
import { distance, normalizeDeg } from "../geometry";
import { addElement, NO_RESULT, type Tool, type ToolContext, type ToolResult } from "./types";

function angleOf(center: Pair, p: Pair): number {
    return normalizeDeg((Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI);
}

/**
 * Arc via three clicks: (1) center, (2) a point on the rim — fixes radius and
 * the start angle, (3) a point whose angle fixes the end angle. Moves between
 * clicks render a live preview.
 */
export class ArcTool implements Tool {
    readonly kind = "arc" as const;
    private center: Pair | null = null;
    private radius = 0;
    private angle1 = 0;
    private phase: 0 | 1 | 2 = 0;

    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (this.phase === 0) {
            this.center = p;
            this.phase = 1;
            return { preview: scene };
        }
        if (this.phase === 1) {
            this.radius = distance(this.center!, p);
            this.angle1 = angleOf(this.center!, p);
            this.phase = 2;
            if (this.radius < ctx.tolerance) return this.onCancel();
            return { preview: scene };
        }
        // phase 2 -> commit
        const center = this.center!;
        const angle2 = distance(p, [
            center[0] + this.radius * Math.cos((this.angle1 * Math.PI) / 180),
            center[1] + this.radius * Math.sin((this.angle1 * Math.PI) / 180),
        ]) <= ctx.tolerance
            ? this.angle1 + 360
            : angleOf(center, p);
        const arc = createArc(center, this.radius, this.angle1, angle2, ctx.pen);
        this.reset();
        return { commit: addElement(scene, arc), selection: [arc.id], preview: null };
    }

    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult {
        if (this.phase === 1) {
            const r = distance(this.center!, p);
            return { preview: addElement(scene, createCircle(this.center!, r, ctx.pen)) };
        }
        if (this.phase === 2) {
            const angle2 = angleOf(this.center!, p);
            return {
                preview: addElement(
                    scene,
                    createArc(this.center!, this.radius, this.angle1, angle2, ctx.pen)
                ),
            };
        }
        return NO_RESULT;
    }

    onPointerUp(): ToolResult {
        // Arc is click-driven, not drag-driven; releases do nothing.
        return NO_RESULT;
    }

    onCancel(): ToolResult {
        this.reset();
        return { preview: null };
    }

    private reset(): void {
        this.center = null;
        this.radius = 0;
        this.angle1 = 0;
        this.phase = 0;
    }
}
