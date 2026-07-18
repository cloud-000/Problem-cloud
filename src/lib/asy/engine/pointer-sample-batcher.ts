import type { Pair } from "../scene/types";

export type FrameScheduler = (callback: () => void) => number;
export type FrameCanceller = (handle: number) => void;

/**
 * Collect pointer samples and deliver at most one batch per scheduled frame.
 * `flushWith` lets pointer-up synchronously consume the pending batch without
 * first generating a redundant preview.
 */
export class PointerSampleBatcher {
    private pending: Pair[] = [];
    private frame: number | null = null;

    constructor(
        private readonly onBatch: (points: readonly Pair[]) => void,
        private readonly schedule: FrameScheduler,
        private readonly cancelFrame: FrameCanceller,
    ) {}

    add(points: readonly Pair[]): void {
        if (points.length === 0) return;
        this.pending.push(...points);
        if (this.frame !== null) return;
        this.frame = this.schedule(() => {
            this.frame = null;
            const batch = this.takePending();
            if (batch.length > 0) this.onBatch(batch);
        });
    }

    flush(): boolean {
        return this.flushWith(this.onBatch);
    }

    flushWith(consumer: (points: readonly Pair[]) => void): boolean {
        this.cancelScheduledFrame();
        const batch = this.takePending();
        if (batch.length === 0) return false;
        consumer(batch);
        return true;
    }

    cancel(): void {
        this.cancelScheduledFrame();
        this.pending = [];
    }

    private cancelScheduledFrame(): void {
        if (this.frame === null) return;
        this.cancelFrame(this.frame);
        this.frame = null;
    }

    private takePending(): Pair[] {
        const batch = this.pending;
        this.pending = [];
        return batch;
    }
}
