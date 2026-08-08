<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import {
        HINT_LADDER_LENGTH,
        hintLadderState,
        type HintRung,
    } from "$lib/ai/hints";
    import { cn } from "$lib/utils";

    let {
        level = 0,
        disabled = false,
        flashToken = 0,
        flashDuration = 6000,
        onselect,
        class: className,
    }: {
        /** Rungs already taken on this problem. */
        level?: number;
        /** Set while the rail may be looked at but not used (paused, submitted). */
        disabled?: boolean;
        /**
         * Bumped by the trainer to reveal the ladder unprompted — a wrong answer with
         * tries still left is the moment a hint is worth offering, and the moment the
         * student is least likely to go hunting for one. Any new value re-opens and
         * restarts the timer; it is a token, not a count, so the trainer never has to
         * reason about what number it is on.
         */
        flashToken?: number;
        /** How long an unprompted reveal stays up before folding itself away. */
        flashDuration?: number;
        onselect: (rung: HintRung, index: number) => void;
        class?: string;
    } = $props();

    let hovered = $state(false);
    let focused = $state(false);
    /** Click/tap latch, so the rail is usable without a pointer that can hover. */
    let pinned = $state(false);
    let flashed = $state(false);

    let rungs = $derived(hintLadderState(level));
    let spent = $derived(level >= HINT_LADDER_LENGTH);
    let open = $derived(hovered || focused || pinned || flashed);

    // The flash is time-limited but never fights the user: hovering or focusing the
    // rail keeps it open on its own terms, and taking a hint ends the flash outright.
    $effect(() => {
        if (flashToken <= 0) return;
        flashed = true;
        const timer = setTimeout(() => (flashed = false), flashDuration);
        return () => clearTimeout(timer);
    });

    function take(rung: HintRung, index: number) {
        if (disabled) return;
        flashed = false;
        pinned = false;
        onselect(rung, index);
    }
</script>

<!-- Pointer events rather than mouse events: they carry `pointerType`, so a tap does
     not also register as a hover that never ends on touch devices.

     The lightbulb is last in the row and the row is end-aligned, so the bulb's own
     position is fixed: opening the rail grows the chips *leftward*, away from it. The
     other order (bulb first) makes the trigger slide out from under the pointer the
     instant it is hovered, which is the jump this layout exists to avoid. -->
<div
    role="group"
    aria-label="Hints"
    class={cn("flex items-center justify-end gap-1.5", className)}
    onpointerenter={(event) => {
        if (event.pointerType === "mouse") hovered = true;
    }}
    onpointerleave={(event) => {
        if (event.pointerType === "mouse") hovered = false;
    }}
    onfocusin={() => (focused = true)}
    onfocusout={() => (focused = false)}
>
    <!-- `grid-template-columns` interpolates where `width: auto` does not, so the
         chips can measure themselves and still animate open. -->
    <div
        class={cn(
            "grid transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
            open ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
        )}
    >
        <div
            class={cn(
                "flex min-w-0 items-center gap-1 overflow-hidden transition-opacity duration-150 motion-reduce:transition-none",
                open ? "opacity-100" : "opacity-0",
            )}
        >
            {#each rungs as state (state.rung.id)}
                <button
                    type="button"
                    disabled={disabled || state.locked || state.used}
                    tabindex={open ? 0 : -1}
                    aria-hidden={!open}
                    title={state.locked
                        ? `Take the ${rungs[state.index - 1]?.rung.label.toLowerCase()} hint first`
                        : state.rung.description}
                    class={cn(
                        "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs transition-colors disabled:cursor-default motion-reduce:transition-none",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        // The one takeable rung is the only filled chip in the row, and
                        // it is filled the way every other primary control in the app is
                        // (`bg-primary text-primary-foreground`) — the old `text-primary`
                        // on a 10% wash of the *same* light blue was two near-identical
                        // values stacked, so the actionable chip read fainter than the
                        // spent ones beside it.
                        state.next &&
                            "border-transparent bg-primary font-medium text-primary-foreground shadow-sm hover:bg-primary-foreground hover:text-secondary-foreground hover:shadow-md disabled:opacity-60 disabled:shadow-none",
                        // Spent and locked rungs stay chips rather than bare words, so
                        // the ladder reads as one row with one live step in it.
                        state.used && "border-border/60 text-muted-foreground",
                        state.locked && "border-border/40 text-muted-foreground/50",
                    )}
                    onclick={() => take(state.rung, state.index)}
                >
                    <Icon
                        name={state.used ? "check" : state.rung.icon}
                        fontsize={14}
                        class="shrink-0"
                    />
                    <span>{state.rung.label}</span>
                </button>
            {/each}
        </div>
    </div>

    <button
        type="button"
        aria-expanded={open}
        aria-label={spent
            ? "Hints, all used"
            : `Hints, ${level} of ${HINT_LADDER_LENGTH} used`}
        class={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/50 px-2 text-xs text-muted-foreground transition-colors motion-reduce:transition-none",
            "hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            open && "border-border text-foreground",
        )}
        onclick={() => (pinned = !pinned)}
    >
        <Icon name="lightbulb" fontsize={15} fill={level > 0} />
        {#if level > 0}
            <span class="tabular-nums">{level}/{HINT_LADDER_LENGTH}</span>
        {/if}
    </button>
</div>
