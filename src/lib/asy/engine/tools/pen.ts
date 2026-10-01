import type { Pair, PathElement, Scene } from "../../scene/types";
import { createDot, makePath, newId } from "../../scene/factory";
import { smoothRawWithCorners } from "../brush";
import { classifyStrokeJoins, dedupePoints, processStroke } from "../simplify";
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
 * Freehand pen. Strokes are stored as compact, smooth centerline paths
 * (Scene kind "path") with classified joins and native round caps.
 */
export class PenTool implements Tool {
    readonly kind = "pen" as const;
    private samples: PointerSample[] = [];
    private drawing = false;
    private draftId: string | null = null;

    onPointerDown(scene: Scene, input: PointerInput, ctx: ToolContext): ToolResult {
        this.drawing = true;
        this.samples = [pointerSample(input)];
        this.draftId = newId();
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
            return { commit: { kind: "add", elements: [dot] }, selection: [], preview: null };
        }
        if (!element) {
            this.draftId = null;
            return { preview: null };
        }
        this.draftId = null;
        // Freehand is a continuous drawing tool: keep it active and leave the
        // finished stroke unselected so the next stroke can begin cleanly.
        return { commit: { kind: "add", elements: [element] }, selection: [], preview: null };
    }

    onCancel(): ToolResult {
        this.drawing = false;
        this.samples = [];
        this.draftId = null;
        return { preview: null };
    }

    private append(inputs: readonly PointerInput[]): void {
        for (const input of inputs) {
            const fallbackTimestamp = (this.samples.at(-1)?.timestamp ?? -16) + 16;
            this.samples.push(pointerSample(input, fallbackTimestamp));
        }
    }

    private strokeElement(ctx: ToolContext): PathElement | null {
        if (this.samples.length < 2) return null;
        const rawPoints = dedupePoints(this.samples.map(({ point }) => point));
        if (rawPoints.length < 2) return null;
        const shouldPrefilter = ctx.strokeProcessing.sampleSpacing > 0 && ctx.strokeProcessing.smoothing > 0;
        const prefiltered = shouldPrefilter
            ? smoothRawWithCorners(rawPoints, 2)
            : rawPoints;
        const nodes = processStroke(prefiltered, ctx.strokeProcessing);
        return nodes.length >= 2 ? this.strokePathFromNodes(nodes, ctx) : null;
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

    private strokePathFromNodes(nodes: Pair[], ctx: ToolContext): PathElement {
        return {
            id: this.draftId ?? newId(),
            kind: "path" as const,
            path: makePath(nodes, {
                joins: classifyStrokeJoins(
                    nodes,
                    ctx.strokeProcessing.cornerThresholdDegrees,
                ),
            }),
            pen: { ...ctx.pen },
        };
    }
}
