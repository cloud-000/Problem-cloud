import type { Pair, Pen, Scene } from "../../scene/types";
import { createDot, makePath, newId } from "../../scene/factory";
import { brushOutline } from "../brush";
import { classifyStrokeJoins, processStroke } from "../simplify";
import {
    addElement,
    NO_RESULT,
    pointerSample,
    type PointerInput,
    type PointerSample,
    type Tool,
    type ToolContext,
    type ToolResult,
} from "./types";

/**
 * Freehand pen. Solid input becomes a pressure/velocity-sensitive filled
 * silhouette; dashed input retains the processed centerline path pipeline.
 */
export class PenTool implements Tool {
    readonly kind = "pen" as const;
    private samples: PointerSample[] = [];
    private drawing = false;
    private draftId: string | null = null;
    private brushSize = 0;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        this.drawing = true;
        this.samples = [pointerSample(input)];
        this.draftId = newId();
        this.brushSize = Math.max(0, ctx.pen.lineWidth ?? 1.5) * ctx.sceneUnitsPerPixel;
        return { preview: scene };
    }

    onPointerMove(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        return this.onPointerMoves(scene, [input], ctx);
    }

    onPointerMoves(scene: Scene, inputs: readonly PointerInput[], ctx: ToolContext): ToolResult {
        if (!this.drawing) return NO_RESULT;
        this.append(inputs);
        const element = this.strokeElement(ctx);
        return element ? { preview: addElement(scene, element) } : { preview: scene };
    }

    onPointerUp(
        scene: Scene,
        input: PointerInput,
        ctx: ToolContext,
        pendingMoves: readonly PointerInput[] = [],
    ): ToolResult {
        if (!this.drawing) return NO_RESULT;
        this.drawing = false;
        this.append(pendingMoves);
        this.append([input]);
        const isTap = this.gestureTravel() <= Math.max(0, ctx.penTapTolerance);
        const tapAt = this.samples[0].point;
        const element = this.strokeElement(ctx);
        this.samples = [];
        if (isTap) {
            const dot = createDot(tapAt, ctx.pen);
            this.draftId = null;
            this.brushSize = 0;
            return { commit: addElement(scene, dot), selection: [], preview: null };
        }
        if (!element) {
            this.draftId = null;
            this.brushSize = 0;
            return { preview: null };
        }
        this.draftId = null;
        this.brushSize = 0;
        // Freehand is a continuous drawing tool: keep it active and leave the
        // finished stroke unselected so the next stroke can begin cleanly.
        return { commit: addElement(scene, element), selection: [], preview: null };
    }

    onCancel(): ToolResult {
        this.drawing = false;
        this.samples = [];
        this.draftId = null;
        this.brushSize = 0;
        return { preview: null };
    }

    private append(inputs: readonly PointerInput[]): void {
        for (const input of inputs) {
            const fallbackTimestamp = (this.samples.at(-1)?.timestamp ?? -16) + 16;
            this.samples.push(pointerSample(input, fallbackTimestamp));
        }
    }

    private strokeElement(ctx: ToolContext) {
        if (ctx.pen.dash && ctx.pen.dash !== "solid") {
            const nodes = processStroke(this.samples.map(({ point }) => point), ctx.strokeProcessing);
            return nodes.length >= 2 ? this.strokePathFromNodes(nodes, ctx) : null;
        }
        const outline = brushOutline(this.samples, {
            size: this.brushSize,
            sceneUnitsPerPixel: ctx.sceneUnitsPerPixel,
            sampleSpacing: ctx.strokeProcessing.sampleSpacing,
            smoothing: ctx.strokeProcessing.smoothing,
        });
        if (!outline) return null;
        return {
            id: this.draftId ?? newId(),
            kind: "fill" as const,
            path: outline,
            pen: this.brushPen(ctx.pen),
        };
    }

    private brushPen(pen: Pen): Pen {
        return {
            ...(pen.namedColor ? { namedColor: pen.namedColor } : {}),
            ...(pen.color ? { color: pen.color } : {}),
            opacity: pen.opacity ?? 1,
        };
    }

    /** Largest displacement from pointer-down; tiny coalesced jitter remains a tap. */
    private gestureTravel(): number {
        const start = this.samples[0];
        if (!start) return 0;
        return this.samples.reduce(
            (maximum, sample) => Math.max(
                maximum,
                Math.hypot(sample.point[0] - start.point[0], sample.point[1] - start.point[1]),
            ),
            0,
        );
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
