import type { Pair, Scene } from "../../scene/types";
import { createArc } from "../../scene/factory";
import { distance, normalizeDeg } from "../geometry";
import { addElement, NO_RESULT, pointerPoint, type PointerInput, type Tool, type ToolContext, type ToolResult } from "./types";

function angleOf(center: Pair, p: Pair): number {
    return normalizeDeg((Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI);
}

/**
 * Arc via four clicks: (1) center, (2) radius, (3) start angle, and (4) end
 * angle. The construction circle and semantic points are transient UI guides.
 */
export class ArcTool implements Tool {
    readonly kind = "arc" as const;
    private center: Pair | null = null;
    private radius = 0;
    private angle1 = 0;
    private phase: 0 | 1 | 2 | 3 = 0;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (this.phase === 0) {
            this.center = p;
            this.phase = 1;
            return { preview: scene, arcGuide: { center: p, radius: 0, radiusPoint: p } };
        }
        if (this.phase === 1) {
            this.radius = distance(this.center!, p);
            if (this.radius < ctx.tolerance) return this.onCancel();
            this.phase = 2;
            return {
                preview: scene,
                arcGuide: { center: this.center!, radius: this.radius, radiusPoint: p },
            };
        }
        if (this.phase === 2) {
            this.angle1 = angleOf(this.center!, p);
            this.phase = 3;
            return {
                preview: scene,
                arcGuide: {
                    center: this.center!,
                    radius: this.radius,
                    angle1: this.angle1,
                },
            };
        }
        // phase 3 -> commit
        const center = this.center!;
        const pointerAngle = angleOf(center, p);
        const projectedEnd: Pair = [
            center[0] + this.radius * Math.cos((pointerAngle * Math.PI) / 180),
            center[1] + this.radius * Math.sin((pointerAngle * Math.PI) / 180),
        ];
        const angle2 = distance(projectedEnd, [
            center[0] + this.radius * Math.cos((this.angle1 * Math.PI) / 180),
            center[1] + this.radius * Math.sin((this.angle1 * Math.PI) / 180),
        ]) <= ctx.tolerance
            ? this.angle1 + 360
            : pointerAngle;
        const arc = createArc(center, this.radius, this.angle1, angle2, ctx.pen);
        this.reset();
        return {
            commit: addElement(scene, arc),
            selection: [arc.id],
            preview: null,
            arcGuide: null,
            nextTool: "select",
        };
    }

    onPointerMove(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        const p = pointerPoint(input);
        if (this.phase === 1) {
            const r = distance(this.center!, p);
            return { preview: scene, arcGuide: { center: this.center!, radius: r, radiusPoint: p } };
        }
        if (this.phase === 2) {
            const angle1 = angleOf(this.center!, p);
            return {
                preview: scene,
                arcGuide: { center: this.center!, radius: this.radius, angle1 },
            };
        }
        if (this.phase === 3) {
            const angle2 = angleOf(this.center!, p);
            return {
                preview: addElement(scene, createArc(
                    this.center!, this.radius, this.angle1, angle2, ctx.pen,
                )),
                arcGuide: {
                    center: this.center!,
                    radius: this.radius,
                    angle1: this.angle1,
                    angle2,
                },
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
        return { preview: null, arcGuide: null };
    }

    private reset(): void {
        this.center = null;
        this.radius = 0;
        this.angle1 = 0;
        this.phase = 0;
    }
}
