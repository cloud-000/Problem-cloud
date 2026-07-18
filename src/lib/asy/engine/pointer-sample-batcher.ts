export type FrameScheduler = (callback: () => void) => number;
export type FrameCanceller = (handle: number) => void;

/**
 * Collect pointer samples and deliver at most one batch per scheduled frame.
 * `flushWith` lets pointer-up synchronously consume the pending batch without
 * first generating a redundant preview.
 */
export class PointerSampleBatcher<T> {
    private pending: T[] = [];
    private frame: number | null = null;

    constructor(
        private readonly onBatch: (points: readonly T[]) => void,
        private readonly schedule: FrameScheduler,
        private readonly cancelFrame: FrameCanceller,
    ) {}

    add(points: readonly T[]): void {
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

    flushWith(consumer: (points: readonly T[]) => void): boolean {
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

    private takePending(): T[] {
        const batch = this.pending;
        this.pending = [];
        return batch;
    }
}
