<script lang="ts" module>
    export interface CoachSystemRowProps {
        /**
         * A user turn already in the transcript — renders the context that turn carried,
         * at that turn's position. Omit for `messages[0]`: the system message the next
         * send leads with, which is why that variant belongs at the top of the transcript.
         */
        messageId?: string;
        class?: string;
    }
</script>

<script lang="ts">
    import { untrack } from "svelte";
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";
    import type { TurnInspection } from "$lib/ai/context/inspect";

    let { messageId, class: className }: CoachSystemRowProps = $props();

    let inspection = $state<TurnInspection | null>(null);
    let failure = $state<string | null>(null);
    let copied = $state(false);
    let generation = 0;

    async function run() {
        const current = (generation += 1);
        failure = null;
        try {
            const next = messageId
                ? await coach.inspectMessageContext(messageId)
                : await coach.inspectSystemMessage();
            if (current !== generation) return;
            inspection = next;
            if (!next) failure = "No context resolver configured — see (app)/+layout.svelte.";
        } catch (error) {
            if (current !== generation) return;
            failure = error instanceof Error ? error.message : "Could not resolve context.";
        }
    }

    // Resolving costs a round trip, so what re-runs it is chosen narrowly: mount, an
    // explicit refresh, and — for messages[0] only — a change in turn count, meaning a
    // send landed. Never the context layers themselves: the trainer re-registers its
    // layer on every timer tick (elapsedMs is live), which would be a fetch per tick.
    let turnCount = $derived(messageId ? 0 : coach.messages.length);
    $effect(() => {
        turnCount;
        untrack(() => void run());
    });

    async function copy() {
        if (!inspection) return;
        try {
            await navigator.clipboard.writeText(inspection.text);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch (error) {
            console.error("Failed to copy system message:", error);
        }
    }

    let role = $derived(messageId ? "context" : "system");
    let note = $derived(
        messageId
            ? inspection?.included === false
                ? "outside the next request history"
                : "compiled prefix in the next request"
            : "messages[0] of the next request",
    );
    // An inlined turn that carried nothing contributes no text to the request at all,
    // so there is no row to render — the absence is the finding, reported as such.
    let empty = $derived(inspection !== null && inspection.text === "");
</script>

<article class={cn("my-1 py-1 text-sm", className)} data-slot="coach-system-row">
    <div class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <div
            class="flex size-4 items-center justify-center rounded-md bg-muted-foreground/10 text-muted-foreground"
        >
            <Icon name="terminal" fontsize={12} />
        </div>
        <span class="font-mono">{role}</span>
        <span class="min-w-0 truncate font-mono text-[10px] opacity-60">{note}</span>
        {#if inspection}
            <span class="shrink-0 font-mono text-[10px] opacity-60">
                {inspection.factCount} facts · {inspection.policy}
            </span>
            <button
                type="button"
                onclick={copy}
                title="Copy"
                class="flex shrink-0 cursor-pointer items-center rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground"
            >
                <Icon
                    name={copied ? "check" : "content_copy"}
                    fontsize={12}
                    class={copied ? "text-correct" : ""}
                />
            </button>
        {/if}
        <button
            type="button"
            onclick={() => void run()}
            title="Re-resolve"
            class="flex shrink-0 cursor-pointer items-center rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground"
        >
            <Icon name="refresh" fontsize={12} />
        </button>
    </div>

    {#if failure}
        <p class="text-xs text-destructive">{failure}</p>
    {:else if empty}
        <p class="font-mono text-[11px] italic text-muted-foreground/70">
            {inspection?.included === false
                ? "This turn is outside the provider history window."
                : "No context prefix is emitted for this turn."}
        </p>
    {:else if inspection}
        <pre
            class="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-dashed border-border/60 bg-surface-container-lowest px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{inspection.text}</pre>
    {:else}
        <p class="font-mono text-[11px] text-muted-foreground/70">Resolving…</p>
    {/if}
</article>
