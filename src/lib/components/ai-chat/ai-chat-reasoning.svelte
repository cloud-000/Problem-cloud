<script lang="ts" module>
    import type { AIReasoningTrace } from "$lib/ai/types";

    export interface AIChatReasoningProps {
        trace: AIReasoningTrace;
        /**
         * Whether the answer has started. The trace is worth reading while it is
         * the only thing on screen, and in the way once the answer arrives, so
         * this drives the open state rather than a lifecycle effect.
         */
        answered: boolean;
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";

    let { trace, answered }: AIChatReasoningProps = $props();

    // Null until the user takes over; from then on their choice wins and the
    // stream stops moving the disclosure under them.
    let overridden = $state<boolean | null>(null);
    let open = $derived(overridden ?? !answered);

    let seconds = $derived(
        trace.endedAt
            ? Math.max(1, Math.round((Date.parse(trace.endedAt) - Date.parse(trace.startedAt)) / 1000))
            : 0,
    );
    let label = $derived(trace.endedAt ? `Thought for ${seconds}s` : "Thinking…");
</script>

<div class="my-1.5 rounded-xl border border-border/40 bg-surface-container-lowest/60">
    <button
        type="button"
        class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
        onclick={() => (overridden = !open)}
    >
        <Icon name="neurology" fontsize={14} />
        <span class:animate-pulse={!trace.endedAt}>{label}</span>
        <Icon
            name="expand_more"
            fontsize={16}
            class="ml-auto transition-transform {open ? 'rotate-180' : ''}"
        />
    </button>
    {#if open}
        <!-- The trace is the model's private working, not its answer: muted, and
             rendered through the same markdown dialect so its own structure holds. -->
        <MathStatement
            text={trace.text}
            format="markdown"
            class="border-t border-border/30 px-2.5 py-2 text-xs leading-5 text-muted-foreground"
        />
    {/if}
</div>
