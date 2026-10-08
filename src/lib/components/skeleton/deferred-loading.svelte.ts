/**
 * Configuration options for deferred skeleton loading.
 */
export interface DeferredLoadingOptions {
    /**
     * Delay in milliseconds before displaying the skeleton.
     * Prevents "Flash of Incomplete Content" (FOIC) if data resolves quickly (e.g. from cache).
     * Set to 0 to show skeleton immediately.
     * @default 120
     */
    delayMs?: number;

    /**
     * Minimum duration in milliseconds the skeleton remains visible once shown.
     * Prevents distracting micro-flickers if data resolves immediately after the skeleton mounts.
     * @default 200
     */
    minDurationMs?: number;
}

/**
 * Controller class managing smooth transitions between loading and loaded states,
 * eliminating sub-second skeleton flashes on fast responses.
 */
export class DeferredLoading {
    #loading = $state(false);
    #showSkeleton = $state(false);
    #delayTimer: ReturnType<typeof setTimeout> | null = null;
    #minHoldTimer: ReturnType<typeof setTimeout> | null = null;
    #shownAt: number | null = null;
    #delayMs: number;
    #minDurationMs: number;

    constructor(initialLoading = false, options: DeferredLoadingOptions = {}) {
        this.#delayMs = options.delayMs ?? 120;
        this.#minDurationMs = options.minDurationMs ?? 200;
        this.setLoading(initialLoading);
    }

    /**
     * Whether the skeleton placeholder should be rendered on screen.
     */
    get showSkeleton(): boolean {
        return this.#showSkeleton;
    }

    /**
     * Whether the underlying async operation is currently active.
     */
    get isLoading(): boolean {
        return this.#loading;
    }

    /**
     * Updates the underlying loading state.
     */
    setLoading(loading: boolean): void {
        this.#loading = loading;

        if (loading) {
            // If already showing skeleton, retain it
            if (this.#showSkeleton) return;

            // Clear any pending dismissal from a previous cycle
            if (this.#minHoldTimer) {
                clearTimeout(this.#minHoldTimer);
                this.#minHoldTimer = null;
            }

            if (this.#delayMs <= 0) {
                this.#showSkeleton = true;
                this.#shownAt = Date.now();
            } else if (!this.#delayTimer) {
                this.#delayTimer = setTimeout(() => {
                    this.#showSkeleton = true;
                    this.#shownAt = Date.now();
                    this.#delayTimer = null;
                }, this.#delayMs);
            }
        } else {
            // Loading finished
            if (this.#delayTimer) {
                // Resolved before the threshold - cancel and never show skeleton
                clearTimeout(this.#delayTimer);
                this.#delayTimer = null;
            }

            if (this.#showSkeleton) {
                const elapsed = this.#shownAt ? Date.now() - this.#shownAt : this.#minDurationMs;
                const remaining = Math.max(0, this.#minDurationMs - elapsed);

                if (remaining > 0) {
                    if (this.#minHoldTimer) clearTimeout(this.#minHoldTimer);
                    this.#minHoldTimer = setTimeout(() => {
                        this.#showSkeleton = false;
                        this.#shownAt = null;
                        this.#minHoldTimer = null;
                    }, remaining);
                } else {
                    this.#showSkeleton = false;
                    this.#shownAt = null;
                }
            }
        }
    }

    /**
     * Cleans up timers when the component unmounts.
     */
    destroy(): void {
        if (this.#delayTimer) {
            clearTimeout(this.#delayTimer);
            this.#delayTimer = null;
        }
        if (this.#minHoldTimer) {
            clearTimeout(this.#minHoldTimer);
            this.#minHoldTimer = null;
        }
    }
}

/**
 * Svelte 5 rune helper that returns a reactive deferred loading controller.
 * Automatically tracks reactive loading getters and cleans up on unmount.
 */
export function createDeferredLoading(
    getLoading: () => boolean,
    options: DeferredLoadingOptions = {}
): DeferredLoading {
    const tracker = new DeferredLoading(getLoading(), options);

    $effect(() => {
        tracker.setLoading(getLoading());
        return () => {
            tracker.destroy();
        };
    });

    return tracker;
}
