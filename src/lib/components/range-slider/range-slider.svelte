<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { tv } from "tailwind-variants";
    import {
        applyPush,
        clamp,
        percentToValue,
        type RangeValue,
        snapToStep,
        valueToPercent,
    } from "./range-slider.js";

    export const rangeSliderVariants = tv({
        base: "w-full touch-none select-none",
        variants: {
            disabled: {
                true: "pointer-events-none opacity-50",
                false: "",
            },
        },
        defaultVariants: {
            disabled: false,
        },
    });

    export type RangeSliderProps = WithElementRef<
        HTMLAttributes<HTMLDivElement>,
        HTMLDivElement
    > & {
        /** The selected `[low, high]` range. Two-way bindable. */
        value?: RangeValue;
        /** Lower bound of the scale. */
        min?: number;
        /** Upper bound of the scale. */
        max?: number;
        /** Granularity the handles snap to. `<= 0` disables snapping. */
        step?: number;
        /** Minimum distance kept between the two handles (the "push" gap). */
        minGap?: number;
        /** Disable all interaction and dim the control. */
        disabled?: boolean;
        /** Show a value bubble above the active/focused handle. */
        showTooltip?: boolean;
        /** Format a value for the tooltip, bound labels, and `aria-valuetext`. */
        formatValue?: (v: number) => string;
        /** Accessible name prefix for the handles (e.g. "Difficulty"). */
        label?: string;
    };
</script>

<script lang="ts">
    let {
        ref = $bindable(null),
        min = 0,
        max = 100,
        step = 1,
        minGap = 0,
        value = $bindable([min, max]),
        disabled = false,
        showTooltip = true,
        formatValue = (v: number) => String(v),
        label = "Range",
        class: className,
        ...restProps
    }: RangeSliderProps = $props();

    let trackEl = $state<HTMLDivElement | null>(null);
    let dragMode = $state<"thumb" | "bar" | null>(null);
    let activeThumb = $state<0 | 1 | null>(null);
    let focusedThumb = $state<0 | 1 | null>(null);

    // Transient bar-drag anchors (no UI dependency, so plain `let`).
    let barStartValue = 0;
    let barStartLow = 0;
    let barStartHigh = 0;

    const lowPct = $derived(valueToPercent(value[0], min, max));
    const highPct = $derived(valueToPercent(value[1], min, max));

    function clientXToRawValue(clientX: number): number {
        if (!trackEl) return min;
        const rect = trackEl.getBoundingClientRect();
        const pct = ((clientX - rect.left) / rect.width) * 100;
        return percentToValue(pct, min, max);
    }

    function clientXToValue(clientX: number): number {
        return snapToStep(clientXToRawValue(clientX), min, max, step);
    }

    function setThumb(i: 0 | 1, v: number) {
        const next: RangeValue = i === 0 ? [v, value[1]] : [value[0], v];
        value = applyPush(next, i, min, max, minGap);
    }

    // Tap on the bare track: move the nearest handle there, then drag it.
    function onTrackPointerDown(e: PointerEvent) {
        if (disabled || !trackEl) return;
        e.preventDefault();
        const v = clientXToValue(e.clientX);
        const i: 0 | 1 =
            Math.abs(v - value[0]) <= Math.abs(v - value[1]) ? 0 : 1;
        setThumb(i, v);
        trackEl.setPointerCapture(e.pointerId);
        dragMode = "thumb";
        activeThumb = i;
    }

    function startThumbDrag(e: PointerEvent, i: 0 | 1) {
        if (disabled || !trackEl) return;
        e.preventDefault();
        e.stopPropagation();
        trackEl.setPointerCapture(e.pointerId);
        dragMode = "thumb";
        activeThumb = i;
    }

    function startBarDrag(e: PointerEvent) {
        if (disabled || !trackEl) return;
        e.preventDefault();
        e.stopPropagation();
        trackEl.setPointerCapture(e.pointerId);
        dragMode = "bar";
        activeThumb = null;
        barStartValue = clientXToRawValue(e.clientX);
        barStartLow = value[0];
        barStartHigh = value[1];
    }

    // All gestures capture the pointer on `trackEl`, so move/up retarget here.
    function onPointerMove(e: PointerEvent) {
        if (!dragMode) return;
        if (dragMode === "thumb" && activeThumb !== null) {
            setThumb(activeThumb, clientXToValue(e.clientX));
        } else if (dragMode === "bar") {
            const delta = clientXToRawValue(e.clientX) - barStartValue;
            const width = barStartHigh - barStartLow;
            const lo = clamp(
                snapToStep(barStartLow + delta, min, max, step),
                min,
                max - width,
            );
            value = [lo, lo + width];
        }
    }

    function onPointerUp(e: PointerEvent) {
        if (trackEl?.hasPointerCapture(e.pointerId)) {
            trackEl.releasePointerCapture(e.pointerId);
        }
        dragMode = null;
        activeThumb = null;
    }

    function onThumbKeyDown(e: KeyboardEvent, i: 0 | 1) {
        if (disabled) return;
        const fine = step > 0 ? step : (max - min) / 100;
        const coarse = step > 0 ? step * 10 : (max - min) / 10;
        let v = value[i];
        switch (e.key) {
            case "ArrowRight":
            case "ArrowUp":
                v += fine;
                break;
            case "ArrowLeft":
            case "ArrowDown":
                v -= fine;
                break;
            case "PageUp":
                v += coarse;
                break;
            case "PageDown":
                v -= coarse;
                break;
            case "Home":
                v = min;
                break;
            case "End":
                v = max;
                break;
            default:
                return;
        }
        e.preventDefault();
        setThumb(i, snapToStep(v, min, max, step));
    }

    function tooltipVisible(i: 0 | 1): boolean {
        if (!showTooltip) return false;
        if (dragMode === "bar") return true;
        return (dragMode === "thumb" && activeThumb === i) || focusedThumb === i;
    }
</script>

{#snippet thumb(i: 0 | 1)}
    {@const pct = i === 0 ? lowPct : highPct}
    <button
        type="button"
        role="slider"
        tabindex={disabled ? -1 : 0}
        aria-label={`${label} ${i === 0 ? "minimum" : "maximum"}`}
        aria-orientation="horizontal"
        aria-valuemin={i === 0 ? min : value[0]}
        aria-valuemax={i === 0 ? value[1] : max}
        aria-valuenow={value[i]}
        aria-valuetext={formatValue(value[i])}
        aria-disabled={disabled}
        class="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-input bg-surface-container-lowest shadow-sm transition-[color,box-shadow] outline-none not-disabled:cursor-grab focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-disabled:cursor-grabbing"
        style="left: {pct}%"
        {disabled}
        onpointerdown={(e) => startThumbDrag(e, i)}
        onkeydown={(e) => onThumbKeyDown(e, i)}
        onfocus={() => (focusedThumb = i)}
        onblur={() => (focusedThumb === i && (focusedThumb = null))}
    >
        {#if tooltipVisible(i)}
            <span
                class="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-md bg-inverse-surface px-1.5 py-0.5 text-label-caps whitespace-nowrap text-inverse-on-surface"
            >
                {formatValue(value[i])}
            </span>
        {/if}
    </button>
{/snippet}

<div
    bind:this={ref}
    data-slot="range-slider"
    class={cn(rangeSliderVariants({ disabled }), className)}
    {...restProps}
>
    <div class="relative flex h-5 items-center">
        <div
            bind:this={trackEl}
            role="presentation"
            class="relative h-1.5 w-full rounded-full bg-surface-container-high"
            onpointerdown={onTrackPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={onPointerUp}
        >
            <div
                role="presentation"
                class="absolute inset-y-0 cursor-grab rounded-full bg-primary active:cursor-grabbing"
                style="left: {lowPct}%; right: {100 - highPct}%"
                onpointerdown={startBarDrag}
            ></div>
            {@render thumb(0)}
            {@render thumb(1)}
        </div>
    </div>
    <div
        class="mt-xs flex justify-between text-label-caps text-muted-foreground"
    >
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
    </div>
</div>
